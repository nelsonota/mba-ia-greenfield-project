import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { VideoWorkerModule } from './video-worker/video-worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(VideoWorkerModule);
  app.enableShutdownHooks();
}

bootstrap().catch((error: unknown) => {
  const logger = new Logger('VideoWorker');
  logger.error('Video worker failed to start', error);
  process.exitCode = 1;
});
