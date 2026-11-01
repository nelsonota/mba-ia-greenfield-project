import { INestApplicationContext } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { Queue, QueueEvents } from 'bullmq';
import { randomUUID } from 'node:crypto';
import queueConfig from '../config/queue.config';
import {
  PROCESS_VIDEO_JOB,
  VIDEO_PROCESSING_QUEUE,
} from '../queue/queue.constants';
import { VideoWorkerModule } from './video-worker.module';
import { VideoProcessor } from './video.processor';

describe('VideoWorkerModule', () => {
  let app: INestApplicationContext;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [VideoWorkerModule],
    }).compile();
    app = module;
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('consumes a process-video job through its registered BullMQ processor', async () => {
    expect(app.get(VideoProcessor)).toBeInstanceOf(VideoProcessor);

    const queue = app.get<Queue>(getQueueToken(VIDEO_PROCESSING_QUEUE));
    const events = new QueueEvents(VIDEO_PROCESSING_QUEUE, {
      connection: queueConfig().redis,
    });
    const jobId = `worker-module-${randomUUID()}`;
    await events.waitUntilReady();
    try {
      const job = await queue.add(
        PROCESS_VIDEO_JOB,
        { videoId: randomUUID(), sourceObjectKey: 'test/missing-video' },
        { jobId },
      );
      await job.waitUntilFinished(events, 10_000);
      await expect(job.getState()).resolves.toBe('completed');
    } finally {
      await queue.remove(jobId).catch(() => undefined);
      await events.close();
    }
  });
});
