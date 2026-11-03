import * as crypto from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/mail/mail.service';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import { UPLOAD_PART_SIZE_BYTES } from '../src/videos/video-upload.constants';
import { VideoStorageService } from '../src/videos/storage/video-storage.service';
import {
  PROCESS_VIDEO_JOB,
  ProcessVideoJob,
  VIDEO_PROCESSING_QUEUE,
} from '../src/videos/queue/video-queue.constants';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { accessToken, errorCode, videoId } from './video-e2e-helpers';

jest.setTimeout(60_000);

describe('videos-upload-finalize', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let videoStorage: VideoStorageService;
  let throttlerStorage: ThrottlerStorageService;
  let videoQueue: Queue<ProcessVideoJob>;

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
    videoRepository = dataSource.getRepository(Video);
    videoStorage = moduleFixture.get(VideoStorageService);
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
    videoQueue = moduleFixture.get<Queue<ProcessVideoJob>>(
      getQueueToken(VIDEO_PROCESSING_QUEUE),
    );
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

  async function startUpload(accessToken: string) {
    return request(app.getHttpServer())
      .post('/videos/uploads')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        originalFilename: 'lecture.mp4',
        contentType: 'video/mp4',
        sizeBytes: UPLOAD_PART_SIZE_BYTES + 1,
      })
      .expect(201);
  }

  function complete(
    accessToken: string,
    videoId: string,
    parts = [
      { partNumber: 1, eTag: 'etag-one' },
      { partNumber: 2, eTag: 'etag-two' },
    ],
  ) {
    return request(app.getHttpServer())
      .post(`/videos/${videoId}/complete`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ parts });
  }

  it('completes multipart before returning the processing state', async () => {
    const owner = await registerConfirmAndLogin();
    const upload = await startUpload(owner.accessToken);
    const completeMultipart = jest
      .spyOn(videoStorage, 'completeMultipart')
      .mockResolvedValue(undefined);

    const response = await complete(owner.accessToken, videoId(upload)).expect(
      202,
    );

    expect(response.body).toEqual({
      videoId: videoId(upload),
      status: 'processing',
    });
    expect(completeMultipart).toHaveBeenCalledWith(
      expect.stringMatching(/^original\//),
      expect.any(String),
      [
        { partNumber: 1, eTag: 'etag-one' },
        { partNumber: 2, eTag: 'etag-two' },
      ],
    );
    const video = await videoRepository.findOneByOrFail({
      id: videoId(upload),
    });
    expect(video).toMatchObject({
      status: VideoStatus.PROCESSING,
      multipart_upload_id: null,
    });
    const job = await videoQueue.getJob(`video-${videoId(upload)}`);
    expect(job).toBeInstanceOf(Job);
    expect(job?.name).toBe(PROCESS_VIDEO_JOB);
    expect(job?.data).toEqual({
      videoId: videoId(upload),
      objectKey: video.original_object_key,
    });
    expect(job?.opts).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      jobId: `video-${videoId(upload)}`,
    });
  });

  it('rejects invalid parts and completes idempotently when retried', async () => {
    const owner = await registerConfirmAndLogin();
    const upload = await startUpload(owner.accessToken);
    const completeMultipart = jest
      .spyOn(videoStorage, 'completeMultipart')
      .mockResolvedValue(undefined);

    const invalid = await complete(owner.accessToken, videoId(upload), [
      { partNumber: 1, eTag: 'etag-one' },
    ]).expect(400);
    expect(errorCode(invalid)).toBe('INVALID_UPLOAD_PARTS');

    await complete(owner.accessToken, videoId(upload)).expect(202);
    await complete(owner.accessToken, videoId(upload)).expect(202);
    expect(completeMultipart).toHaveBeenCalledTimes(1);
  });

  it('denies completion and abort to a different channel', async () => {
    const owner = await registerConfirmAndLogin();
    const other = await registerConfirmAndLogin();
    const upload = await startUpload(owner.accessToken);

    const completion = await complete(
      other.accessToken,
      videoId(upload),
    ).expect(403);
    expect(errorCode(completion)).toBe('VIDEO_ACCESS_DENIED');
    const abort = await request(app.getHttpServer())
      .delete(`/videos/${videoId(upload)}/upload`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .expect(403);
    expect(errorCode(abort)).toBe('VIDEO_ACCESS_DENIED');
  });

  it('lets the owner abort and clears the multipart upload state', async () => {
    const owner = await registerConfirmAndLogin();
    const upload = await startUpload(owner.accessToken);

    await request(app.getHttpServer())
      .delete(`/videos/${videoId(upload)}/upload`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(204);

    await expect(
      videoRepository.findOneByOrFail({ id: videoId(upload) }),
    ).resolves.toMatchObject({
      status: VideoStatus.DRAFT,
      multipart_upload_id: null,
    });
    const closed = await complete(owner.accessToken, videoId(upload)).expect(
      409,
    );
    expect(errorCode(closed)).toBe('UPLOAD_NOT_IN_PROGRESS');
  });
});
