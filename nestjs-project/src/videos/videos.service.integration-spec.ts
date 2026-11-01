import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { User } from '../users/entities/user.entity';
import { cleanAllTables, createTestDataSource } from '../test/create-test-data-source';
import storageConfig from '../config/storage.config';
import { StorageUnavailableException } from '../common/exceptions/domain.exception';
import { S3StorageAdapter } from '../storage/s3-storage.adapter';
import { Video } from './entities/video.entity';
import { CreateVideoDto } from './dto/create-video.dto';
import { VideosService } from './videos.service';

describe('VideosService (integration)', () => {
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let userRepository: Repository<User>;
  let storage: S3StorageAdapter;
  let videosService: VideosService;

  const input: CreateVideoDto = {
    fileName: 'sample.mp4',
    contentType: 'video/mp4',
    sizeBytes: 1024,
  };

  beforeAll(async () => {
    dataSource = createTestDataSource([Video, User, Channel]);
    await dataSource.initialize();
    videoRepository = dataSource.getRepository(Video);
    userRepository = dataSource.getRepository(User);
    storage = new S3StorageAdapter(storageConfig());
    await storage.onModuleInit();
    videosService = new VideosService(videoRepository, dataSource, storage);
  });

  afterAll(async () => {
    await cleanData();
    await dataSource.destroy();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await cleanData();
  });

  afterEach(async () => {
    await cleanData();
  });

  async function createOwner(): Promise<User> {
    return userRepository.save(
      userRepository.create({
        email: `${randomUUID()}@example.com`,
        password: 'hashed-password',
        is_confirmed: true,
      }),
    );
  }

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
    await cleanAllTables(dataSource);
  }

  it('persists one draft and opens one real RustFS session for concurrent retries', async () => {
    const owner = await createOwner();
    const idempotencyKey = randomUUID();
    const createSession = jest.spyOn(storage, 'createMultipartUpload');

    const [first, retry] = await Promise.all([
      videosService.createDraft(owner.id, idempotencyKey, input),
      videosService.createDraft(owner.id, idempotencyKey, input),
    ]);

    expect(retry).toEqual(first);
    expect(first.upload?.uploadId).toBeTruthy();
    expect(createSession).toHaveBeenCalledTimes(1);
    await expect(
      videoRepository.findBy({
        owner_id: owner.id,
        idempotency_key: idempotencyKey,
      }),
    ).resolves.toHaveLength(1);
  });

  it('retains a recoverable draft after a storage failure and initializes it on retry', async () => {
    const owner = await createOwner();
    const idempotencyKey = randomUUID();
    const createSession = jest
      .spyOn(storage, 'createMultipartUpload')
      .mockRejectedValueOnce(new Error('temporary storage outage'));

    await expect(
      videosService.createDraft(owner.id, idempotencyKey, input),
    ).rejects.toBeInstanceOf(StorageUnavailableException);

    const recoverableDraft = await videoRepository.findOneBy({
      owner_id: owner.id,
      idempotency_key: idempotencyKey,
    });
    expect(recoverableDraft).toMatchObject({
      status: 'draft',
      multipart_upload_id: null,
    });

    const retry = await videosService.createDraft(
      owner.id,
      idempotencyKey,
      input,
    );

    expect(retry.videoId).toBe(recoverableDraft?.id);
    expect(retry.upload?.uploadId).toBeTruthy();
    expect(createSession).toHaveBeenCalledTimes(2);
    await expect(
      videoRepository.findBy({
        owner_id: owner.id,
        idempotency_key: idempotencyKey,
      }),
    ).resolves.toHaveLength(1);
  });
});
