import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { Video, VideoStatus, VideoVisibility } from './entities/video.entity';
import {
  InvalidUploadPartsException,
  InvalidPartNumbersException,
  UploadNotInProgressException,
  VideoAccessDeniedException,
  VideoNotFoundException,
} from './exceptions/video-upload.exceptions';
import { VideoStorageService } from './storage/video-storage.service';
import { CreateVideoUploadDto } from './dto/create-video-upload.dto';
import {
  MAX_MULTIPART_PARTS,
  UPLOAD_PART_SIZE_BYTES,
} from './video-upload.constants';
import type { CompletedUploadPartDto } from './dto/complete-video-upload.dto';
import { VideoQueue } from './queue/video-queue.service';

export interface StartedVideoUpload {
  videoId: string;
  status: VideoStatus.DRAFT;
  partSizeBytes: number;
  partCount: number;
}

export interface SignedUploadPart {
  partNumber: number;
  url: string;
  expiresAt: Date;
}

export interface CompletedVideoUpload {
  videoId: string;
  status: VideoStatus.PROCESSING;
}

@Injectable()
export class VideoUploadService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,
    private readonly storage: VideoStorageService,
    private readonly videoQueue: VideoQueue,
  ) {}

  async startUpload(
    userId: string,
    dto: CreateVideoUploadDto,
  ): Promise<StartedVideoUpload> {
    const channel = await this.channelRepository.findOneBy({ user_id: userId });
    if (!channel) throw new VideoAccessDeniedException();

    const objectKey = `original/${randomUUID()}`;
    const draft = await this.videoRepository.save(
      this.videoRepository.create({
        channel_id: channel.id,
        status: VideoStatus.DRAFT,
        original_object_key: objectKey,
        multipart_upload_id: null,
        original_size_bytes: String(dto.sizeBytes),
        original_content_type: dto.contentType,
        processed_object_key: null,
        thumbnail_object_key: null,
        duration_seconds: null,
        visibility: VideoVisibility.PUBLIC,
        published_at: null,
      }),
    );

    let uploadId: string | undefined;
    try {
      uploadId = await this.storage.initiateMultipart(
        objectKey,
        dto.contentType,
      );
      draft.multipart_upload_id = uploadId;
      await this.videoRepository.save(draft);
    } catch (error) {
      if (uploadId) {
        try {
          await this.storage.abortMultipart(objectKey, uploadId);
        } catch {
          // Keep the initiating/persistence error as the operation's primary failure.
        }
      }
      await this.videoRepository.delete({ id: draft.id });
      throw error;
    }

    const partCount = Math.ceil(dto.sizeBytes / UPLOAD_PART_SIZE_BYTES);
    return {
      videoId: draft.id,
      status: VideoStatus.DRAFT,
      partSizeBytes: UPLOAD_PART_SIZE_BYTES,
      partCount,
    };
  }

  async signUploadParts(
    userId: string,
    videoId: string,
    partNumbers: number[],
  ): Promise<{ parts: SignedUploadPart[] }> {
    const video = await this.videoRepository.findOne({
      where: { id: videoId },
      relations: { channel: true },
    });
    if (!video) throw new VideoNotFoundException();
    if (video.channel.user_id !== userId)
      throw new VideoAccessDeniedException();
    if (video.status !== VideoStatus.DRAFT || !video.multipart_upload_id) {
      throw new UploadNotInProgressException();
    }

    const partCount = Math.ceil(
      Number(video.original_size_bytes) / UPLOAD_PART_SIZE_BYTES,
    );
    if (
      partNumbers.length === 0 ||
      partNumbers.length > MAX_MULTIPART_PARTS ||
      new Set(partNumbers).size !== partNumbers.length ||
      partNumbers.some(
        (partNumber) =>
          !Number.isInteger(partNumber) ||
          partNumber < 1 ||
          partNumber > partCount,
      )
    ) {
      throw new InvalidPartNumbersException();
    }

    const parts = await Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        ...(await this.storage.signUploadPart(
          video.original_object_key,
          video.multipart_upload_id!,
          partNumber,
        )),
      })),
    );
    return { parts };
  }

  async completeUpload(
    userId: string,
    videoId: string,
    parts: CompletedUploadPartDto[],
  ): Promise<CompletedVideoUpload> {
    const completed = await this.videoRepository.manager.transaction(
      async (manager) => {
        const repository = manager.getRepository(Video);
        const video = await repository.findOne({
          where: { id: videoId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!video) throw new VideoNotFoundException();
        const channel = await manager
          .getRepository(Channel)
          .findOneBy({ id: video.channel_id });
        if (!channel) throw new VideoNotFoundException();
        if (channel.user_id !== userId) throw new VideoAccessDeniedException();

        if (
          video.status === VideoStatus.PROCESSING &&
          !video.multipart_upload_id
        ) {
          return {
            videoId: video.id,
            objectKey: video.original_object_key,
            status: VideoStatus.PROCESSING as const,
          };
        }
        if (video.status !== VideoStatus.DRAFT || !video.multipart_upload_id) {
          throw new UploadNotInProgressException();
        }

        const expectedPartCount = Math.ceil(
          Number(video.original_size_bytes) / UPLOAD_PART_SIZE_BYTES,
        );
        const partNumbers = parts.map(({ partNumber }) => partNumber);
        if (
          parts.length !== expectedPartCount ||
          new Set(partNumbers).size !== parts.length ||
          partNumbers.some(
            (partNumber) =>
              !Number.isInteger(partNumber) ||
              partNumber < 1 ||
              partNumber > expectedPartCount,
          ) ||
          parts.some(
            ({ eTag }) => typeof eTag !== 'string' || eTag.trim().length === 0,
          )
        ) {
          throw new InvalidUploadPartsException();
        }

        const orderedParts = [...parts].sort(
          (left, right) => left.partNumber - right.partNumber,
        );
        await this.storage.completeMultipart(
          video.original_object_key,
          video.multipart_upload_id,
          orderedParts,
        );

        video.status = VideoStatus.PROCESSING;
        video.multipart_upload_id = null;
        await repository.save(video);
        return {
          videoId: video.id,
          objectKey: video.original_object_key,
          status: VideoStatus.PROCESSING as const,
        };
      },
    );
    await this.videoQueue.enqueue(completed.videoId, completed.objectKey);
    return { videoId: completed.videoId, status: completed.status };
  }

  async abortUpload(userId: string, videoId: string): Promise<void> {
    await this.videoRepository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(Video);
      const video = await repository.findOne({
        where: { id: videoId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!video) throw new VideoNotFoundException();
      const channel = await manager
        .getRepository(Channel)
        .findOneBy({ id: video.channel_id });
      if (!channel) throw new VideoNotFoundException();
      if (channel.user_id !== userId) throw new VideoAccessDeniedException();
      if (video.status !== VideoStatus.DRAFT || !video.multipart_upload_id) {
        throw new UploadNotInProgressException();
      }

      await this.storage.abortMultipart(
        video.original_object_key,
        video.multipart_upload_id,
      );
      video.multipart_upload_id = null;
      await repository.save(video);
    });
  }
}
