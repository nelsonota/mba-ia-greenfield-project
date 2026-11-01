import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { STORAGE_ADAPTER } from '../storage/storage.constants';
import type { StorageAdapter } from '../storage/storage.types';
import { Video, VideoStatus } from '../videos/entities/video.entity';
import {
  VIDEO_PROCESSING_QUEUE,
  PROCESS_VIDEO_JOB,
} from '../queue/queue.constants';
import { FfmpegService } from './ffmpeg.service';
import type { ProcessVideoJobData } from './video-processing.types';

const THUMBNAIL_CONTENT_TYPE = 'image/jpeg';
const FAILED_OUTCOME = {
  status: 'failed',
  code: 'VIDEO_PROCESSING_FAILED',
} as const;

@Injectable()
@Processor(VIDEO_PROCESSING_QUEUE, { concurrency: 1 })
export class VideoProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessor.name);

  constructor(
    private readonly dataSource: DataSource,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly ffmpeg: FfmpegService,
  ) {
    super();
  }

  async process(job: Job<ProcessVideoJobData>): Promise<void> {
    if (job.name !== PROCESS_VIDEO_JOB || !job.data?.videoId) {
      throw new Error('VIDEO_PROCESSING_JOB_INVALID');
    }

    const video = await this.dataSource.getRepository(Video).findOneBy({
      id: job.data.videoId,
    });
    if (!video || video.status !== VideoStatus.PROCESSING) return;

    try {
      const source = await this.storage.getObjectStream(
        video.source_object_key,
      );
      const result = await this.ffmpeg.inspectAndExtractThumbnail(
        source,
        video.duration_seconds ?? '0',
      );
      const thumbnailObjectKey = `videos/${video.id}/thumbnail.jpg`;
      await this.storage.putObject(
        thumbnailObjectKey,
        result.thumbnail,
        THUMBNAIL_CONTENT_TYPE,
      );

      await this.dataSource.transaction(async (manager) => {
        const current = await manager.findOne(Video, {
          where: { id: video.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!current || current.status !== VideoStatus.PROCESSING) return;

        current.duration_seconds = result.media.durationSeconds;
        current.metadata = { ...result.media.metadata };
        current.thumbnail_object_key = thumbnailObjectKey;
        current.status = VideoStatus.READY;
        await manager.save(Video, current);
      });
      this.logger.log(`Processed video ${video.id}`);
    } catch (error) {
      if (this.isFinalAttempt(job)) await this.markFailed(video.id);
      throw error;
    }
  }

  private isFinalAttempt(job: Job<ProcessVideoJobData>): boolean {
    const maximumAttempts = job.opts.attempts ?? 1;
    return job.attemptsMade + 1 >= maximumAttempts;
  }

  private async markFailed(videoId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const current = await manager.findOne(Video, {
        where: { id: videoId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current || current.status !== VideoStatus.PROCESSING) return;
      current.status = VideoStatus.FAILED;
      current.metadata = {
        ...(current.metadata ?? {}),
        processingOutcome: FAILED_OUTCOME,
      };
      await manager.save(Video, current);
    });
    this.logger.warn(`Video ${videoId} reached its processing retry limit`);
  }
}
