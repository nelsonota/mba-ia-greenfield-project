import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorageModule } from '../storage/storage.module';
import { QueueModule } from '../queue/queue.module';
import { Video } from './entities/video.entity';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';
import { UploadSessionService } from './upload-session.service';
import { VideoDeliveryService } from './video-delivery.service';

@Module({
  imports: [TypeOrmModule.forFeature([Video]), StorageModule, QueueModule],
  controllers: [VideosController],
  providers: [VideosService, UploadSessionService, VideoDeliveryService],
  exports: [VideosService, UploadSessionService, VideoDeliveryService],
})
export class VideosModule {}
