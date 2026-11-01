import { DataSource, Repository } from 'typeorm';
import type { Queue } from 'bullmq';
import type { StorageAdapter } from '../storage/storage.types';
import {
  InvalidUploadPartsException,
  InvalidUploadRequestException,
  ProcessingQueueUnavailableException,
  UploadNotActiveException,
  VideoNotOwnedException,
} from '../common/exceptions/domain.exception';
import { Video, VideoStatus } from './entities/video.entity';
import { UploadSessionService } from './upload-session.service';

/* Jest mock callbacks intentionally use async-returning implementations and method spies. */
/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-return */

describe('UploadSessionService', () => {
  let service: UploadSessionService;
  let videos: jest.Mocked<Repository<Video>>;
  let dataSource: jest.Mocked<DataSource>;
  let storage: jest.Mocked<StorageAdapter>;
  let queue: jest.Mocked<Queue>;
  let row: Video;

  const transaction = async (callback: (manager: any) => unknown) =>
    callback({
      findOne: jest.fn().mockImplementation(async () => row),
      save: jest
        .fn()
        .mockImplementation(async (_entity: unknown, value: Video) => value),
    });

  beforeEach(() => {
    row = {
      id: 'video-1',
      owner_id: 'owner-1',
      status: VideoStatus.UPLOADING,
      multipart_upload_id: 'upload-1',
      source_object_key: 'videos/video-1/original',
    } as Video;
    videos = {
      findOneBy: jest.fn().mockImplementation(async () => row),
      save: jest.fn().mockImplementation(async (v) => v),
    } as unknown as jest.Mocked<Repository<Video>>;
    dataSource = {
      transaction: jest.fn().mockImplementation(transaction),
    } as unknown as jest.Mocked<DataSource>;
    storage = {
      createPresignedUploadPartUrl: jest
        .fn()
        .mockResolvedValue('https://storage/part'),
      completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
      abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<StorageAdapter>;
    queue = {
      add: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<Queue>;
    service = new UploadSessionService(videos, dataSource, storage, queue);
  });

  it('issues URLs only after confirming owner and active upload', async () => {
    await expect(
      service.signUploadParts('owner-1', row.id, [1, 3]),
    ).resolves.toEqual({
      videoId: row.id,
      uploadId: 'upload-1',
      urls: { '1': 'https://storage/part', '3': 'https://storage/part' },
    });
    expect(storage.createPresignedUploadPartUrl).toHaveBeenCalledTimes(2);
    videos.findOneBy.mockResolvedValueOnce({ ...row, owner_id: 'other' });
    await expect(
      service.signUploadParts('owner-1', row.id, [1]),
    ).rejects.toBeInstanceOf(VideoNotOwnedException);
  });

  it('rejects malformed part numbers and ETags', async () => {
    await expect(
      service.signUploadParts('owner-1', row.id, [0]),
    ).rejects.toBeInstanceOf(InvalidUploadRequestException);
    await expect(
      service.completeUpload('owner-1', row.id, [{ partNumber: 1, eTag: '' }]),
    ).rejects.toBeInstanceOf(InvalidUploadPartsException);
    expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
  });

  it('completes, clears multipart state and publishes a stable job', async () => {
    await expect(
      service.completeUpload('owner-1', row.id, [
        { partNumber: 1, eTag: '"etag"' },
      ]),
    ).resolves.toEqual({ videoId: row.id, status: VideoStatus.PROCESSING });
    expect(row.multipart_upload_id).toBeNull();
    expect(queue.add).toHaveBeenCalledWith(
      'process-video',
      { videoId: row.id, sourceObjectKey: row.source_object_key },
      { jobId: row.id },
    );
  });

  it('recovers queue publication failure on completion retry', async () => {
    queue.add.mockRejectedValueOnce(new Error('redis down'));
    await expect(
      service.completeUpload('owner-1', row.id, [
        { partNumber: 1, eTag: 'etag' },
      ]),
    ).rejects.toBeInstanceOf(ProcessingQueueUnavailableException);
    row.status = VideoStatus.PROCESSING;
    await expect(
      service.completeUpload('owner-1', row.id, [
        { partNumber: 1, eTag: 'etag' },
      ]),
    ).resolves.toEqual({ videoId: row.id, status: VideoStatus.PROCESSING });
    expect(storage.completeMultipartUpload).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledTimes(2);
  });

  it('aborts idempotently and preserves a recoverable draft', async () => {
    await service.abortUpload('owner-1', row.id);
    expect(row.status).toBe(VideoStatus.DRAFT);
    expect(row.multipart_upload_id).toBeNull();
    await expect(
      service.signUploadParts('owner-1', row.id, [1]),
    ).rejects.toBeInstanceOf(UploadNotActiveException);
  });

  it('rejects duplicate completion part numbers', async () => {
    await expect(
      service.completeUpload('owner-1', row.id, [
        { partNumber: 1, eTag: 'a' },
        { partNumber: 1, eTag: 'b' },
      ]),
    ).rejects.toBeInstanceOf(InvalidUploadPartsException);
  });
});
