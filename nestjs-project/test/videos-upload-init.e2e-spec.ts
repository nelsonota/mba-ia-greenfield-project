import * as crypto from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { ThrottlerStorageService, ThrottlerStorage } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/mail/mail.service';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { Channel } from '../src/channels/entities/channel.entity';
import { User } from '../src/users/entities/user.entity';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import {
  MAX_VIDEO_SIZE_BYTES,
  UPLOAD_PART_SIZE_BYTES,
} from '../src/videos/video-upload.constants';
import { VideoStorageService } from '../src/videos/storage/video-storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import {
  accessToken,
  errorCode,
  signedParts,
  videoId,
} from './video-e2e-helpers';

describe('videos-upload-init', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let videoStorage: VideoStorageService;
  let throttlerStorage: ThrottlerStorageService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
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

    dataSource = moduleFixture.get(DataSource);
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
    videoStorage = moduleFixture.get(VideoStorageService);
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
  });

  afterEach(async () => {
    try {
      for (const video of await videoRepository.find()) {
        if (video.multipart_upload_id) {
          await videoStorage.abortMultipart(
            video.original_object_key,
            video.multipart_upload_id,
          );
        }
      }
    } finally {
      await cleanAllTables(dataSource);
      jest.restoreAllMocks();
    }
  });

  async function registerConfirmAndLogin(): Promise<{
    email: string;
    accessToken: string;
  }> {
    const email = `video-${crypto.randomUUID()}@example.com`;
    const mailService = app.get(MailService);
    let confirmationToken = '';
    jest
      .spyOn(mailService, 'sendConfirmationEmail')
      .mockImplementationOnce(
        (_email: string, _name: string, token: string) => {
          confirmationToken = token;
          return Promise.resolve();
        },
      );

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'password123' })
      .expect(201);
    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token: confirmationToken })
      .expect(204);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123' })
      .expect(200);

    return { email, accessToken: accessToken(login) };
  }

  function startUpload(
    accessToken: string,
    sizeBytes = UPLOAD_PART_SIZE_BYTES + 1,
  ) {
    return request(app.getHttpServer())
      .post('/videos/uploads')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        originalFilename: 'lecture.mp4',
        contentType: 'video/mp4',
        sizeBytes,
      });
  }

  it('creates a private draft and multipart upload before returning part details', async () => {
    const owner = await registerConfirmAndLogin();

    const response = await startUpload(owner.accessToken).expect(201);

    expect(response.body).toMatchObject({
      status: 'draft',
      partSizeBytes: UPLOAD_PART_SIZE_BYTES,
      partCount: 2,
    });
    expect(videoId(response)).toMatch(/^[0-9a-f-]{36}$/i);
    expect(response.body).not.toHaveProperty('objectKey');

    const user = await userRepository.findOneByOrFail({ email: owner.email });
    const channel = await channelRepository.findOneByOrFail({
      user_id: user.id,
    });
    const draft = await videoRepository.findOneByOrFail({
      id: videoId(response),
    });
    expect(draft).toMatchObject({
      channel_id: channel.id,
      status: VideoStatus.DRAFT,
      original_size_bytes: String(UPLOAD_PART_SIZE_BYTES + 1),
      original_content_type: 'video/mp4',
    });
    expect(draft.original_object_key).toMatch(/^original\/[0-9a-f-]{36}$/);
    expect(draft.multipart_upload_id).toBeTruthy();
  });

  it('rejects invalid metadata and files above the 10 GB limit without creating drafts', async () => {
    const owner = await registerConfirmAndLogin();
    const invalidRequests = [
      {
        originalFilename: 'lecture.mp4',
        contentType: 'video/mp4',
        sizeBytes: 0,
      },
      {
        originalFilename: 'lecture.mp4',
        contentType: 'video/mp4',
        sizeBytes: MAX_VIDEO_SIZE_BYTES + 1,
      },
      { originalFilename: '', contentType: 'not-a-mime-type', sizeBytes: 100 },
      { contentType: 'video/mp4', sizeBytes: 100 },
    ];

    for (const payload of invalidRequests) {
      const response = await request(app.getHttpServer())
        .post('/videos/uploads')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send(payload)
        .expect(400);
      expect(errorCode(response)).toBe('VALIDATION_ERROR');
    }
    expect(await videoRepository.count()).toBe(0);
  });

  it('rejects upload initiation without an authenticated session', async () => {
    const response = await request(app.getHttpServer())
      .post('/videos/uploads')
      .send({
        originalFilename: 'lecture.mp4',
        contentType: 'video/mp4',
        sizeBytes: 100,
      })
      .expect(401);

    expect(errorCode(response)).toBe('UNAUTHENTICATED');
    expect(await videoRepository.count()).toBe(0);
  });

  it('returns expiring part URLs for the owner of an active draft', async () => {
    const owner = await registerConfirmAndLogin();
    const upload = await startUpload(owner.accessToken).expect(201);

    const response = await request(app.getHttpServer())
      .post(`/videos/${videoId(upload)}/upload-parts`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ partNumbers: [1, 2] })
      .expect(200);

    const parts = signedParts(response) ?? [];
    expect(parts).toHaveLength(2);
    for (const part of parts) {
      expect(part.partNumber).toBeGreaterThanOrEqual(1);
      expect(part.url).toContain('http://localhost:9002/');
      expect(new Date(part.expiresAt).getTime()).toBeGreaterThan(Date.now());
    }
  });

  it('does not issue part URLs to another authenticated user', async () => {
    const owner = await registerConfirmAndLogin();
    const otherUser = await registerConfirmAndLogin();
    const upload = await startUpload(owner.accessToken).expect(201);

    const response = await request(app.getHttpServer())
      .post(`/videos/${videoId(upload)}/upload-parts`)
      .set('Authorization', `Bearer ${otherUser.accessToken}`)
      .send({ partNumbers: [1] })
      .expect(403);

    expect(errorCode(response)).toBe('VIDEO_ACCESS_DENIED');
    expect(signedParts(response)).toBeUndefined();
  });
});
