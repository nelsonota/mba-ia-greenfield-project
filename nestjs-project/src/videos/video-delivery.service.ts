import type { Readable } from 'node:stream';
import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  RangeNotSatisfiableException,
  StorageUnavailableException,
  VideoNotFoundException,
} from '../common/exceptions/domain.exception';
import { STORAGE_ADAPTER } from '../storage/storage.constants';
import type { StorageAdapter } from '../storage/storage.types';
import { Video, VideoStatus } from './entities/video.entity';
import { parseByteRange } from './byte-range';

export interface VideoDeliveryStream {
  body: Readable;
  contentLength: number;
  contentType: string;
  statusCode: 200 | 206;
  contentRange?: string;
  contentDisposition?: string;
}

@Injectable()
export class VideoDeliveryService {
  constructor(
    @InjectRepository(Video) private readonly videos: Repository<Video>,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  async streamVideo(
    ownerId: string | undefined,
    videoId: string,
    rangeHeader: string | undefined,
  ): Promise<VideoDeliveryStream> {
    const video = await this.findAccessibleReadyVideo(ownerId, videoId);
    const metadata = await this.getStorageMetadata(video.source_object_key);
    const range = parseByteRange(rangeHeader, metadata.contentLength);
    const rangeHeaderValue = range
      ? `bytes=${range.start}-${range.end}`
      : undefined;

    try {
      const body = await this.storage.getObjectStream(
        video.source_object_key,
        rangeHeaderValue,
      );
      const contentLength = range
        ? range.end - range.start + 1
        : metadata.contentLength;
      return {
        body,
        contentLength,
        contentType: video.content_type,
        statusCode: range ? 206 : 200,
        ...(range && {
          contentRange: `bytes ${range.start}-${range.end}/${metadata.contentLength}`,
        }),
      };
    } catch {
      throw new StorageUnavailableException();
    }
  }

  async downloadVideo(
    ownerId: string | undefined,
    videoId: string,
  ): Promise<VideoDeliveryStream> {
    const video = await this.findAccessibleReadyVideo(ownerId, videoId);
    const metadata = await this.getStorageMetadata(video.source_object_key);
    try {
      const body = await this.storage.getObjectStream(video.source_object_key);
      return {
        body,
        contentLength: metadata.contentLength,
        contentType: video.content_type,
        statusCode: 200,
        contentDisposition: this.attachmentDisposition(video.file_name),
      };
    } catch {
      throw new StorageUnavailableException();
    }
  }

  private async findAccessibleReadyVideo(
    requesterId: string | undefined,
    videoId: string,
  ): Promise<Video> {
    const video = await this.videos.findOneBy({ id: videoId });
    if (!video || video.status !== VideoStatus.READY) {
      throw new VideoNotFoundException();
    }

    const isOwner = requesterId !== undefined && video.owner_id === requesterId;
    if (!isOwner && !video.published_at) throw new VideoNotFoundException();
    return video;
  }

  private async getStorageMetadata(
    objectKey: string,
  ): Promise<{ contentLength: number }> {
    try {
      const metadata = await this.storage.getObjectMetadata(objectKey);
      return { contentLength: metadata.contentLength };
    } catch (error) {
      if (error instanceof RangeNotSatisfiableException) throw error;
      throw new StorageUnavailableException();
    }
  }

  private attachmentDisposition(fileName: string): string {
    const safeName = Array.from(fileName, (character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return /[\\/"]/.test(character) || codePoint <= 0x1f || codePoint === 0x7f
        ? '_'
        : character;
    })
      .join('')
      .trim();
    const normalizedName = safeName || 'video';
    const fallback = normalizedName.replace(/[^\x20-\x7e]/g, '_');
    const encoded = encodeURIComponent(normalizedName).replace(
      /[!'()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
  }
}
