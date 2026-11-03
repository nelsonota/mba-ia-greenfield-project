import {
  IsInt,
  IsMimeType,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_VIDEO_SIZE_BYTES } from '../video-upload.constants';

export class CreateVideoUploadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  originalFilename: string;

  @IsString()
  @IsMimeType()
  contentType: string;

  @IsInt()
  @Min(1)
  @Max(MAX_VIDEO_SIZE_BYTES)
  sizeBytes: number;
}
