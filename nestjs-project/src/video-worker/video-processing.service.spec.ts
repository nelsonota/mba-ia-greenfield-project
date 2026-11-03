import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Readable } from 'node:stream';
import { writeFile } from 'node:fs/promises';
import { Video, VideoStatus } from '../videos/entities/video.entity';
import { VideoStorageService } from '../videos/storage/video-storage.service';
import { VideoProcessingService } from './video-processing.service';
import { VideoTranscoderService } from './video-transcoder.service';

describe('VideoProcessingService', () => {
  let moduleRef: TestingModule;
  let service: VideoProcessingService;
  let video: Video;
  let videoRepository: {
    findOne: jest.Mock;
    findOneOrFail: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let storage: { getObject: jest.Mock; putStream: jest.Mock };
  let transcoder: {
    probe: jest.Mock;
    createThumbnail: jest.Mock;
    transcodeToMp4: jest.Mock;
  };

  beforeEach(async () => {
    video = Object.assign(new Video(), {
      id: 'video-id',
      channel_id: 'channel-id',
      status: VideoStatus.PROCESSING,
      original_object_key: 'original/opaque-key',
      original_size_bytes: '1000',
      original_content_type: 'video/mp4',
      processed_object_key: null,
      thumbnail_object_key: null,
      duration_seconds: null,
    });
    videoRepository = {
      findOne: jest.fn().mockImplementation(() => video),
      findOneOrFail: jest.fn().mockImplementation(() => video),
      save: jest.fn().mockImplementation((saved: Video) => saved),
      update: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
    };
    const entityManager = {
      getRepository: jest.fn().mockReturnValue(videoRepository),
    };
    Object.assign(videoRepository, {
      manager: {
        transaction: jest.fn(
          (callback: (manager: typeof entityManager) => Promise<unknown>) =>
            callback(entityManager),
        ),
      },
    });
    storage = {
      getObject: jest
        .fn()
        .mockResolvedValue({ body: Readable.from(['original-data']) }),
      putStream: jest.fn(async (_key: string, body: Readable) => {
        for await (const _chunk of body) {
          // Consume the upload stream as the storage adapter does.
          void _chunk;
        }
      }),
    };
    transcoder = {
      probe: jest.fn().mockResolvedValue({ durationSeconds: 123.4 }),
      createThumbnail: jest.fn(
        (_input: string, _seek: number, outputPath: string) =>
          writeFile(outputPath, 'jpeg'),
      ),
      transcodeToMp4: jest.fn((_input: string, outputPath: string) =>
        writeFile(outputPath, 'mp4'),
      ),
    };

    moduleRef = await Test.createTestingModule({
      providers: [
        VideoProcessingService,
        { provide: getRepositoryToken(Video), useValue: videoRepository },
        { provide: VideoStorageService, useValue: storage },
        { provide: VideoTranscoderService, useValue: transcoder },
      ],
    }).compile();
    service = moduleRef.get(VideoProcessingService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('downloads, probes, transcodes, uploads outputs and persists metadata', async () => {
    await service.processVideo('video-id', 'original/opaque-key');

    expect(storage.getObject).toHaveBeenCalledWith('original/opaque-key');
    expect(transcoder.probe).toHaveBeenCalledWith(
      expect.stringContaining('original'),
    );
    expect(transcoder.createThumbnail).toHaveBeenCalledWith(
      expect.any(String),
      10,
      expect.stringContaining('thumbnail.jpg'),
    );
    expect(transcoder.transcodeToMp4).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('normalized.mp4'),
    );
    expect(storage.putStream).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/^processed\/[0-9a-f-]{36}\.mp4$/),
      expect.any(Readable),
      'video/mp4',
    );
    expect(storage.putStream).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/^thumbnails\/[0-9a-f-]{36}\.jpg$/),
      expect.any(Readable),
      'image/jpeg',
    );
    expect(video).toMatchObject({
      status: VideoStatus.READY,
      duration_seconds: 124,
      original_object_key: 'original/opaque-key',
    });
    expect(video.processed_object_key).toMatch(/^processed\//);
    expect(video.thumbnail_object_key).toMatch(/^thumbnails\//);
  });

  it('does not create duplicate outputs for a video already ready', async () => {
    Object.assign(video, {
      status: VideoStatus.READY,
      processed_object_key: 'processed/existing.mp4',
      thumbnail_object_key: 'thumbnails/existing.jpg',
      duration_seconds: 124,
    });

    await service.processVideo('video-id', 'original/opaque-key');

    expect(storage.getObject).not.toHaveBeenCalled();
    expect(storage.putStream).not.toHaveBeenCalled();
    expect(transcoder.probe).not.toHaveBeenCalled();
  });

  it('rejects jobs whose object key does not match the video record', async () => {
    await expect(
      service.processVideo('video-id', 'original/other-key'),
    ).rejects.toThrow(
      'Processing job object key does not match the video record',
    );
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it('preserves reserved output keys on failure and marks terminal processing failures', async () => {
    transcoder.transcodeToMp4.mockRejectedValue(new Error('ffmpeg failed'));

    await expect(
      service.processVideo('video-id', 'original/opaque-key'),
    ).rejects.toThrow('ffmpeg failed');
    expect(video.status).toBe(VideoStatus.PROCESSING);
    expect(video.original_object_key).toBe('original/opaque-key');
    expect(video.processed_object_key).toMatch(/^processed\//);
    expect(video.thumbnail_object_key).toMatch(/^thumbnails\//);

    await service.markFailed('video-id');
    expect(videoRepository.update).toHaveBeenCalledWith(
      { id: 'video-id', status: VideoStatus.PROCESSING },
      { status: VideoStatus.FAILED },
    );
  });
});
