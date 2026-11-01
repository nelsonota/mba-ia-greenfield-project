import {
  QueryFailedError,
  Repository,
  EntityManager,
  DataSource,
} from 'typeorm';
import {
  IdempotencyConflictException,
  InvalidUploadRequestException,
  StorageUnavailableException,
  VideoTooLargeException,
} from '../common/exceptions/domain.exception';
import type { StorageAdapter } from '../storage/storage.types';
import { CreateVideoDto } from './dto/create-video.dto';
import { Video, VideoStatus } from './entities/video.entity';
import { VideosService } from './videos.service';

const ownerId = 'd7ea6e3d-a856-48d8-bc0c-862687d031b9';
const input: CreateVideoDto = {
  fileName: 'sample.mp4',
  contentType: 'video/mp4',
  sizeBytes: 1024,
};

function draft(overrides: Partial<Video> = {}): Video {
  return {
    id: '250b113a-6f31-4d39-bcbc-aed2244301b2',
    owner_id: ownerId,
    status: VideoStatus.DRAFT,
    idempotency_key: 'request-1',
    source_object_key: 'videos/250b113a-6f31-4d39-bcbc-aed2244301b2/original',
    multipart_upload_id: null,
    file_name: input.fileName,
    content_type: input.contentType,
    size_bytes: String(input.sizeBytes),
    duration_seconds: null,
    metadata: null,
    thumbnail_object_key: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  } as unknown as Video;
}

describe('VideosService', () => {
  let service: VideosService;
  let repository: {
    create: jest.Mock;
    findOneBy: jest.Mock;
    save: jest.Mock;
  };
  let manager: { findOne: jest.Mock; save: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let storage: {
    createMultipartUpload: jest.Mock;
    abortMultipartUpload: jest.Mock;
  };

  beforeEach(() => {
    repository = {
      create: jest.fn((value: Partial<Video>) => value),
      findOneBy: jest.fn(),
      save: jest.fn(),
    };
    manager = {
      findOne: jest.fn(),
      save: jest.fn(),
    };
    dataSource = {
      transaction: jest.fn(
        async (callback: (entityManager: EntityManager) => Promise<Video>) =>
          callback(manager as unknown as EntityManager),
      ),
    };
    storage = {
      createMultipartUpload: jest.fn(),
      abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
    };
    service = new VideosService(
      repository as unknown as Repository<Video>,
      dataSource as unknown as DataSource,
      storage as unknown as StorageAdapter,
    );
  });

  it('persists one draft and returns its multipart descriptor', async () => {
    const savedDraft = draft();
    repository.findOneBy.mockResolvedValueOnce(null);
    repository.save.mockResolvedValueOnce(savedDraft);
    manager.findOne.mockResolvedValueOnce(savedDraft);
    manager.save.mockImplementationOnce(
      (_entity: typeof Video, video: Video) => ({
        ...video,
        multipart_upload_id: 's3-upload-1',
      }),
    );
    storage.createMultipartUpload.mockResolvedValueOnce('s3-upload-1');

    await expect(
      service.createDraft(ownerId, 'request-1', input),
    ).resolves.toEqual({
      videoId: savedDraft.id,
      status: VideoStatus.DRAFT,
      upload: { uploadId: 's3-upload-1' },
    });
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(storage.createMultipartUpload).toHaveBeenCalledWith(
      savedDraft.source_object_key,
      input.contentType,
    );
  });

  it('returns the existing upload for a repeated request without starting another session', async () => {
    repository.findOneBy.mockResolvedValueOnce(
      draft({ multipart_upload_id: 's3-upload-existing' }),
    );

    await expect(
      service.createDraft(ownerId, 'request-1', input),
    ).resolves.toMatchObject({
      videoId: draft().id,
      upload: { uploadId: 's3-upload-existing' },
    });
    expect(repository.save).not.toHaveBeenCalled();
    expect(storage.createMultipartUpload).not.toHaveBeenCalled();
  });

  it('rejects reuse of an idempotency key with different metadata', async () => {
    repository.findOneBy.mockResolvedValueOnce(draft({ size_bytes: '2048' }));

    await expect(
      service.createDraft(ownerId, 'request-1', input),
    ).rejects.toBeInstanceOf(IdempotencyConflictException);
    expect(storage.createMultipartUpload).not.toHaveBeenCalled();
  });

  it('leaves a recoverable draft when storage is unavailable and reuses it on retry', async () => {
    const savedDraft = draft();
    repository.findOneBy
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(savedDraft);
    repository.save.mockResolvedValueOnce(savedDraft);
    manager.findOne
      .mockResolvedValueOnce(savedDraft)
      .mockResolvedValueOnce(savedDraft);
    manager.save.mockImplementationOnce(
      (_entity: typeof Video, video: Video) => ({
        ...video,
        multipart_upload_id: 's3-upload-recovered',
      }),
    );
    storage.createMultipartUpload
      .mockRejectedValueOnce(new Error('temporary storage outage'))
      .mockResolvedValueOnce('s3-upload-recovered');

    await expect(
      service.createDraft(ownerId, 'request-1', input),
    ).rejects.toBeInstanceOf(StorageUnavailableException);
    expect(repository.save).toHaveBeenCalledTimes(1);

    await expect(
      service.createDraft(ownerId, 'request-1', input),
    ).resolves.toMatchObject({
      videoId: savedDraft.id,
      upload: { uploadId: 's3-upload-recovered' },
    });
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(storage.createMultipartUpload).toHaveBeenCalledTimes(2);
  });

  it('recovers the winner of a concurrent insert for the same owner and key', async () => {
    const existing = draft({ multipart_upload_id: 's3-upload-race-winner' });
    repository.findOneBy
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);
    repository.save.mockRejectedValueOnce(
      new QueryFailedError(
        'INSERT',
        [],
        Object.assign(new Error('duplicate idempotency key'), {
          code: '23505',
          constraint: 'UQ_videos_owner_idempotency_key',
        }),
      ),
    );

    await expect(
      service.createDraft(ownerId, 'request-1', input),
    ).resolves.toMatchObject({
      videoId: existing.id,
      upload: { uploadId: 's3-upload-race-winner' },
    });
    expect(storage.createMultipartUpload).not.toHaveBeenCalled();
  });

  it('rejects missing keys and oversized files before persistence', async () => {
    await expect(
      service.createDraft(ownerId, undefined, input),
    ).rejects.toBeInstanceOf(InvalidUploadRequestException);
    await expect(
      service.createDraft(ownerId, 'request-2', {
        ...input,
        sizeBytes: 10_000_000_001,
      }),
    ).rejects.toBeInstanceOf(VideoTooLargeException);
    expect(repository.findOneBy).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });
});
