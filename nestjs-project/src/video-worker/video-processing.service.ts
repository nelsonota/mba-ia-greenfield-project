import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { EntityManager, Repository } from 'typeorm';
import { Video, VideoStatus } from '../videos/entities/video.entity';
import { VideoStorageService } from '../videos/storage/video-storage.service';
import { VideoNotFoundException } from '../videos/exceptions/video-upload.exceptions';
import { VideoTranscoderService } from './video-transcoder.service';

interface ProcessingState {
  skip: boolean;
  videoId: string;
  objectKey: string;
  contentType: string;
  processedObjectKey: string | null;
  thumbnailObjectKey: string | null;
}

@Injectable()
export class VideoProcessingService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storage: VideoStorageService,
    private readonly transcoder: VideoTranscoderService,
  ) {}

  async processVideo(videoId: string, objectKey: string): Promise<void> {
    const state = await this.videoRepository.manager.transaction(
      async (manager) => {
        const repository = manager.getRepository(Video);
        const video = await repository.findOne({
          where: { id: videoId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!video) throw new VideoNotFoundException();
        if (video.original_object_key !== objectKey) {
          throw new Error(
            'Processing job object key does not match the video record',
          );
        }

        if (video.status === VideoStatus.READY) {
          return {
            skip: true,
            videoId,
            objectKey,
            contentType: video.original_content_type,
            processedObjectKey: video.processed_object_key,
            thumbnailObjectKey: video.thumbnail_object_key,
          } satisfies ProcessingState;
        }
        if (
          video.status !== VideoStatus.PROCESSING &&
          video.status !== VideoStatus.FAILED
        ) {
          throw new Error(`Video ${videoId} is not eligible for processing`);
        }

        video.status = VideoStatus.PROCESSING;
        video.processed_object_key ??= `processed/${randomUUID()}.mp4`;
        video.thumbnail_object_key ??= `thumbnails/${randomUUID()}.jpg`;
        await repository.save(video);
        return {
          skip: false,
          videoId,
          objectKey,
          contentType: video.original_content_type,
          processedObjectKey: video.processed_object_key,
          thumbnailObjectKey: video.thumbnail_object_key,
        } satisfies ProcessingState;
      },
    );
    if (state.skip) return;

    const directory = await mkdtemp(join(tmpdir(), 'streamtube-video-'));
    const originalPath = join(directory, 'original');
    const processedPath = join(directory, 'normalized.mp4');
    const thumbnailPath = join(directory, 'thumbnail.jpg');

    try {
      const original = await this.storage.getObject(state.objectKey);
      await pipeline(original.body, createWriteStream(originalPath));

      const metadata = await this.transcoder.probe(originalPath);
      const thumbnailSeek = Math.min(metadata.durationSeconds / 2, 10);
      await this.transcoder.createThumbnail(
        originalPath,
        thumbnailSeek,
        thumbnailPath,
      );
      await this.transcoder.transcodeToMp4(originalPath, processedPath);

      if (!state.processedObjectKey || !state.thumbnailObjectKey) {
        throw new Error(`Video ${videoId} has no reserved output keys`);
      }
      await this.storage.putStream(
        state.processedObjectKey,
        createReadStream(processedPath),
        'video/mp4',
      );
      await this.storage.putStream(
        state.thumbnailObjectKey,
        createReadStream(thumbnailPath),
        'image/jpeg',
      );

      await this.videoRepository.manager.transaction(async (manager) => {
        const video = await this.getLockedVideo(manager, videoId);
        if (video.status === VideoStatus.READY) return;
        if (video.status !== VideoStatus.PROCESSING) {
          throw new Error(
            `Video ${videoId} left processing before output persistence`,
          );
        }
        video.processed_object_key = state.processedObjectKey;
        video.thumbnail_object_key = state.thumbnailObjectKey;
        video.duration_seconds = Math.ceil(metadata.durationSeconds);
        video.status = VideoStatus.READY;
        await manager.getRepository(Video).save(video);
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async markFailed(videoId: string): Promise<void> {
    await this.videoRepository.update(
      { id: videoId, status: VideoStatus.PROCESSING },
      { status: VideoStatus.FAILED },
    );
  }

  private getLockedVideo(
    manager: EntityManager,
    videoId: string,
  ): Promise<Video> {
    return manager.getRepository(Video).findOneOrFail({
      where: { id: videoId },
      lock: { mode: 'pessimistic_write' },
    });
  }
}
