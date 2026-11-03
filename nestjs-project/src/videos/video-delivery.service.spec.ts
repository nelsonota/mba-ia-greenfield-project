import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { Video, VideoStatus, VideoVisibility } from './entities/video.entity';
import {
  VideoAccessDeniedException,
  VideoNotFoundException,
  VideoNotReadyException,
} from './exceptions/video-upload.exceptions';
import { VideoStorageService } from './storage/video-storage.service';
import { VideoDeliveryService } from './video-delivery.service';

describe('VideoDeliveryService', () => {
  let moduleRef: TestingModule;
  let service: VideoDeliveryService;
  let videoRepository: { findOne: jest.Mock };
  let storage: { signGetObject: jest.Mock };
  let video: Video;

  beforeEach(async () => {
    video = Object.assign(new Video(), {
      id: 'video-id',
      channel_id: 'channel-id',
      channel: { user_id: 'owner-id' } as Channel,
      status: VideoStatus.READY,
      original_object_key: 'original/opaque-key',
      processed_object_key: 'processed/opaque-key.mp4',
      visibility: VideoVisibility.PUBLIC,
      published_at: new Date('2026-11-03T13:00:00.000Z'),
    });
    videoRepository = { findOne: jest.fn().mockResolvedValue(video) };
    storage = {
      signGetObject: jest.fn().mockResolvedValue({
        url: 'http://storage.example/signed',
        expiresAt: new Date('2026-11-03T13:15:00.000Z'),
      }),
    };
    moduleRef = await Test.createTestingModule({
      providers: [
        VideoDeliveryService,
        { provide: getRepositoryToken(Video), useValue: videoRepository },
        { provide: VideoStorageService, useValue: storage },
      ],
    }).compile();
    service = moduleRef.get(VideoDeliveryService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('signs the normalized MP4 for a published public ready video', async () => {
    await expect(service.playback('video-id')).resolves.toMatchObject({
      url: 'http://storage.example/signed',
    });
    expect(videoRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'video-id' },
      relations: { channel: true },
    });
    expect(storage.signGetObject).toHaveBeenCalledWith(
      'processed/opaque-key.mp4',
    );
  });

  it('lets the owner play an unpublished ready video', async () => {
    video.published_at = null;

    await service.playback('video-id', 'owner-id');

    expect(storage.signGetObject).toHaveBeenCalledWith(
      'processed/opaque-key.mp4',
    );
  });

  it('does not sign an unpublished ready video for another requester', async () => {
    video.published_at = null;

    await expect(
      service.playback('video-id', 'other-id'),
    ).rejects.toBeInstanceOf(VideoAccessDeniedException);
    expect(storage.signGetObject).not.toHaveBeenCalled();
  });

  it('returns not ready when a public video has no processed output', async () => {
    video.status = VideoStatus.PROCESSING;
    video.processed_object_key = null;

    await expect(service.playback('video-id')).rejects.toBeInstanceOf(
      VideoNotReadyException,
    );
    expect(storage.signGetObject).not.toHaveBeenCalled();
  });

  it('returns not found when the UUID does not resolve', async () => {
    videoRepository.findOne.mockResolvedValue(null);

    await expect(service.playback('missing-id')).rejects.toBeInstanceOf(
      VideoNotFoundException,
    );
    expect(storage.signGetObject).not.toHaveBeenCalled();
  });

  it('signs the original object with attachment disposition for the owner', async () => {
    await service.download('video-id', 'owner-id');

    expect(storage.signGetObject).toHaveBeenCalledWith(
      'original/opaque-key',
      'attachment; filename="video-video-id"',
    );
  });

  it('does not sign a download URL for a non-owner', async () => {
    await expect(
      service.download('video-id', 'other-id'),
    ).rejects.toBeInstanceOf(VideoAccessDeniedException);
    expect(storage.signGetObject).not.toHaveBeenCalled();
  });
});
