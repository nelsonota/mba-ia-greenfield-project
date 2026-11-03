import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import {
  VIDEO_QUEUE_DEFAULT_JOB_OPTIONS,
  VIDEO_PROCESSING_QUEUE,
} from './video-queue.constants';
import { VideoQueue } from './video-queue.service';

describe('VideoQueue', () => {
  let moduleRef: TestingModule;
  let videoQueue: VideoQueue;
  let queue: { add: jest.Mock };

  beforeEach(async () => {
    queue = { add: jest.fn().mockResolvedValue({ id: 'video-video-id' }) };
    moduleRef = await Test.createTestingModule({
      providers: [
        VideoQueue,
        { provide: getQueueToken(VIDEO_PROCESSING_QUEUE), useValue: queue },
      ],
    }).compile();
    videoQueue = moduleRef.get(VideoQueue);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('publishes only the video ID and opaque object key with a stable deduplication ID', async () => {
    await videoQueue.enqueue('video-id', 'original/opaque-key');

    expect(queue.add).toHaveBeenCalledWith(
      'process-video',
      { videoId: 'video-id', objectKey: 'original/opaque-key' },
      { jobId: 'video-video-id' },
    );
  });

  it('configures bounded exponential retries and retains completed and failed jobs', () => {
    expect(VIDEO_QUEUE_DEFAULT_JOB_OPTIONS).toEqual({
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  });
});
