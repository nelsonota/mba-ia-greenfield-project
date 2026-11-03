import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { Video, VideoStatus } from './entities/video.entity';
import {
  InvalidUploadPartsException,
  InvalidPartNumbersException,
  UploadNotInProgressException,
  VideoAccessDeniedException,
  VideoNotFoundException,
} from './exceptions/video-upload.exceptions';
import { VideoStorageService } from './storage/video-storage.service';
import { VideoQueue } from './queue/video-queue.service';
import { UPLOAD_PART_SIZE_BYTES } from './video-upload.constants';
import { VideoUploadService } from './video-upload.service';

describe('VideoUploadService', () => {
  let moduleRef: TestingModule;
  let service: VideoUploadService;
  let videoRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    delete: jest.Mock;
  };
  let channelRepository: { findOneBy: jest.Mock };
  let storage: {
    initiateMultipart: jest.Mock;
    completeMultipart: jest.Mock;
    abortMultipart: jest.Mock;
    signUploadPart: jest.Mock;
  };
  let transactionalVideoRepository: { findOne: jest.Mock; save: jest.Mock };
  let transactionalChannelRepository: { findOneBy: jest.Mock };
  let videoQueue: { enqueue: jest.Mock };

  beforeEach(async () => {
    videoRepository = {
      create: jest.fn((input: Partial<Video>) =>
        Object.assign(new Video(), input),
      ),
      save: jest.fn((input: Partial<Video>) =>
        Promise.resolve(Object.assign(new Video(), input, { id: 'video-id' })),
      ),
      findOne: jest.fn(),
      delete: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
    };
    channelRepository = { findOneBy: jest.fn() };
    storage = {
      initiateMultipart: jest.fn().mockResolvedValue('multipart-id'),
      completeMultipart: jest.fn().mockResolvedValue(undefined),
      abortMultipart: jest.fn().mockResolvedValue(undefined),
      signUploadPart: jest.fn().mockResolvedValue({
        url: 'http://localhost:9002/streamtube-videos/signed-part',
        expiresAt: new Date('2026-11-03T12:15:00.000Z'),
      }),
    };
    transactionalVideoRepository = {
      findOne: jest.fn(),
      save: jest.fn((video: Video) => Promise.resolve(video)),
    };
    transactionalChannelRepository = {
      findOneBy: jest
        .fn()
        .mockResolvedValue({ id: 'channel-id', user_id: 'owner-id' }),
    };
    videoQueue = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const entityManager = {
      getRepository: jest.fn((entity) =>
        entity === Video
          ? transactionalVideoRepository
          : transactionalChannelRepository,
      ),
    };
    Object.assign(videoRepository, {
      manager: {
        transaction: jest.fn(
          (callback: (manager: typeof entityManager) => Promise<unknown>) =>
            callback(entityManager),
        ),
      },
    });

    moduleRef = await Test.createTestingModule({
      providers: [
        VideoUploadService,
        { provide: getRepositoryToken(Video), useValue: videoRepository },
        { provide: getRepositoryToken(Channel), useValue: channelRepository },
        { provide: VideoStorageService, useValue: storage },
        { provide: VideoQueue, useValue: videoQueue },
      ],
    }).compile();
    service = moduleRef.get(VideoUploadService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('persists the draft before initializing multipart and stores the returned upload ID', async () => {
    const events: string[] = [];
    channelRepository.findOneBy.mockResolvedValue({
      id: 'channel-id',
      user_id: 'owner-id',
    });
    videoRepository.save.mockImplementation((input: Partial<Video>) => {
      events.push('save');
      return Object.assign(new Video(), input, { id: 'video-id' });
    });
    storage.initiateMultipart.mockImplementation(() => {
      events.push('initiate');
      return Promise.resolve('multipart-id');
    });

    const result = await service.startUpload('owner-id', {
      originalFilename: 'lecture.mp4',
      contentType: 'video/mp4',
      sizeBytes: UPLOAD_PART_SIZE_BYTES + 1,
    });

    expect(events).toEqual(['save', 'initiate', 'save']);
    expect(result).toEqual({
      videoId: 'video-id',
      status: VideoStatus.DRAFT,
      partSizeBytes: UPLOAD_PART_SIZE_BYTES,
      partCount: 2,
    });
    const saveCalls = videoRepository.save.mock.calls as Array<[Video]>;
    const firstDraft = saveCalls[0][0];
    const persistedDraft = saveCalls[1][0];
    expect(firstDraft).toMatchObject({
      channel_id: 'channel-id',
      status: VideoStatus.DRAFT,
      multipart_upload_id: null,
      original_size_bytes: String(UPLOAD_PART_SIZE_BYTES + 1),
      original_content_type: 'video/mp4',
    });
    expect(persistedDraft.multipart_upload_id).toBe('multipart-id');
    expect(firstDraft.original_object_key).toMatch(/^original\/[0-9a-f-]{36}$/);
    expect(storage.initiateMultipart).toHaveBeenCalledWith(
      firstDraft.original_object_key,
      'video/mp4',
    );
  });

  it('removes the draft when storage cannot initialize multipart', async () => {
    channelRepository.findOneBy.mockResolvedValue({
      id: 'channel-id',
      user_id: 'owner-id',
    });
    storage.initiateMultipart.mockRejectedValue(
      new Error('storage unavailable'),
    );

    await expect(
      service.startUpload('owner-id', {
        originalFilename: 'lecture.mp4',
        contentType: 'video/mp4',
        sizeBytes: 12,
      }),
    ).rejects.toThrow('storage unavailable');
    expect(videoRepository.delete).toHaveBeenCalledWith({ id: 'video-id' });
  });

  it('aborts multipart and removes the draft when saving its upload ID fails', async () => {
    channelRepository.findOneBy.mockResolvedValue({
      id: 'channel-id',
      user_id: 'owner-id',
    });
    videoRepository.save
      .mockResolvedValueOnce(
        Object.assign(new Video(), {
          id: 'video-id',
          original_object_key: 'original/key',
        }),
      )
      .mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      service.startUpload('owner-id', {
        originalFilename: 'lecture.mp4',
        contentType: 'video/mp4',
        sizeBytes: 12,
      }),
    ).rejects.toThrow('database unavailable');
    const saveCalls = videoRepository.save.mock.calls as Array<[Video]>;
    const draft = saveCalls[0][0];
    expect(storage.abortMultipart).toHaveBeenCalledWith(
      draft.original_object_key,
      'multipart-id',
    );
    expect(videoRepository.delete).toHaveBeenCalledWith({ id: 'video-id' });
  });

  it('signs requested parts only when the requester owns the active draft', async () => {
    videoRepository.findOne.mockResolvedValue(
      Object.assign(new Video(), {
        id: 'video-id',
        channel: { user_id: 'owner-id' },
        status: VideoStatus.DRAFT,
        original_object_key: 'original/private-key',
        multipart_upload_id: 'multipart-id',
        original_size_bytes: String(UPLOAD_PART_SIZE_BYTES + 1),
      }),
    );

    const result = await service.signUploadParts(
      'owner-id',
      'video-id',
      [2, 1],
    );

    expect(result.parts).toHaveLength(2);
    expect(result.parts.map((part) => part.partNumber)).toEqual([2, 1]);
    expect(storage.signUploadPart).toHaveBeenNthCalledWith(
      1,
      'original/private-key',
      'multipart-id',
      2,
    );
    expect(storage.signUploadPart).toHaveBeenNthCalledWith(
      2,
      'original/private-key',
      'multipart-id',
      1,
    );
  });

  it('rejects part numbers outside the video part count', async () => {
    const activeVideo = Object.assign(new Video(), {
      id: 'video-id',
      channel: { user_id: 'owner-id' },
      status: VideoStatus.DRAFT,
      original_object_key: 'original/private-key',
      multipart_upload_id: 'multipart-id',
      original_size_bytes: String(UPLOAD_PART_SIZE_BYTES + 1),
    });
    videoRepository.findOne.mockResolvedValue(activeVideo);
    await expect(
      service.signUploadParts('owner-id', 'video-id', [3]),
    ).rejects.toBeInstanceOf(InvalidPartNumbersException);
    expect(storage.signUploadPart).not.toHaveBeenCalled();
  });

  it('rejects requests from users who do not own the draft', async () => {
    videoRepository.findOne.mockResolvedValue(
      Object.assign(new Video(), {
        id: 'video-id',
        channel: { user_id: 'owner-id' },
        status: VideoStatus.DRAFT,
        original_object_key: 'original/private-key',
        multipart_upload_id: 'multipart-id',
        original_size_bytes: String(UPLOAD_PART_SIZE_BYTES + 1),
      }),
    );

    await expect(
      service.signUploadParts('other-id', 'video-id', [1]),
    ).rejects.toBeInstanceOf(VideoAccessDeniedException);
    expect(storage.signUploadPart).not.toHaveBeenCalled();
  });

  it('returns not found when the video ID does not exist', async () => {
    videoRepository.findOne.mockResolvedValueOnce(null);
    await expect(
      service.signUploadParts('owner-id', 'missing-id', [1]),
    ).rejects.toBeInstanceOf(VideoNotFoundException);
  });

  it('rejects a draft whose multipart upload is no longer active', async () => {
    videoRepository.findOne.mockResolvedValue(
      Object.assign(new Video(), {
        id: 'video-id',
        channel: { user_id: 'owner-id' },
        status: VideoStatus.DRAFT,
        original_object_key: 'original/private-key',
        multipart_upload_id: null,
        original_size_bytes: String(UPLOAD_PART_SIZE_BYTES + 1),
      }),
    );
    await expect(
      service.signUploadParts('owner-id', 'video-id', [1]),
    ).rejects.toBeInstanceOf(UploadNotInProgressException);
  });

  it('completes ordered parts and persists processing only after storage confirms the object', async () => {
    const video = Object.assign(new Video(), {
      id: 'video-id',
      channel: { user_id: 'owner-id' },
      status: VideoStatus.DRAFT,
      original_object_key: 'original/private-key',
      multipart_upload_id: 'multipart-id',
      original_size_bytes: String(UPLOAD_PART_SIZE_BYTES + 1),
    });
    transactionalVideoRepository.findOne.mockResolvedValue(video);
    const events: string[] = [];
    storage.completeMultipart.mockImplementation(() => {
      events.push('complete');
      return Promise.resolve();
    });
    transactionalVideoRepository.save.mockImplementation((saved: Video) => {
      events.push('save');
      return saved;
    });

    const result = await service.completeUpload('owner-id', 'video-id', [
      { partNumber: 2, eTag: 'etag-two' },
      { partNumber: 1, eTag: 'etag-one' },
    ]);

    expect(result).toEqual({
      videoId: 'video-id',
      status: VideoStatus.PROCESSING,
    });
    expect(events).toEqual(['complete', 'save']);
    expect(storage.completeMultipart).toHaveBeenCalledWith(
      'original/private-key',
      'multipart-id',
      [
        { partNumber: 1, eTag: 'etag-one' },
        { partNumber: 2, eTag: 'etag-two' },
      ],
    );
    expect(video).toMatchObject({
      status: VideoStatus.PROCESSING,
      multipart_upload_id: null,
    });
    expect(videoQueue.enqueue).toHaveBeenCalledWith(
      'video-id',
      'original/private-key',
    );
  });

  it('returns processing without completing storage again for a completed upload', async () => {
    transactionalVideoRepository.findOne.mockResolvedValue(
      Object.assign(new Video(), {
        id: 'video-id',
        channel: { user_id: 'owner-id' },
        status: VideoStatus.PROCESSING,
        original_object_key: 'original/private-key',
        multipart_upload_id: null,
      }),
    );

    await expect(
      service.completeUpload('owner-id', 'video-id', [
        { partNumber: 1, eTag: 'etag-one' },
      ]),
    ).resolves.toEqual({ videoId: 'video-id', status: VideoStatus.PROCESSING });
    expect(storage.completeMultipart).not.toHaveBeenCalled();
    expect(transactionalVideoRepository.save).not.toHaveBeenCalled();
    expect(videoQueue.enqueue).toHaveBeenCalledWith(
      'video-id',
      'original/private-key',
    );
  });

  it('rejects missing, duplicate or blank-Etag parts before calling storage', async () => {
    transactionalVideoRepository.findOne.mockResolvedValue(
      Object.assign(new Video(), {
        id: 'video-id',
        channel: { user_id: 'owner-id' },
        status: VideoStatus.DRAFT,
        original_object_key: 'original/private-key',
        multipart_upload_id: 'multipart-id',
        original_size_bytes: String(UPLOAD_PART_SIZE_BYTES + 1),
      }),
    );

    await expect(
      service.completeUpload('owner-id', 'video-id', [
        { partNumber: 1, eTag: 'etag-one' },
      ]),
    ).rejects.toBeInstanceOf(InvalidUploadPartsException);
    await expect(
      service.completeUpload('owner-id', 'video-id', [
        { partNumber: 1, eTag: 'etag-one' },
        { partNumber: 1, eTag: 'etag-two' },
      ]),
    ).rejects.toBeInstanceOf(InvalidUploadPartsException);
    await expect(
      service.completeUpload('owner-id', 'video-id', [
        { partNumber: 1, eTag: 'etag-one' },
        { partNumber: 2, eTag: ' ' },
      ]),
    ).rejects.toBeInstanceOf(InvalidUploadPartsException);
    expect(storage.completeMultipart).not.toHaveBeenCalled();
    expect(videoQueue.enqueue).not.toHaveBeenCalled();
  });

  it('does not mark a video processing when storage completion fails', async () => {
    const video = Object.assign(new Video(), {
      id: 'video-id',
      channel: { user_id: 'owner-id' },
      status: VideoStatus.DRAFT,
      original_object_key: 'original/private-key',
      multipart_upload_id: 'multipart-id',
      original_size_bytes: String(UPLOAD_PART_SIZE_BYTES),
    });
    transactionalVideoRepository.findOne.mockResolvedValue(video);
    storage.completeMultipart.mockRejectedValue(
      new InvalidUploadPartsException(),
    );

    await expect(
      service.completeUpload('owner-id', 'video-id', [
        { partNumber: 1, eTag: 'invalid-etag' },
      ]),
    ).rejects.toBeInstanceOf(InvalidUploadPartsException);
    expect(transactionalVideoRepository.save).not.toHaveBeenCalled();
    expect(video.status).toBe(VideoStatus.DRAFT);
    expect(videoQueue.enqueue).not.toHaveBeenCalled();
  });

  it('can retry the queue handoff after the database completion already committed', async () => {
    const video = Object.assign(new Video(), {
      id: 'video-id',
      channel_id: 'channel-id',
      status: VideoStatus.DRAFT,
      original_object_key: 'original/private-key',
      multipart_upload_id: 'multipart-id',
      original_size_bytes: String(UPLOAD_PART_SIZE_BYTES),
    });
    transactionalVideoRepository.findOne.mockResolvedValue(video);
    videoQueue.enqueue.mockRejectedValueOnce(new Error('redis unavailable'));

    await expect(
      service.completeUpload('owner-id', 'video-id', [
        { partNumber: 1, eTag: 'etag-one' },
      ]),
    ).rejects.toThrow('redis unavailable');
    expect(video.status).toBe(VideoStatus.PROCESSING);
    expect(storage.completeMultipart).toHaveBeenCalledTimes(1);

    await expect(
      service.completeUpload('owner-id', 'video-id', [
        { partNumber: 1, eTag: 'etag-one' },
      ]),
    ).resolves.toEqual({ videoId: 'video-id', status: VideoStatus.PROCESSING });
    expect(storage.completeMultipart).toHaveBeenCalledTimes(1);
    expect(videoQueue.enqueue).toHaveBeenCalledTimes(2);
    expect(videoQueue.enqueue).toHaveBeenLastCalledWith(
      'video-id',
      'original/private-key',
    );
  });

  it('aborts an active multipart upload and clears its upload ID', async () => {
    const video = Object.assign(new Video(), {
      id: 'video-id',
      channel: { user_id: 'owner-id' },
      status: VideoStatus.DRAFT,
      original_object_key: 'original/private-key',
      multipart_upload_id: 'multipart-id',
    });
    transactionalVideoRepository.findOne.mockResolvedValue(video);

    await service.abortUpload('owner-id', 'video-id');

    expect(storage.abortMultipart).toHaveBeenCalledWith(
      'original/private-key',
      'multipart-id',
    );
    expect(transactionalVideoRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: VideoStatus.DRAFT,
        multipart_upload_id: null,
      }),
    );
  });
});
