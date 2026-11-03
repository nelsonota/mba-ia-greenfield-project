import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Video, VideoStatus, VideoVisibility } from './entities/video.entity';
import {
  VideoAccessDeniedException,
  VideoNotFoundException,
  VideoNotReadyException,
} from './exceptions/video-upload.exceptions';
import { VideoStorageService } from './storage/video-storage.service';

@Injectable()
export class VideoDeliveryService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storage: VideoStorageService,
  ) {}

  async playback(
    videoId: string,
    requesterId?: string,
  ): Promise<{ url: string }> {
    const video = await this.findVideo(videoId);
    const isOwner =
      requesterId !== undefined && video.channel.user_id === requesterId;
    const isPublishedPublic =
      video.visibility === VideoVisibility.PUBLIC &&
      Boolean(video.published_at);
    if (!isPublishedPublic && !isOwner) throw new VideoAccessDeniedException();
    if (video.status !== VideoStatus.READY || !video.processed_object_key) {
      throw new VideoNotReadyException();
    }

    return this.storage.signGetObject(video.processed_object_key);
  }

  async download(
    videoId: string,
    requesterId: string,
  ): Promise<{ url: string }> {
    const video = await this.findVideo(videoId);
    if (video.channel.user_id !== requesterId)
      throw new VideoAccessDeniedException();
    if (video.status !== VideoStatus.READY || !video.original_object_key) {
      throw new VideoNotReadyException();
    }

    return this.storage.signGetObject(
      video.original_object_key,
      `attachment; filename="video-${video.id}"`,
    );
  }

  private async findVideo(videoId: string): Promise<Video> {
    const video = await this.videoRepository.findOne({
      where: { id: videoId },
      relations: { channel: true },
    });
    if (!video) throw new VideoNotFoundException();
    return video;
  }
}
