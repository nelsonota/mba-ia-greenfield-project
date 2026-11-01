import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { App } from 'supertest/types';
import request from 'supertest';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { STORAGE_ADAPTER } from '../src/storage/storage.constants';
import type { StorageAdapter } from '../src/storage/storage.types';
import { User } from '../src/users/entities/user.entity';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import { cleanAllTables } from '../src/test/create-test-data-source';

describe('video delivery routes (e2e)', () => {
  let app: INestApplication<App>;
  let db: DataSource;
  let users: Repository<User>;
  let videos: Repository<Video>;
  let jwt: JwtService;
  let storage: StorageAdapter;
  let owner: User;
  let other: User;
  let ownerToken: string;
  let otherToken: string;
  const body = Buffer.from('0123456789');
  let objectKeys: string[] = [];

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
  });

  beforeEach(async () => {
    await clean();
    owner = await users.save(
      users.create({
        email: `${randomUUID()}@example.com`,
        password: 'hashed-password',
        is_confirmed: true,
      }),
    );
    other = await users.save(
      users.create({
        email: `${randomUUID()}@example.com`,
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
    for (const key of objectKeys)
      await storage.deleteObject(key).catch(() => undefined);
    objectKeys = [];
    await db.query('DELETE FROM "videos"');
    await cleanAllTables(db);
  }

  async function createVideo(overrides: Partial<Video> = {}): Promise<Video> {
    const key = `delivery-e2e/${randomUUID()}.mp4`;
    objectKeys.push(key);
    await storage.putObject(key, body, 'video/mp4');
    return videos.save(
      videos.create({
        owner_id: owner.id,
        status: VideoStatus.READY,
        idempotency_key: randomUUID(),
        source_object_key: key,
        multipart_upload_id: null,
        file_name: 'sample.mp4',
        content_type: 'video/mp4',
        size_bytes: String(body.length),
        published_at: new Date(),
        duration_seconds: null,
        metadata: null,
        thumbnail_object_key: null,
        ...overrides,
      }),
    );
  }

  it('streams a published video progressively and honors byte ranges', async () => {
    const video = await createVideo();
    const full = await request(app.getHttpServer())
      .get(`/videos/${video.id}/stream`)
      .expect(200);
    expect(full.headers['content-type']).toContain('video/mp4');
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(full.body).toEqual(body);

    const partial = await request(app.getHttpServer())
      .get(`/videos/${video.id}/stream`)
      .set('Range', 'bytes=2-5')
      .expect(206);
    expect(partial.headers['content-range']).toBe('bytes 2-5/10');
    expect(partial.body).toEqual(Buffer.from('2345'));
  });

  it('keeps unpublished videos private and permits the owner to stream a ready video', async () => {
    const unpublished = await createVideo({ published_at: null });
    await request(app.getHttpServer())
      .get(`/videos/${unpublished.id}/stream`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/videos/${unpublished.id}/stream`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/videos/${unpublished.id}/stream`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const draft = await createVideo({ status: VideoStatus.DRAFT });
    await request(app.getHttpServer())
      .get(`/videos/${draft.id}/stream`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);
  });

  it('downloads a published original as a safe attachment', async () => {
    const video = await createVideo({ file_name: '../sample video.mp4' });
    const response = await request(app.getHttpServer())
      .get(`/videos/${video.id}/download`)
      .expect(200);
    expect(response.headers['content-disposition']).toContain('attachment;');
    expect(response.headers['content-disposition']).toContain(
      '.._sample video.mp4',
    );
    expect(response.body).toEqual(body);
  });

  it('returns the standard 416 and 503 error envelopes', async () => {
    const video = await createVideo();
    const invalid = await request(app.getHttpServer())
      .get(`/videos/${video.id}/stream`)
      .set('Range', 'bytes=100-')
      .expect(416);
    expect(invalid.headers['content-range']).toBe('bytes */10');
    expect(invalid.body).toMatchObject({
      error: 'RANGE_NOT_SATISFIABLE',
      statusCode: 416,
    });

    jest
      .spyOn(storage, 'getObjectMetadata')
      .mockRejectedValueOnce(new Error('secret provider credential'));
    const outage = await request(app.getHttpServer())
      .get(`/videos/${video.id}/stream`)
      .expect(503);
    expect(outage.body).toMatchObject({
      error: 'STORAGE_UNAVAILABLE',
      statusCode: 503,
    });
    expect(JSON.stringify(outage.body)).not.toContain(
      'secret provider credential',
    );
    jest.restoreAllMocks();
  });
});
