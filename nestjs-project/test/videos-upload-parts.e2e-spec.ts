import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { App } from 'supertest/types';
import request from 'supertest';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { VIDEO_PROCESSING_QUEUE } from '../src/queue/queue.constants';
import { STORAGE_ADAPTER } from '../src/storage/storage.constants';
import type { StorageAdapter } from '../src/storage/storage.types';
import { User } from '../src/users/entities/user.entity';
import { Video } from '../src/videos/entities/video.entity';
import { cleanAllTables } from '../src/test/create-test-data-source';

describe('video multipart routes (e2e)', () => {
  let app: INestApplication<App>;
  let db: DataSource;
  let users: Repository<User>;
  let videos: Repository<Video>;
  let jwt: JwtService;
  let storage: StorageAdapter;
  let queue: Queue;
  let owner: User;
  let other: User;
  let ownerToken: string;
  let otherToken: string;

  function bodyAs<T>(response: { body: unknown }): T {
    return response.body as T;
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();
    db = module.get(DataSource);
    users = db.getRepository(User);
    videos = db.getRepository(Video);
    jwt = module.get(JwtService);
    storage = module.get<StorageAdapter>(STORAGE_ADAPTER);
    queue = module.get<Queue>(getQueueToken(VIDEO_PROCESSING_QUEUE));
  });

  beforeEach(async () => {
    await clean();
    owner = await users.save(
      users.create({
        email: `upload-owner-${Date.now()}@example.com`,
        password: 'hashed-password',
        is_confirmed: true,
      }),
    );
    other = await users.save(
      users.create({
        email: `upload-other-${Date.now()}@example.com`,
        password: 'hashed-password',
        is_confirmed: true,
      }),
    );
    ownerToken = jwt.sign({ sub: owner.id, email: owner.email });
    otherToken = jwt.sign({ sub: other.id, email: other.email });
  });

  afterEach(clean);
  afterAll(async () => {
    await clean();
    await app.close();
  });

  async function clean(): Promise<void> {
    if (!db?.isInitialized) return;
    for (const video of await videos.find()) {
      if (video.multipart_upload_id)
        await storage.abortMultipartUpload(
          video.source_object_key,
          video.multipart_upload_id,
        );
      await queue.remove(video.id).catch(() => undefined);
    }
    await db.query('DELETE FROM "videos"');
    await cleanAllTables(db);
  }

  async function createDraft(
    token = ownerToken,
  ): Promise<{ videoId: string; uploadId: string }> {
    const response = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `create-${Date.now()}-${Math.random()}`)
      .send({ fileName: 'sample.mp4', contentType: 'video/mp4', sizeBytes: 20 })
      .expect(201);
    return bodyAs<{ videoId: string; uploadId: string }>(response);
  }

  it('limits part URLs to the owner and rejects invalid part numbers', async () => {
    const { videoId } = await createDraft();
    const valid = await request(app.getHttpServer())
      .post(`/videos/${videoId}/upload-parts`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ partNumbers: [1, 2] })
      .expect(200);
    expect(
      Object.keys(bodyAs<{ urls: Record<string, string> }>(valid).urls),
    ).toEqual(['1', '2']);
    const forbidden = await request(app.getHttpServer())
      .post(`/videos/${videoId}/upload-parts`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ partNumbers: [1] })
      .expect(403);
    expect(bodyAs<{ error: string }>(forbidden).error).toBe('VIDEO_NOT_OWNED');
    const invalid = await request(app.getHttpServer())
      .post(`/videos/${videoId}/upload-parts`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ partNumbers: [0] })
      .expect(400);
    expect(bodyAs<{ error: string }>(invalid).error).toBe(
      'INVALID_UPLOAD_REQUEST',
    );
  });

  it('completes multipart and recovers a failed queue publish with the stable job id', async () => {
    const { videoId } = await createDraft();
    const urls = bodyAs<{ urls: Record<string, string> }>(
      await request(app.getHttpServer())
        .post(`/videos/${videoId}/upload-parts`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ partNumbers: [1] })
        .expect(200),
    ).urls;
    const uploaded = await fetch(urls['1'], {
      method: 'PUT',
      body: Buffer.from('sample video bytes'),
    });
    expect(uploaded.ok).toBe(true);
    const eTag = uploaded.headers.get('etag');
    expect(eTag).toBeTruthy();
    jest
      .spyOn(queue, 'add')
      .mockRejectedValueOnce(new Error('redis temporarily unavailable'));
    const completion = { parts: [{ partNumber: 1, eTag }] };
    const failedPublish = await request(app.getHttpServer())
      .post(`/videos/${videoId}/complete-upload`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(completion)
      .expect(503);
    expect(bodyAs<{ error: string }>(failedPublish).error).toBe(
      'PROCESSING_QUEUE_UNAVAILABLE',
    );
    expect(await videos.findOneByOrFail({ id: videoId })).toMatchObject({
      status: 'processing',
      multipart_upload_id: null,
    });

    await request(app.getHttpServer())
      .post(`/videos/${videoId}/complete-upload`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(completion)
      .expect(202);
    const job = await queue.getJob(videoId);
    expect(job?.name).toBe('process-video');
    expect(job?.data).toMatchObject({ videoId });
    jest.restoreAllMocks();
  });

  it('aborts an upload idempotently and keeps the draft recoverable', async () => {
    const { videoId } = await createDraft();
    await request(app.getHttpServer())
      .delete(`/videos/${videoId}/upload`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);
    await expect(
      videos.findOneByOrFail({ id: videoId }),
    ).resolves.toMatchObject({ status: 'draft', multipart_upload_id: null });
    await request(app.getHttpServer())
      .delete(`/videos/${videoId}/upload`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);
    await request(app.getHttpServer())
      .post(`/videos/${videoId}/upload-parts`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ partNumbers: [1] })
      .expect(409);
  });
});
