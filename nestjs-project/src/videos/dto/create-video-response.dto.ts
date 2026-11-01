import { ApiProperty } from '@nestjs/swagger';
import { VideoStatus } from '../entities/video.entity';

export class CreateVideoResponseDto {
  @ApiProperty({ format: 'uuid' })
  videoId: string;

  @ApiProperty({ enum: VideoStatus, example: VideoStatus.DRAFT })
  status: VideoStatus;

  @ApiProperty({ type: 'object', properties: { uploadId: { type: 'string' } } })
  upload: { uploadId: string } | null;
}
