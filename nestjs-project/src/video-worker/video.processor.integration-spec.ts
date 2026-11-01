import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { DataSource, Repository } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { S3StorageAdapter } from '../storage/s3-storage.adapter';
import storageConfig from '../config/storage.config';
import { Video, VideoStatus } from '../videos/entities/video.entity';
import { FfmpegService } from './ffmpeg.service';
import { VideoProcessor } from './video.processor';
import type { ProcessVideoJobData } from './video-processing.types';
import { PROCESS_VIDEO_JOB } from '../queue/queue.constants';
import type { Job } from 'bullmq';

describe('VideoProcessor (integration)', () => {
  let db: DataSource;
  let users: Repository<User>;
  let videos: Repository<Video>;
  let storage: S3StorageAdapter;
  let processor: VideoProcessor;
  let temporaryDirectory: string;
  let sourceObjectKey: string;
  let thumbnailObjectKey: string;
  let videoId: string;

  beforeAll(async () => {
    db = createTestDataSource([Video, User, Channel]);
    await db.initialize();
    users = db.getRepository(User);
    videos = db.getRepository(Video);
    storage = new S3StorageAdapter(storageConfig());
    await storage.onModuleInit();
    processor = new VideoProcessor(db, storage, new FfmpegService());
    temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'streamtube-video-test-'),
    );
  });

  beforeEach(async () => {
    await clean();
    videoId = randomUUID();
    sourceObjectKey = `integration/${videoId}/source`;
    thumbnailObjectKey = `videos/${videoId}/thumbnail.jpg`;
  });

  afterEach(clean);

  afterAll(async () => {
    await clean();
    if (db?.isInitialized) await db.destroy();
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  async function clean(): Promise<void> {
    if (!db?.isInitialized) return;
    if (sourceObjectKey)
      await storage.deleteObject(sourceObjectKey).catch(() => undefined);
    if (thumbnailObjectKey)
      await storage.deleteObject(thumbnailObjectKey).catch(() => undefined);
    await cleanAllTables(db);
  }

  it('probes a real video, generates a JPEG and persists ready metadata', async () => {
    const sourcePath = join(temporaryDirectory, `${videoId}.mp4`);
    await runFfmpeg([
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=160x120:rate=24:duration=2',
      '-c:v',
      'mpeg4',
      '-q:v',
      '5',
      '-an',
      '-movflags',
      '+faststart',
      '-y',
      sourcePath,
    ]);
    await storage.putObject(
      sourceObjectKey,
      await readFile(sourcePath),
      'video/mp4',
    );

    const owner = await users.save(
      users.create({
        email: `${videoId}@example.com`,
        password: 'hashed-password',
        is_confirmed: true,
      }),
    );
    await videos.save(
      videos.create({
        id: videoId,
        owner_id: owner.id,
        status: VideoStatus.PROCESSING,
        idempotency_key: videoId,
        source_object_key: sourceObjectKey,
        multipart_upload_id: null,
        file_name: 'generated.mp4',
        content_type: 'video/mp4',
        size_bytes: String((await readFile(sourcePath)).length),
        duration_seconds: null,
        metadata: null,
        thumbnail_object_key: null,
      }),
    );

    await processor.process(createJob());

    const persisted = await videos.findOneByOrFail({ id: videoId });
    expect(persisted.status).toBe(VideoStatus.READY);
    expect(Number(persisted.duration_seconds)).toBeGreaterThan(0);
    expect(persisted.metadata).toMatchObject({
      videoCodec: 'mpeg4',
      width: 160,
      height: 120,
    });
    expect(persisted.thumbnail_object_key).toBe(thumbnailObjectKey);
    const thumbnail = await readStream(
      await storage.getObjectStream(thumbnailObjectKey),
    );
    expect(thumbnail.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));

    await processor.process(createJob());
    expect(
      await videos.countBy({ id: videoId, status: VideoStatus.READY }),
    ).toBe(1);
  });

  function createJob(): Job<ProcessVideoJobData> {
    return {
      name: PROCESS_VIDEO_JOB,
      data: { videoId, sourceObjectKey },
      attemptsMade: 0,
      opts: { attempts: 5 },
    } as Job<ProcessVideoJobData>;
  }
});

async function runFfmpeg(args: string[]): Promise<void> {
  const executable = process.env.FFMPEG_PATH ?? 'ffmpeg';
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true });
    let errorOutput = '';
    child.stderr.on('data', (chunk: Buffer) => {
      errorOutput += chunk.toString('utf8');
    });
    child.once('error', () =>
      reject(new Error('FFmpeg executable is unavailable')),
    );
    child.once('close', (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(`FFmpeg fixture generation failed (${errorOutput})`));
    });
  });
}

async function readStream(stream: Readable): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
