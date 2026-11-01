import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import {
  InvalidUploadPartsException,
  InvalidUploadRequestException,
  ProcessingQueueUnavailableException,
  StorageUnavailableException,
  UploadNotActiveException,
  VideoNotFoundException,
  VideoNotOwnedException,
} from '../common/exceptions/domain.exception';
import { STORAGE_ADAPTER } from '../storage/storage.constants';
import type {
  CompletedUploadPart,
  StorageAdapter,
} from '../storage/storage.types';
import {
  PROCESS_VIDEO_JOB,
  VIDEO_PROCESSING_QUEUE,
} from '../queue/queue.constants';
import { CompleteUploadResponseDto } from './dto/complete-upload-response.dto';
import { UploadPartsResponseDto } from './dto/upload-parts-response.dto';
import { Video, VideoStatus } from './entities/video.entity';

const MAX_PART_NUMBER = 10_000;
const MAX_PARTS = 10_000;

@Injectable()
export class UploadSessionService {
  constructor(
    @InjectRepository(Video) private readonly videos: Repository<Video>,
    private readonly dataSource: DataSource,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    @InjectQueue(VIDEO_PROCESSING_QUEUE) private readonly queue: Queue,
  ) {}

  async signUploadParts(
    ownerId: string,
    videoId: string,
    requested: unknown,
  ): Promise<UploadPartsResponseDto> {
    const partNumbers = this.validatePartNumbers(
      requested,
      InvalidUploadRequestException,
    );
    const video = await this.loadOwnedVideo(ownerId, videoId);
    this.assertActive(video);

    const urls: Record<string, string> = {};
    try {
      for (const partNumber of partNumbers) {
        urls[String(partNumber)] =
          await this.storage.createPresignedUploadPartUrl(
            video.source_object_key,
            video.multipart_upload_id!,
            partNumber,
          );
      }
    } catch (error) {
      if (error instanceof StorageUnavailableException) throw error;
      throw new StorageUnavailableException();
    }
    if (video.status === VideoStatus.DRAFT) {
      video.status = VideoStatus.UPLOADING;
      await this.videos.save(video);
    }
    return { videoId, uploadId: video.multipart_upload_id!, urls };
  }

  async completeUpload(
    ownerId: string,
    videoId: string,
    requested: unknown,
  ): Promise<CompleteUploadResponseDto> {
    const parts = this.validateCompletedParts(requested);
    const state = await this.dataSource.transaction(async (manager) => {
      const video = await manager.findOne(Video, {
        where: { id: videoId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!video) throw new VideoNotFoundException();
      if (video.owner_id !== ownerId) throw new VideoNotOwnedException();

      if (video.status === VideoStatus.PROCESSING) {
        return {
          videoId,
          status: video.status,
          sourceObjectKey: video.source_object_key,
        };
      }
      if (
        video.status === VideoStatus.READY ||
        video.status === VideoStatus.FAILED
      ) {
        return {
          videoId,
          status: video.status,
          sourceObjectKey: video.source_object_key,
        };
      }
      this.assertActive(video);

      try {
        await this.storage.completeMultipartUpload(
          video.source_object_key,
          video.multipart_upload_id!,
          parts,
        );
      } catch {
        throw new StorageUnavailableException();
      }
      video.status = VideoStatus.PROCESSING;
      video.multipart_upload_id = null;
      await manager.save(Video, video);
      return {
        videoId,
        status: video.status,
        sourceObjectKey: video.source_object_key,
      };
    });

    if (state.status === VideoStatus.PROCESSING) {
      try {
        await this.queue.add(
          PROCESS_VIDEO_JOB,
          { videoId: state.videoId, sourceObjectKey: state.sourceObjectKey },
          { jobId: state.videoId },
        );
      } catch {
        throw new ProcessingQueueUnavailableException();
      }
    }
    return { videoId: state.videoId, status: state.status };
  }

  async abortUpload(ownerId: string, videoId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const video = await manager.findOne(Video, {
        where: { id: videoId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!video) throw new VideoNotFoundException();
      if (video.owner_id !== ownerId) throw new VideoNotOwnedException();
      if (!video.multipart_upload_id && video.status === VideoStatus.DRAFT)
        return;
      this.assertActive(video);

      try {
        await this.storage.abortMultipartUpload(
          video.source_object_key,
          video.multipart_upload_id!,
        );
      } catch {
        throw new StorageUnavailableException();
      }
      video.multipart_upload_id = null;
      video.status = VideoStatus.DRAFT;
      await manager.save(Video, video);
    });
  }

  private async loadOwnedVideo(
    ownerId: string,
    videoId: string,
  ): Promise<Video> {
    const video = await this.videos.findOneBy({ id: videoId });
    if (!video) throw new VideoNotFoundException();
    if (video.owner_id !== ownerId) throw new VideoNotOwnedException();
    return video;
  }

  private assertActive(video: Video): void {
    if (
      !video.multipart_upload_id ||
      (video.status !== VideoStatus.DRAFT &&
        video.status !== VideoStatus.UPLOADING)
    ) {
      throw new UploadNotActiveException();
    }
  }

  private validatePartNumbers(
    value: unknown,
    ErrorType: new () => Error,
  ): number[] {
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      value.length > MAX_PARTS ||
      value.some((n) => !Number.isInteger(n) || n < 1 || n > MAX_PART_NUMBER) ||
      new Set(value).size !== value.length
    )
      throw new ErrorType();
    return value as number[];
  }

  private validateCompletedParts(value: unknown): CompletedUploadPart[] {
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      value.length > MAX_PARTS
    ) {
      throw new InvalidUploadPartsException();
    }
    const normalized: CompletedUploadPart[] = [];
    for (const item of value) {
      if (
        !item ||
        typeof item !== 'object' ||
        !Number.isInteger((item as CompletedUploadPart).partNumber) ||
        (item as CompletedUploadPart).partNumber < 1 ||
        (item as CompletedUploadPart).partNumber > MAX_PART_NUMBER ||
        typeof (item as CompletedUploadPart).eTag !== 'string' ||
        !(item as CompletedUploadPart).eTag.trim() ||
        (item as CompletedUploadPart).eTag.length > 256 ||
        [...(item as CompletedUploadPart).eTag].some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        )
      )
        throw new InvalidUploadPartsException();
      normalized.push({
        partNumber: (item as CompletedUploadPart).partNumber,
        eTag: (item as CompletedUploadPart).eTag,
      });
    }
    if (
      new Set(normalized.map(({ partNumber }) => partNumber)).size !==
      normalized.length
    ) {
      throw new InvalidUploadPartsException();
    }
    return normalized.sort((a, b) => a.partNumber - b.partNumber);
  }
}
