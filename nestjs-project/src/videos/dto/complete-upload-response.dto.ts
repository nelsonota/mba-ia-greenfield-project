import { ApiProperty } from '@nestjs/swagger';
import { VideoStatus } from '../entities/video.entity';

export class CompleteUploadResponseDto {
  @ApiProperty()
  videoId: string;

  @ApiProperty({ enum: VideoStatus })
  status: VideoStatus;
}
