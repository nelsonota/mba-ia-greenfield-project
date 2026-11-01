import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { App } from 'supertest/types';
import request from 'supertest';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { STORAGE_ADAPTER } from '../src/storage/storage.constants';
import type { StorageAdapter } from '../src/storage/storage.types';
import { User } from '../src/users/entities/user.entity';
import { Video } from '../src/videos/entities/video.entity';
import { cleanAllTables } from '../src/test/create-test-data-source';

interface CreateVideoHttpResponse {
  videoId: string;
  status: string;
  upload: { uploadId: string } | null;
}

interface ErrorEnvelope {
  statusCode: number;
  error: string;
  message: string | string[];
}

function responseBody<T>(response: { body: unknown }): T {
  return response.body as T;
}

describe('POST /videos (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let videoRepository: Repository<Video>;
  let jwtService: JwtService;
  let storage: StorageAdapter;
  let throttlerStorage: ThrottlerStorageService;
  let owner: User;
  let accessToken: string;

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

    dataSource = module.get(DataSource);
    userRepository = dataSource.getRepository(User);
    videoRepository = dataSource.getRepository(Video);
    jwtService = module.get(JwtService);
    storage = module.get<StorageAdapter>(STORAGE_ADAPTER);
    throttlerStorage = module.get<ThrottlerStorageService>(ThrottlerStorage);
  });

  afterAll(async () => {
    await cleanData();
    await app.close();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await cleanData();
    throttlerStorage.storage.clear();
    owner = await userRepository.save(
      userRepository.create({
        email: `video-owner-${Date.now()}@example.com`,
        password: 'hashed-password',
        is_confirmed: true,
      }),
    );
    accessToken = jwtService.sign({ sub: owner.id, email: owner.email });
  });

  afterEach(async () => {
    await cleanData();
  });

  async function cleanData(): Promise<void> {
    if (!dataSource?.isInitialized) {
      return;
    }
    const activeVideos = await videoRepository.find();
    for (const video of activeVideos) {
      if (video.multipart_upload_id) {
        await storage.abortMultipartUpload(
          video.source_object_key,
          video.multipart_upload_id,
        );
      }
    }
    await dataSource.query('DELETE FROM "videos"');
    await cleanAllTables(dataSource);
  }

  function postVideo(idempotencyKey: string, body = validBody()) {
    return request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(body);
  }

  function validBody() {
    return {
      fileName: 'sample.mp4',
      contentType: 'video/mp4',
      sizeBytes: 1024,
    };
  }

  it('creates an authenticated draft and starts multipart storage', async () => {
    const response = await postVideo('create-1').expect(201);
    const body = responseBody<CreateVideoHttpResponse>(response);

    expect(typeof body.videoId).toBe('string');
    expect(body.status).toBe('draft');
    expect(typeof body.upload?.uploadId).toBe('string');
    await expect(
      videoRepository.findOneBy({
        id: body.videoId,
        owner_id: owner.id,
      }),
    ).resolves.toMatchObject({ status: 'draft' });
  });

  it('returns the existing draft and session for the same owner and key', async () => {
    const first = await postVideo('retry-1').expect(201);
    const second = await postVideo('retry-1').expect(201);

    expect(responseBody<CreateVideoHttpResponse>(second)).toEqual(
      responseBody<CreateVideoHttpResponse>(first),
    );
    await expect(
      videoRepository.findBy({
        owner_id: owner.id,
        idempotency_key: 'retry-1',
      }),
    ).resolves.toHaveLength(1);
  });

  it('returns the standard 409 envelope when a key is reused with different metadata', async () => {
    await postVideo('conflict-1').expect(201);

    const response = await postVideo('conflict-1', {
      ...validBody(),
      sizeBytes: 2048,
    }).expect(409);
    const body = responseBody<ErrorEnvelope>(response);

    expect(body.statusCode).toBe(409);
    expect(body.error).toBe('IDEMPOTENCY_CONFLICT');
    expect(typeof body.message).toBe('string');
    await expect(videoRepository.countBy({ owner_id: owner.id })).resolves.toBe(
      1,
    );
  });

  it('returns 413 with the standard error envelope for videos larger than 10 GB', async () => {
    const response = await postVideo('oversize-1', {
      ...validBody(),
      sizeBytes: 10_000_000_001,
    }).expect(413);
    const body = responseBody<ErrorEnvelope>(response);

    expect(body.statusCode).toBe(413);
    expect(body.error).toBe('VIDEO_TOO_LARGE');
    expect(typeof body.message).toBe('string');
    await expect(videoRepository.countBy({ owner_id: owner.id })).resolves.toBe(
      0,
    );
  });

  it('keeps a recoverable draft after a storage outage and retries with the same key', async () => {
    const createSession = jest
      .spyOn(storage, 'createMultipartUpload')
      .mockRejectedValueOnce(new Error('temporary storage outage'));

    const failed = await postVideo('recover-1').expect(503);
    const failedBody = responseBody<ErrorEnvelope>(failed);
    expect(failedBody.statusCode).toBe(503);
    expect(failedBody.error).toBe('STORAGE_UNAVAILABLE');
    expect(typeof failedBody.message).toBe('string');

    const recoverableDraft = await videoRepository.findOneBy({
      owner_id: owner.id,
      idempotency_key: 'recover-1',
    });
    expect(recoverableDraft).toMatchObject({
      status: 'draft',
      multipart_upload_id: null,
    });

    const retry = await postVideo('recover-1').expect(201);
    const retryBody = responseBody<CreateVideoHttpResponse>(retry);
    expect(retryBody.videoId).toBe(recoverableDraft?.id);
    expect(typeof retryBody.upload?.uploadId).toBe('string');
    expect(createSession).toHaveBeenCalledTimes(2);
    await expect(videoRepository.countBy({ owner_id: owner.id })).resolves.toBe(
      1,
    );
  });

  it('requires authentication and the Idempotency-Key header', async () => {
    await request(app.getHttpServer())
      .post('/videos')
      .send(validBody())
      .expect(401);

    const response = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validBody())
      .expect(400);
    expect(responseBody<ErrorEnvelope>(response).error).toBe(
      'INVALID_UPLOAD_REQUEST',
    );
  });
});
