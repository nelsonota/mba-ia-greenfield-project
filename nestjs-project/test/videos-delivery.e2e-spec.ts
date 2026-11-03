import * as crypto from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/mail/mail.service';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { Channel } from '../src/channels/entities/channel.entity';
import { User } from '../src/users/entities/user.entity';
import {
  Video,
  VideoStatus,
  VideoVisibility,
} from '../src/videos/entities/video.entity';
import { VideoStorageService } from '../src/videos/storage/video-storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { accessToken, errorCode } from './video-e2e-helpers';

jest.setTimeout(60_000);

describe('videos-delivery', () => {
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
    await cleanAllTables(dataSource);
    jest.restoreAllMocks();
  });

  async function registerConfirmAndLogin(): Promise<{
    email: string;
    accessToken: string;
  }> {
    const email = `delivery-${crypto.randomUUID()}@example.com`;
    let confirmationToken = '';
    jest
      .spyOn(app.get(MailService), 'sendConfirmationEmail')
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

  async function createVideo(
    ownerEmail: string,
    options: {
      status?: VideoStatus;
      visibility?: VideoVisibility;
      publishedAt?: Date | null;
      processedObjectKey?: string | null;
    } = {},
  ): Promise<Video> {
    const owner = await userRepository.findOneByOrFail({ email: ownerEmail });
    const channel = await channelRepository.findOneByOrFail({
      user_id: owner.id,
    });
    return videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        status: options.status ?? VideoStatus.READY,
        original_object_key: `original/${crypto.randomUUID()}`,
        multipart_upload_id: null,
        original_size_bytes: '1024',
        original_content_type: 'video/mp4',
        processed_object_key:
          options.processedObjectKey ?? 'processed/opaque.mp4',
        thumbnail_object_key: 'thumbnails/opaque.jpg',
        duration_seconds: 10,
        visibility: options.visibility ?? VideoVisibility.PUBLIC,
        published_at:
          options.publishedAt === undefined
            ? new Date('2026-11-03T13:00:00.000Z')
            : options.publishedAt,
      }),
    );
  }

  it('redirects anonymous playback to a published public MP4', async () => {
    const owner = await registerConfirmAndLogin();
    const video = await createVideo(owner.email);
    const signGetObject = jest
      .spyOn(videoStorage, 'signGetObject')
      .mockResolvedValue({
        url: 'http://storage.example/signed-mp4',
        expiresAt: new Date(),
      });

    const response = await request(app.getHttpServer())
      .get(`/videos/${video.id}/playback`)
      .expect(302);

    expect(response.headers.location).toBe('http://storage.example/signed-mp4');
    expect(response.headers['cache-control']).toContain('no-store');
    expect(signGetObject).toHaveBeenCalledWith('processed/opaque.mp4');
  });

  it('allows an owner to play an unpublished ready video and protects another owner’s video', async () => {
    const owner = await registerConfirmAndLogin();
    const other = await registerConfirmAndLogin();
    const unpublished = await createVideo(owner.email, { publishedAt: null });
    const signGetObject = jest
      .spyOn(videoStorage, 'signGetObject')
      .mockResolvedValue({
        url: 'http://storage.example/signed-mp4',
        expiresAt: new Date(),
      });

    await request(app.getHttpServer())
      .get(`/videos/${unpublished.id}/playback`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(302);
    const denied = await request(app.getHttpServer())
      .get(`/videos/${unpublished.id}/playback`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .expect(403);

    expect(errorCode(denied)).toBe('VIDEO_ACCESS_DENIED');
    expect(signGetObject).toHaveBeenCalledTimes(1);
  });

  it('maps missing and unready playback targets without signing a URL', async () => {
    const owner = await registerConfirmAndLogin();
    const unready = await createVideo(owner.email, {
      status: VideoStatus.PROCESSING,
      processedObjectKey: null,
    });
    const signGetObject = jest.spyOn(videoStorage, 'signGetObject');

    const missing = await request(app.getHttpServer())
      .get(`/videos/${crypto.randomUUID()}/playback`)
      .expect(404);
    expect(errorCode(missing)).toBe('VIDEO_NOT_FOUND');
    const notReady = await request(app.getHttpServer())
      .get(`/videos/${unready.id}/playback`)
      .expect(409);
    expect(errorCode(notReady)).toBe('VIDEO_NOT_READY');
    expect(signGetObject).not.toHaveBeenCalled();
  });

  it('redirects the owner to the original as an attachment and denies other users', async () => {
    const owner = await registerConfirmAndLogin();
    const other = await registerConfirmAndLogin();
    const video = await createVideo(owner.email);
    const signGetObject = jest
      .spyOn(videoStorage, 'signGetObject')
      .mockResolvedValue({
        url: 'http://storage.example/signed-original',
        expiresAt: new Date(),
      });

    const response = await request(app.getHttpServer())
      .get(`/videos/${video.id}/download`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(302);
    expect(response.headers.location).toBe(
      'http://storage.example/signed-original',
    );
    expect(signGetObject).toHaveBeenCalledWith(
      video.original_object_key,
      `attachment; filename="video-${video.id}"`,
    );

    const denied = await request(app.getHttpServer())
      .get(`/videos/${video.id}/download`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .expect(403);
    expect(errorCode(denied)).toBe('VIDEO_ACCESS_DENIED');
    expect(signGetObject).toHaveBeenCalledTimes(1);
  });
});
