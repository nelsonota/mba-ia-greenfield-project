import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import { User } from '../users/entities/user.entity';
import { S3StorageAdapter } from '../storage/s3-storage.adapter';
import { Video, VideoStatus } from './entities/video.entity';
import { UploadSessionService } from './upload-session.service';
import { createTestDataSource } from '../test/create-test-data-source';
import {
  PROCESS_VIDEO_JOB,
  VIDEO_PROCESSING_DEFAULT_JOB_OPTIONS,
  VIDEO_PROCESSING_QUEUE,
} from '../queue/queue.constants';

describe('UploadSessionService (integration)', () => {
  let db: DataSource;
  let videos: Repository<Video>;
  let users: Repository<User>;
  let storage: S3StorageAdapter;
  let queue: Queue;
  let service: UploadSessionService;
  const createdVideoIds: string[] = [];
  const createdKeys: string[] = [];

  beforeAll(async () => {
    db = createTestDataSource([Video, User, Channel]);
    await db.initialize();
    videos = db.getRepository(Video);
    users = db.getRepository(User);
    storage = new S3StorageAdapter(storageConfig());
    await storage.onModuleInit();
    queue = new Queue(VIDEO_PROCESSING_QUEUE, {
      connection: queueConfig().redis,
      defaultJobOptions: VIDEO_PROCESSING_DEFAULT_JOB_OPTIONS,
    });
    service = new UploadSessionService(videos, db, storage, queue);
  });

  afterAll(async () => {
    await clean();
    await queue.close();
    await db.destroy();
  });

  beforeEach(clean);
  afterEach(clean);

  async function clean(): Promise<void> {
    if (!db?.isInitialized) return;
    for (const videoId of createdVideoIds.splice(0))
      await queue.remove(videoId).catch(() => undefined);
    for (const key of createdKeys.splice(0))
      await storage.deleteObject(key).catch(() => undefined);
    await db.query('DELETE FROM "videos"');
    await db.query('DELETE FROM "channels"');
    await db.query('DELETE FROM "users"');
  }

  it('persists completion in PostgreSQL and publishes one stable BullMQ job', async () => {
    const owner = await users.save(
      users.create({
        email: `${randomUUID()}@example.com`,
        password: 'hashed-password',
        is_confirmed: true,
      }),
    );
    const id = randomUUID();
    const key = `integration/${id}/source`;
    createdVideoIds.push(id);
    createdKeys.push(key);
    const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
    const video = await videos.save(
      videos.create({
        id,
        owner_id: owner.id,
        status: VideoStatus.DRAFT,
        idempotency_key: id,
        source_object_key: key,
        multipart_upload_id: uploadId,
        file_name: 'sample.mp4',
        content_type: 'video/mp4',
        size_bytes: '100',
      }),
    );
    const url = await storage.createPresignedUploadPartUrl(key, uploadId, 1);
    const uploaded = await fetch(url, {
      method: 'PUT',
      body: Buffer.from('sample bytes'),
    });
    expect(uploaded.ok).toBe(true);
    const eTag = uploaded.headers.get('etag');
    expect(eTag).toBeTruthy();

    const result = await service.completeUpload(owner.id, id, [
      { partNumber: 1, eTag: eTag! },
    ]);
    expect(result).toEqual({ videoId: id, status: VideoStatus.PROCESSING });
    await expect(videos.findOneByOrFail({ id })).resolves.toMatchObject({
      status: VideoStatus.PROCESSING,
      multipart_upload_id: null,
    });
    const job = await queue.getJob(id);
    expect(job).toMatchObject({
      name: PROCESS_VIDEO_JOB,
      data: { videoId: id, sourceObjectKey: key },
    });

    await service.completeUpload(owner.id, id, [
      { partNumber: 1, eTag: eTag! },
    ]);
    expect(await queue.getJob(id)).toBeTruthy();
    expect(video.id).toBe(id);
  });
});
