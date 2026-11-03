import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import storageConfig from '../config/storage.config';
import { Channel } from '../channels/entities/channel.entity';
import { Video } from './entities/video.entity';
import { VideoStorageService } from './storage/video-storage.service';
import { VideoUploadService } from './video-upload.service';
import { VideosController } from './videos.controller';
import { VideoQueue } from './queue/video-queue.service';
import { VideoDeliveryService } from './video-delivery.service';
import {
  VIDEO_PROCESSING_QUEUE,
  VIDEO_QUEUE_DEFAULT_JOB_OPTIONS,
} from './queue/video-queue.constants';

@Module({
  imports: [
    ConfigModule.forFeature(storageConfig),
    TypeOrmModule.forFeature([Video, Channel]),
    BullModule.registerQueue({
      name: VIDEO_PROCESSING_QUEUE,
      defaultJobOptions: VIDEO_QUEUE_DEFAULT_JOB_OPTIONS,
    }),
  ],
  controllers: [VideosController],
  providers: [
    VideoStorageService,
    VideoUploadService,
    VideoQueue,
    VideoDeliveryService,
  ],
  exports: [
    TypeOrmModule,
    VideoStorageService,
    VideoUploadService,
    VideoQueue,
    VideoDeliveryService,
  ],
})
export class VideosModule {}
