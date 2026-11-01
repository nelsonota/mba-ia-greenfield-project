import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Channel } from '../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import storageConfig from '../config/storage.config';
import { S3StorageAdapter } from '../storage/s3-storage.adapter';
import { Video, VideoStatus } from './entities/video.entity';
import { VideoDeliveryService } from './video-delivery.service';

describe('VideoDeliveryService (integration)', () => {
  let dataSource: DataSource;
  let videos: Repository<Video>;
  let users: Repository<User>;
  let storage: S3StorageAdapter;
  let service: VideoDeliveryService;
  const objectBody = Buffer.from('0123456789');

  beforeAll(async () => {
    dataSource = createTestDataSource([Video, User, Channel]);
    await dataSource.initialize();
    videos = dataSource.getRepository(Video);
    users = dataSource.getRepository(User);
    storage = new S3StorageAdapter(storageConfig());
    await storage.onModuleInit();
    service = new VideoDeliveryService(videos, storage);
  });

  afterAll(async () => {
    await clean();
    if (dataSource.isInitialized) await dataSource.destroy();
  });

  beforeEach(clean);
  afterEach(clean);

  async function clean(): Promise<void> {
    if (!dataSource?.isInitialized) return;
    for (const video of await videos.find())
      await storage
        .deleteObject(video.source_object_key)
        .catch(() => undefined);
    await cleanAllTables(dataSource);
  }

  it('streams a real RustFS object and returns the requested byte range', async () => {
    const owner = await users.save(
      users.create({
        email: `${randomUUID()}@example.com`,
        password: 'hashed-password',
        is_confirmed: true,
      }),
    );
    const key = `delivery/${randomUUID()}.mp4`;
    await storage.putObject(key, objectBody, 'video/mp4');
    const video = await videos.save(
      videos.create({
        owner_id: owner.id,
        status: VideoStatus.READY,
        idempotency_key: randomUUID(),
        source_object_key: key,
        multipart_upload_id: null,
        file_name: 'sample.mp4',
        content_type: 'video/mp4',
        size_bytes: String(objectBody.length),
        published_at: new Date(),
        duration_seconds: null,
        metadata: null,
        thumbnail_object_key: null,
      }),
    );

    const result = await service.streamVideo(undefined, video.id, 'bytes=2-5');
    const chunks: Buffer[] = [];
    for await (const chunk of result.body)
      chunks.push(Buffer.from(chunk as Uint8Array));
    expect(Buffer.concat(chunks)).toEqual(Buffer.from('2345'));
    expect(result).toMatchObject({
      statusCode: 206,
      contentLength: 4,
      contentRange: 'bytes 2-5/10',
    });
  });
});
