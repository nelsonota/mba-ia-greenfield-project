import { Job } from 'bullmq';
import { VideoProcessingService } from './video-processing.service';
import { VideoProcessingConsumer } from './video-processing.consumer';
import {
  PROCESS_VIDEO_JOB,
  ProcessVideoJob,
} from '../videos/queue/video-queue.constants';

describe('VideoProcessingConsumer', () => {
  let consumer: VideoProcessingConsumer;
  let processingService: { processVideo: jest.Mock; markFailed: jest.Mock };

  beforeEach(() => {
    processingService = {
      processVideo: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    consumer = new VideoProcessingConsumer(
      processingService as unknown as VideoProcessingService,
    );
  });

  function job(attemptsMade: number): Job<ProcessVideoJob> {
    return {
      id: 'video-job-id',
      name: PROCESS_VIDEO_JOB,
      data: { videoId: 'video-id', objectKey: 'original/opaque-key' },
      attemptsMade,
      opts: { attempts: 3 },
    } as Job<ProcessVideoJob>;
  }

  it('passes the video identity and original key to the processing service', async () => {
    await consumer.process(job(0));

    expect(processingService.processVideo).toHaveBeenCalledWith(
      'video-id',
      'original/opaque-key',
    );
    expect(processingService.markFailed).not.toHaveBeenCalled();
  });

  it('leaves intermediate failures retryable and marks only the terminal attempt failed', async () => {
    processingService.processVideo.mockRejectedValue(
      new Error('transcode failed'),
    );

    await expect(consumer.process(job(1))).rejects.toThrow('transcode failed');
    expect(processingService.markFailed).not.toHaveBeenCalled();

    await expect(consumer.process(job(2))).rejects.toThrow('transcode failed');
    expect(processingService.markFailed).toHaveBeenCalledWith('video-id');
  });
});
