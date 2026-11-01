import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import {
  IdempotencyConflictException,
  InvalidUploadRequestException,
  StorageUnavailableException,
  VideoTooLargeException,
} from '../common/exceptions/domain.exception';
import { STORAGE_ADAPTER } from '../storage/storage.constants';
import type { StorageAdapter } from '../storage/storage.types';
import { CreateVideoDto } from './dto/create-video.dto';
import { CreateVideoResponseDto } from './dto/create-video-response.dto';
import { Video, VideoStatus } from './entities/video.entity';
import {
  IDEMPOTENCY_KEY_MAX_LENGTH,
  MAX_VIDEO_SIZE_BYTES,
} from './videos.constants';

const IDEMPOTENCY_UNIQUE_CONSTRAINT = 'UQ_videos_owner_idempotency_key';

@Injectable()
export class VideosService {
  private readonly logger = new Logger(VideosService.name);

  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly dataSource: DataSource,
    @Inject(STORAGE_ADAPTER)
    private readonly storage: StorageAdapter,
  ) {}

  async createDraft(
    ownerId: string,
    idempotencyKey: string | undefined,
    input: CreateVideoDto,
  ): Promise<CreateVideoResponseDto> {
    this.validateIdempotencyKey(idempotencyKey);
    if (input.sizeBytes > MAX_VIDEO_SIZE_BYTES) {
      throw new VideoTooLargeException();
    }

    const key = idempotencyKey;
    const video = await this.findOrCreateDraft(ownerId, key, input);
    if (video.multipart_upload_id || video.status !== VideoStatus.DRAFT) {
      return this.toResponse(video);
    }

    const initialized = await this.ensureMultipartSession(video.id);
    return this.toResponse(initialized);
  }

  private async findOrCreateDraft(
    ownerId: string,
    idempotencyKey: string,
    input: CreateVideoDto,
  ): Promise<Video> {
    let video = await this.videoRepository.findOneBy({
      owner_id: ownerId,
      idempotency_key: idempotencyKey,
    });

    if (!video) {
      const id = randomUUID();
      const candidate = this.videoRepository.create({
        id,
        owner_id: ownerId,
        status: VideoStatus.DRAFT,
        idempotency_key: idempotencyKey,
        source_object_key: `videos/${id}/original`,
        multipart_upload_id: null,
        file_name: input.fileName,
        content_type: input.contentType,
        size_bytes: String(input.sizeBytes),
      });

      try {
        video = await this.videoRepository.save(candidate);
      } catch (error) {
        if (!this.isIdempotencyConstraintViolation(error)) {
          throw error;
        }
        video = await this.videoRepository.findOneBy({
          owner_id: ownerId,
          idempotency_key: idempotencyKey,
        });
        if (!video) {
          throw error;
        }
      }
    }

    if (!this.matchesRequest(video, input)) {
      throw new IdempotencyConflictException();
    }

    return video;
  }

  private async ensureMultipartSession(videoId: string): Promise<Video> {
    let openedUpload: { key: string; uploadId: string } | undefined;
    let storageFailed = false;

    try {
      const video = await this.dataSource.transaction(async (manager) => {
        const current = await manager.findOne(Video, {
          where: { id: videoId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!current) {
          throw new Error(
            `Video draft ${videoId} disappeared during upload initialization`,
          );
        }
        if (
          current.multipart_upload_id ||
          current.status !== VideoStatus.DRAFT
        ) {
          return current;
        }

        let uploadId: string;
        try {
          uploadId = await this.storage.createMultipartUpload(
            current.source_object_key,
            current.content_type,
          );
        } catch {
          storageFailed = true;
          return current;
        }

        openedUpload = { key: current.source_object_key, uploadId };
        current.multipart_upload_id = uploadId;
        return manager.save(Video, current);
      });

      openedUpload = undefined;
      if (storageFailed) {
        throw new StorageUnavailableException();
      }
      return video;
    } catch (error) {
      await this.abortOpenedUpload(openedUpload);
      throw error;
    }
  }

  private async abortOpenedUpload(
    upload: { key: string; uploadId: string } | undefined,
  ): Promise<void> {
    if (!upload) {
      return;
    }

    try {
      await this.storage.abortMultipartUpload(upload.key, upload.uploadId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(
        `Could not abort storage upload ${upload.uploadId} after database failure: ${message}`,
      );
    }
  }

  private validateIdempotencyKey(
    key: string | undefined,
  ): asserts key is string {
    if (
      typeof key !== 'string' ||
      key.trim().length === 0 ||
      key.length > IDEMPOTENCY_KEY_MAX_LENGTH ||
      /[\r\n]/.test(key)
    ) {
      throw new InvalidUploadRequestException();
    }
  }

  private matchesRequest(video: Video, input: CreateVideoDto): boolean {
    return (
      video.file_name === input.fileName &&
      video.content_type === input.contentType &&
      BigInt(video.size_bytes) === BigInt(input.sizeBytes)
    );
  }

  private isIdempotencyConstraintViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    const driverError = error.driverError as {
      code?: string;
      constraint?: string;
    };
    return (
      driverError.code === '23505' &&
      driverError.constraint === IDEMPOTENCY_UNIQUE_CONSTRAINT
    );
  }

  private toResponse(video: Video): CreateVideoResponseDto {
    return {
      videoId: video.id,
      status: video.status,
      upload: video.multipart_upload_id
        ? { uploadId: video.multipart_upload_id }
        : null,
    };
  }
}
