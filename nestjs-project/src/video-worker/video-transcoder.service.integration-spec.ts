import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VideoTranscoderService } from './video-transcoder.service';

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`${command} exited with code ${code}: ${stderr.trim()}`),
        );
    });
  });
}

describe('VideoTranscoderService with FFmpeg', () => {
  jest.setTimeout(30_000);

  let directory: string;
  let inputPath: string;
  let outputPath: string;
  let thumbnailPath: string;
  let transcoder: VideoTranscoderService;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'streamtube-ffmpeg-spec-'));
    inputPath = join(directory, 'input.mkv');
    outputPath = join(directory, 'normalized.mp4');
    thumbnailPath = join(directory, 'thumbnail.jpg');
    transcoder = new VideoTranscoderService();
    await run('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=160x120:rate=12:duration=2',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=1000:duration=2',
      '-shortest',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      inputPath,
    ]);
  });

  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('extracts duration and generates a valid MP4 and thumbnail', async () => {
    const sourceMetadata = await transcoder.probe(inputPath);
    expect(sourceMetadata.durationSeconds).toBeCloseTo(2, 0);

    await transcoder.createThumbnail(inputPath, 0.5, thumbnailPath);
    await transcoder.transcodeToMp4(inputPath, outputPath);

    const [thumbnail, normalized, outputMetadata] = await Promise.all([
      stat(thumbnailPath),
      stat(outputPath),
      transcoder.probe(outputPath),
    ]);
    expect(thumbnail.size).toBeGreaterThan(0);
    expect(normalized.size).toBeGreaterThan(0);
    expect(outputMetadata.durationSeconds).toBeCloseTo(2, 0);
  });
});
