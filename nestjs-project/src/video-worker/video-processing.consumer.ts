import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, Job } from 'bullmq';
import { VideoProcessingService } from './video-processing.service';
import {
  PROCESS_VIDEO_JOB,
  ProcessVideoJob,
  VIDEO_PROCESSING_QUEUE,
} from '../videos/queue/video-queue.constants';

const workerConcurrency = parseInt(
  process.env.VIDEO_WORKER_CONCURRENCY ?? '2',
  10,
);

@Processor(VIDEO_PROCESSING_QUEUE, { concurrency: workerConcurrency })
export class VideoProcessingConsumer extends WorkerHost {
  constructor(private readonly videoProcessingService: VideoProcessingService) {
    super();
  }

  async process(job: Job<ProcessVideoJob>): Promise<void> {
    if (
      job.name !== PROCESS_VIDEO_JOB ||
      !job.data ||
      typeof job.data.videoId !== 'string' ||
      typeof job.data.objectKey !== 'string'
    ) {
      throw new UnrecoverableError(
        `Invalid video processing job payload: ${job.id}`,
      );
    }

    try {
      await this.videoProcessingService.processVideo(
        job.data.videoId,
        job.data.objectKey,
      );
    } catch (error) {
      const attempts = job.opts.attempts ?? 1;
      if (job.attemptsMade + 1 >= attempts) {
        await this.videoProcessingService.markFailed(job.data.videoId);
      }
      throw error;
    }
  }
}
