import { DataSource, EntityManager, Repository } from 'typeorm';
import type { Job } from 'bullmq';
import { Readable } from 'node:stream';
import type { StorageAdapter } from '../storage/storage.types';
import { Video, VideoStatus } from '../videos/entities/video.entity';
import { PROCESS_VIDEO_JOB } from '../queue/queue.constants';
import { FfmpegService } from './ffmpeg.service';
import { VideoProcessor } from './video.processor';
import type {
  ProcessVideoJobData,
  ProcessedVideoMedia,
} from './video-processing.types';

/* Jest mock callbacks intentionally use async-returning implementations and method spies. */
/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */

const fixture: ProcessedVideoMedia = {
  durationSeconds: '2.5',
  metadata: {
    container: 'mov,mp4,m4a,3gp,3g2,mj2',
    videoCodec: 'mpeg4',
    width: 160,
    height: 120,
    frameRate: '24/1',
    audioCodec: null,
    bitRate: '12000',
  },
};

describe('VideoProcessor', () => {
  let processor: VideoProcessor;
  let video: Video;
  let repository: jest.Mocked<Repository<Video>>;
  let manager: jest.Mocked<EntityManager>;
  let dataSource: jest.Mocked<DataSource>;
  let storage: jest.Mocked<StorageAdapter>;
  let ffmpeg: jest.Mocked<FfmpegService>;

  beforeEach(() => {
    video = {
      id: 'f30ac265-f68e-45fb-b26a-4337ed98e3bc',
      status: VideoStatus.PROCESSING,
      source_object_key: 'videos/f30ac265-f68e-45fb-b26a-4337ed98e3bc/original',
      size_bytes: '2048',
      metadata: null,
      duration_seconds: null,
      thumbnail_object_key: null,
    } as Video;
    repository = {
      findOneBy: jest.fn().mockResolvedValue(video),
    } as unknown as jest.Mocked<Repository<Video>>;
    manager = {
      findOne: jest.fn().mockResolvedValue(video),
      save: jest.fn().mockImplementation(async (_entity, value) => value),
    } as unknown as jest.Mocked<EntityManager>;
    dataSource = {
      getRepository: jest.fn().mockReturnValue(repository),
      transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(manager)),
    } as unknown as jest.Mocked<DataSource>;
    storage = {
      getObjectStream: jest.fn().mockResolvedValue(Readable.from(['video'])),
      putObject: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<StorageAdapter>;
    ffmpeg = {
      inspectAndExtractThumbnail: jest.fn().mockResolvedValue({
        media: fixture,
        thumbnail: Buffer.from([0xff, 0xd8, 0xff]),
      }),
    } as unknown as jest.Mocked<FfmpegService>;
    processor = new VideoProcessor(dataSource, storage, ffmpeg);
  });

  it('extracts media, stores a stable thumbnail and marks the video ready', async () => {
    await processor.process(createJob());

    expect(storage.getObjectStream).toHaveBeenCalledWith(
      video.source_object_key,
    );
    expect(storage.putObject).toHaveBeenCalledWith(
      `videos/${video.id}/thumbnail.jpg`,
      Buffer.from([0xff, 0xd8, 0xff]),
      'image/jpeg',
    );
    expect(video).toMatchObject({
      status: VideoStatus.READY,
      duration_seconds: '2.5',
      metadata: fixture.metadata,
      thumbnail_object_key: `videos/${video.id}/thumbnail.jpg`,
    });
  });

  it('does not repeat completed processing when BullMQ redelivers a job', async () => {
    video.status = VideoStatus.READY;

    await expect(processor.process(createJob())).resolves.toBeUndefined();

    expect(storage.getObjectStream).not.toHaveBeenCalled();
    expect(ffmpeg.inspectAndExtractThumbnail).not.toHaveBeenCalled();
  });

  it('records only a safe failure code after the final attempt', async () => {
    ffmpeg.inspectAndExtractThumbnail.mockRejectedValueOnce(
      new Error('sensitive local path and provider response'),
    );

    await expect(processor.process(createJob(4))).rejects.toThrow(
      'sensitive local path and provider response',
    );

    expect(video.status).toBe(VideoStatus.FAILED);
    expect(video.metadata).toEqual({
      processingOutcome: {
        status: 'failed',
        code: 'VIDEO_PROCESSING_FAILED',
      },
    });
    expect(JSON.stringify(video.metadata)).not.toContain('sensitive');
  });

  it('keeps the video processing while attempts remain', async () => {
    ffmpeg.inspectAndExtractThumbnail.mockRejectedValueOnce(
      new Error('temporary decode error'),
    );

    await expect(processor.process(createJob(0))).rejects.toThrow(
      'temporary decode error',
    );

    expect(video.status).toBe(VideoStatus.PROCESSING);
  });

  function createJob(attemptsMade = 0): Job<ProcessVideoJobData> {
    return {
      name: PROCESS_VIDEO_JOB,
      data: { videoId: video.id, sourceObjectKey: video.source_object_key },
      attemptsMade,
      opts: { attempts: 5 },
    } as Job<ProcessVideoJobData>;
  }
});
