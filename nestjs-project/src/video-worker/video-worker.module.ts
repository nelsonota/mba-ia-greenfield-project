import { Module } from '@nestjs/common';
import { AppModule } from '../app.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Video } from '../videos/entities/video.entity';
import { VideosModule } from '../videos/videos.module';
import { VideoProcessingConsumer } from './video-processing.consumer';
import { VideoProcessingService } from './video-processing.service';
import { VideoTranscoderService } from './video-transcoder.service';

@Module({
  imports: [AppModule, VideosModule, TypeOrmModule.forFeature([Video])],
  providers: [
    VideoProcessingConsumer,
    VideoProcessingService,
    VideoTranscoderService,
  ],
})
export class VideoWorkerModule {}
