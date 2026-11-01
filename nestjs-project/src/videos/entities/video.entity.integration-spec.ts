import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import { User } from '../../users/entities/user.entity';
import { createTestDataSource } from '../../test/create-test-data-source';
import { Video, VideoStatus } from './video.entity';

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let userRepository: Repository<User>;

  beforeAll(async () => {
    dataSource = createTestDataSource([Video, User, Channel]);
    await dataSource.initialize();
    videoRepository = dataSource.getRepository(Video);
    userRepository = dataSource.getRepository(User);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM "videos"');
    await dataSource.query('DELETE FROM "channels"');
    await dataSource.query('DELETE FROM "users"');
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

  function createVideo(ownerId: string, overrides: Partial<Video> = {}): Video {
    return videoRepository.create({
      owner_id: ownerId,
      idempotency_key: randomUUID(),
      source_object_key: `videos/${randomUUID()}/original`,
      file_name: 'sample.mp4',
      content_type: 'video/mp4',
      size_bytes: '1024',
      ...overrides,
    });
  }

  it('generates an identity and applies draft, upload, and timestamp defaults', async () => {
    const owner = await createOwner();
    const saved = await videoRepository.save(createVideo(owner.id));

    expect(saved.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(saved.status).toBe(VideoStatus.DRAFT);
    expect(saved.multipart_upload_id).toBeNull();
    expect(saved.created_at).toBeInstanceOf(Date);
    expect(saved.updated_at).toBeInstanceOf(Date);
  });

  it('enforces owner-scoped idempotency and allows the same key for another owner', async () => {
    const firstOwner = await createOwner();
    const secondOwner = await createOwner();
    const key = 'client-request-1';

    await videoRepository.save(
      createVideo(firstOwner.id, { idempotency_key: key }),
    );
    await expect(
      videoRepository.save(
        createVideo(firstOwner.id, { idempotency_key: key }),
      ),
    ).rejects.toThrow();

    await expect(
      videoRepository.save(
        createVideo(secondOwner.id, { idempotency_key: key }),
      ),
    ).resolves.toMatchObject({ idempotency_key: key });
  });

  it('enforces owner integrity, unique storage keys, and the supported size range', async () => {
    const owner = await createOwner();
    const sourceObjectKey = `videos/${randomUUID()}/original`;
    await videoRepository.save(
      createVideo(owner.id, { source_object_key: sourceObjectKey }),
    );

    await expect(
      videoRepository.save(
        createVideo(owner.id, { source_object_key: sourceObjectKey }),
      ),
    ).rejects.toThrow();
    await expect(
      videoRepository.save(
        createVideo(randomUUID(), { idempotency_key: randomUUID() }),
      ),
    ).rejects.toThrow();
    await expect(
      videoRepository.save(
        createVideo(owner.id, {
          size_bytes: '10000000001',
          idempotency_key: randomUUID(),
        }),
      ),
    ).rejects.toThrow();
  });
});
