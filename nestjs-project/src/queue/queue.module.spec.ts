import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import queueConfig from '../config/queue.config';
import {
  PROCESS_VIDEO_JOB,
  VIDEO_PROCESSING_DEFAULT_JOB_OPTIONS,
  VIDEO_PROCESSING_QUEUE,
} from './queue.constants';
import { QueueModule } from './queue.module';

describe('QueueModule', () => {
  it('compiles, accepts process-video jobs with retry settings, and closes cleanly', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [queueConfig] }),
        QueueModule,
      ],
    }).compile();

    const queue = module.get<Queue>(getQueueToken(VIDEO_PROCESSING_QUEUE));
    expect(queue.name).toBe(VIDEO_PROCESSING_QUEUE);
    expect(queue.opts.defaultJobOptions).toMatchObject(
      VIDEO_PROCESSING_DEFAULT_JOB_OPTIONS,
    );

    const job = await queue.add(PROCESS_VIDEO_JOB, { videoId: 'module-test' });
    expect(job.name).toBe(PROCESS_VIDEO_JOB);
    expect(job.opts.attempts).toBe(
      VIDEO_PROCESSING_DEFAULT_JOB_OPTIONS.attempts,
    );
    expect(job.opts.backoff).toEqual(
      VIDEO_PROCESSING_DEFAULT_JOB_OPTIONS.backoff,
    );

    await job.remove();
    await expect(module.close()).resolves.toBeUndefined();
  });
});
