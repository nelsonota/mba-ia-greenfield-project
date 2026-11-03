import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';

export interface ProbedVideoMetadata {
  durationSeconds: number;
}

@Injectable()
export class VideoTranscoderService {
  async probe(inputPath: string): Promise<ProbedVideoMetadata> {
    const output = await this.run('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'json',
      inputPath,
    ]);
    const result = JSON.parse(output) as { format?: { duration?: string } };
    const durationSeconds = Number(result.format?.duration);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error('Video metadata did not include a valid duration');
    }
    return { durationSeconds };
  }

  async createThumbnail(
    inputPath: string,
    seekSeconds: number,
    outputPath: string,
  ): Promise<void> {
    await this.run('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      String(seekSeconds),
      '-i',
      inputPath,
      '-frames:v',
      '1',
      '-vf',
      'scale=1280:-2:force_original_aspect_ratio=decrease',
      '-q:v',
      '2',
      outputPath,
    ]);
  }

  async transcodeToMp4(inputPath: string, outputPath: string): Promise<void> {
    await this.run('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      inputPath,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      outputPath,
    ]);
  }

  private run(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-16_384);
      });
      child.once('error', (error) =>
        reject(new Error(`${command} could not start: ${error.message}`)),
      );
      child.once('close', (code) => {
        if (code === 0) {
          resolve(stdout);
          return;
        }
        reject(
          new Error(`${command} exited with code ${code}: ${stderr.trim()}`),
        );
      });
    });
  }
}
