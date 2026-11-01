import { Readable } from 'node:stream';
import {
  VideoNotFoundException,
  StorageUnavailableException,
  RangeNotSatisfiableException,
} from '../common/exceptions/domain.exception';
import { StorageAdapter } from '../storage/storage.types';
import { Video, VideoStatus } from './entities/video.entity';
import { VideoDeliveryService } from './video-delivery.service';

describe('VideoDeliveryService', () => {
  const video = (overrides: Partial<Video> = {}): Video =>
    ({
      id: 'video-1',
      owner_id: 'owner-1',
      status: VideoStatus.READY,
      source_object_key: 'videos/video-1/source.mp4',
      file_name: 'sample.mp4',
      content_type: 'video/mp4',
      published_at: new Date(),
      ...overrides,
    }) as Video;

  let findOneBy: jest.Mock;
  let getObjectMetadata: jest.Mock;
  let getObjectStream: jest.Mock;
  let service: VideoDeliveryService;

  beforeEach(() => {
    findOneBy = jest.fn().mockResolvedValue(video());
    getObjectMetadata = jest
      .fn()
      .mockResolvedValue({ contentLength: 10, contentType: 'video/mp4' });
    getObjectStream = jest
      .fn()
      .mockResolvedValue(Readable.from(Buffer.from('0123456789')));
    service = new VideoDeliveryService(
      { findOneBy } as never,
      { getObjectMetadata, getObjectStream } as unknown as StorageAdapter,
    );
  });

  it('streams the whole published video with content metadata', async () => {
    const result = await service.streamVideo(undefined, 'video-1', undefined);
    expect(result).toMatchObject({
      contentLength: 10,
      contentType: 'video/mp4',
      statusCode: 200,
    });
    expect(getObjectStream).toHaveBeenCalledWith(
      'videos/video-1/source.mp4',
      undefined,
    );
  });

  it('serves a bounded partial range', async () => {
    const result = await service.streamVideo(undefined, 'video-1', 'bytes=2-5');
    expect(result).toMatchObject({
      contentLength: 4,
      statusCode: 206,
      contentRange: 'bytes 2-5/10',
    });
    expect(getObjectStream).toHaveBeenCalledWith(
      'videos/video-1/source.mp4',
      'bytes=2-5',
    );
  });

  it('allows the owner to stream their unpublished ready video', async () => {
    findOneBy.mockResolvedValue(video({ published_at: null }));
    await expect(
      service.streamVideo('owner-1', 'video-1', undefined),
    ).resolves.toMatchObject({ statusCode: 200 });
  });

  it.each([VideoStatus.DRAFT, VideoStatus.PROCESSING, VideoStatus.FAILED])(
    'hides a %s video',
    async (status) => {
      findOneBy.mockResolvedValue(video({ status }));
      await expect(
        service.streamVideo('owner-1', 'video-1', undefined),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
    },
  );

  it('hides an unpublished ready video from non-owners', async () => {
    findOneBy.mockResolvedValue(video({ published_at: null }));
    await expect(
      service.streamVideo('other-1', 'video-1', undefined),
    ).rejects.toBeInstanceOf(VideoNotFoundException);
  });

  it('rejects invalid ranges with a 416 domain exception', async () => {
    await expect(
      service.streamVideo(undefined, 'video-1', 'bytes=10-'),
    ).rejects.toBeInstanceOf(RangeNotSatisfiableException);
  });

  it('maps storage errors to the stable unavailable error', async () => {
    getObjectMetadata.mockRejectedValue(new Error('private provider details'));
    await expect(
      service.streamVideo(undefined, 'video-1', undefined),
    ).rejects.toBeInstanceOf(StorageUnavailableException);
  });

  it('downloads with a safe attachment filename', async () => {
    findOneBy.mockResolvedValue(video({ file_name: '../bad"name.mp4' }));
    const result = await service.downloadVideo('owner-1', 'video-1');
    expect(result.contentDisposition).toContain('attachment;');
    expect(result.contentDisposition).toContain('bad_name.mp4');
  });
});
