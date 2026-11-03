import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { Channel } from '../../channels/entities/channel.entity';
import { User } from '../../users/entities/user.entity';
import { Video, VideoStatus } from './video.entity';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  let userCounter = 0;
  async function createChannel(): Promise<Channel> {
    const user = await userRepository.save(
      userRepository.create({
        email: `video_user_${++userCounter}@example.com`,
        password: 'hashed',
      }),
    );

    return channelRepository.save(
      channelRepository.create({
        name: 'Video Channel',
        nickname: `video_${userCounter}`,
        user_id: user.id,
      }),
    );
  }

  function createDraft(channel_id: string): Video {
    return videoRepository.create({
      channel_id,
      status: VideoStatus.DRAFT,
      original_object_key: 'originals/video-id/source',
      multipart_upload_id: 'multipart-id',
      original_size_bytes: '10737418240',
      original_content_type: 'video/mp4',
    });
  }

  it('should persist a draft with UUID, bigint size, and generated timestamps', async () => {
    const channel = await createChannel();
    const video = await videoRepository.save(createDraft(channel.id));

    expect(video.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(video.status).toBe(VideoStatus.DRAFT);
    expect(video.original_size_bytes).toBe('10737418240');
    expect(video.created_at).toBeInstanceOf(Date);
    expect(video.updated_at).toBeInstanceOf(Date);
    expect(video.processed_object_key).toBeNull();
    expect(video.thumbnail_object_key).toBeNull();
    expect(video.duration_seconds).toBeNull();
  });

  it('should enforce the allowed status values', async () => {
    const channel = await createChannel();
    const invalidVideo = videoRepository.create({
      ...createDraft(channel.id),
      status: 'published' as VideoStatus,
    });

    await expect(videoRepository.save(invalidVideo)).rejects.toThrow();
  });

  it('should reject a video whose channel does not exist', async () => {
    const video = createDraft('00000000-0000-4000-8000-000000000001');

    await expect(videoRepository.save(video)).rejects.toThrow();
  });

  it('should load videos through the channel relation and create the required indexes', async () => {
    const channel = await createChannel();
    await videoRepository.save(createDraft(channel.id));

    const found = await channelRepository.findOne({
      where: { id: channel.id },
      relations: ['videos'],
    });
    const indexes = await dataSource.query<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'videos'`,
    );

    expect(found?.videos).toHaveLength(1);
    expect(indexes.map((index) => index.indexname)).toEqual(
      expect.arrayContaining(['IDX_videos_channel_id', 'IDX_videos_status']),
    );
  });
});
