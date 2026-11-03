import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsInt,
} from 'class-validator';
import { MAX_MULTIPART_PARTS } from '../video-upload.constants';

export class RequestUploadPartsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_MULTIPART_PARTS)
  @ArrayUnique()
  @IsInt({ each: true })
  partNumbers: number[];
}
