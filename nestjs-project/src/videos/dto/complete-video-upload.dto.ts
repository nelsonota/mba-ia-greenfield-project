import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MAX_MULTIPART_PARTS } from '../video-upload.constants';

export class CompletedUploadPartDto {
  @IsInt()
  @Min(1)
  partNumber: number;

  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  eTag: string;
}

export class CompleteVideoUploadDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_MULTIPART_PARTS)
  @ValidateNested({ each: true })
  @Type(() => CompletedUploadPartDto)
  parts: CompletedUploadPartDto[];
}
