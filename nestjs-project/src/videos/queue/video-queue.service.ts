import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  PROCESS_VIDEO_JOB,
  ProcessVideoJob,
  VIDEO_PROCESSING_QUEUE,
} from './video-queue.constants';

@Injectable()
export class VideoQueue {
  constructor(
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly queue: Queue<ProcessVideoJob>,
  ) {}

  async enqueue(videoId: string, objectKey: string): Promise<void> {
    await this.queue.add(
      PROCESS_VIDEO_JOB,
      { videoId, objectKey },
      { jobId: `video-${videoId}` },
    );
  }
}
