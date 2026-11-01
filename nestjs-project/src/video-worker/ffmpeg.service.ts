import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type {
  ExtractedVideoMetadata,
  ProcessedVideoMedia,
} from './video-processing.types';

const PROCESS_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_STDOUT_BYTES = 2 * 1024 * 1024;
const MAX_STDERR_BYTES = 16 * 1024;

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
}

interface ProbeResult {
  streams?: ProbeStream[];
  format?: {
    duration?: string;
    format_name?: string;
    bit_rate?: string;
  };
}

@Injectable()
export class FfmpegService {
  async inspectAndExtractThumbnail(
    source: Readable,
    durationHintSeconds: string,
  ): Promise<{ media: ProcessedVideoMedia; thumbnail: Buffer }> {
    const directory = await mkdtemp(join(tmpdir(), 'streamtube-video-'));
    const inputPath = join(directory, 'source-media');
    const thumbnailPath = join(directory, 'thumbnail.jpg');

    try {
      await pipeline(source, createWriteStream(inputPath));
      const probeOutput = await this.run('ffprobe', [
        '-v',
        'error',
        '-show_format',
        '-show_streams',
        '-of',
        'json',
        inputPath,
      ]);
      const probe = this.parseProbe(probeOutput.stdout);
      const duration = Number(probe.format?.duration ?? durationHintSeconds);
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error('VIDEO_DURATION_UNAVAILABLE');
      }

      const seekSeconds = Math.min(duration / 2, 30);
      await this.run('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-ss',
        String(seekSeconds),
        '-i',
        inputPath,
        '-map',
        '0:v:0',
        '-frames:v',
        '1',
        '-vf',
        'scale=640:-2:force_original_aspect_ratio=decrease',
        '-q:v',
        '2',
        '-f',
        'image2',
        thumbnailPath,
      ]);
      const thumbnail = await readFile(thumbnailPath);
      if (thumbnail.length === 0) throw new Error('VIDEO_THUMBNAIL_EMPTY');

      return {
        media: {
          durationSeconds: String(duration),
          metadata: this.toMetadata(probe),
        },
        thumbnail,
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async run(
    executable: 'ffmpeg' | 'ffprobe',
    args: string[],
  ): Promise<{ stdout: string }> {
    const command =
      executable === 'ffmpeg'
        ? (process.env.FFMPEG_PATH ?? 'ffmpeg')
        : (process.env.FFPROBE_PATH ?? 'ffprobe');

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { shell: false, windowsHide: true });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;

      const finishError = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.kill('SIGKILL');
        reject(error);
      };

      const timeout = setTimeout(
        () => finishError(new Error('VIDEO_PROCESSING_TIMEOUT')),
        PROCESS_TIMEOUT_MS,
      );

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_STDOUT_BYTES) {
          finishError(new Error('VIDEO_PROBE_OUTPUT_TOO_LARGE'));
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderrBytes < MAX_STDERR_BYTES) {
          const remaining = MAX_STDERR_BYTES - stderrBytes;
          stderr.push(chunk.subarray(0, remaining));
          stderrBytes += Math.min(chunk.length, remaining);
        }
      });
      child.once('error', () =>
        finishError(new Error('VIDEO_PROCESSOR_UNAVAILABLE')),
      );
      child.once('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error('VIDEO_MEDIA_PROCESSING_FAILED'));
          return;
        }
        resolve({ stdout: Buffer.concat(stdout).toString('utf8') });
      });
    });
  }

  private parseProbe(stdout: string): ProbeResult {
    let probe: ProbeResult;
    try {
      probe = JSON.parse(stdout) as ProbeResult;
    } catch {
      throw new Error('VIDEO_METADATA_INVALID');
    }
    if (!Array.isArray(probe.streams)) throw new Error('VIDEO_STREAMS_MISSING');
    if (!probe.streams.some((stream) => stream.codec_type === 'video')) {
      throw new Error('VIDEO_STREAM_MISSING');
    }
    return probe;
  }

  private toMetadata(probe: ProbeResult): ExtractedVideoMetadata {
    const video = probe.streams?.find(
      (stream) => stream.codec_type === 'video',
    );
    const audio = probe.streams?.find(
      (stream) => stream.codec_type === 'audio',
    );
    return {
      container: probe.format?.format_name ?? null,
      videoCodec: video?.codec_name ?? 'unknown',
      width: typeof video?.width === 'number' ? video.width : null,
      height: typeof video?.height === 'number' ? video.height : null,
      frameRate: this.isValidFrameRate(video?.avg_frame_rate)
        ? video!.avg_frame_rate!
        : this.isValidFrameRate(video?.r_frame_rate)
          ? video!.r_frame_rate!
          : null,
      audioCodec: audio?.codec_name ?? null,
      bitRate: probe.format?.bit_rate ?? null,
    };
  }

  private isValidFrameRate(value: string | undefined): boolean {
    if (!value) return false;
    const [numerator, denominator] = value.split('/').map(Number);
    return (
      Number.isFinite(numerator) &&
      Number.isFinite(denominator) &&
      denominator !== 0
    );
  }
}
