import { ApiProperty } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export class UploadPartsDto {
  @ApiProperty({ type: [Number], example: [1, 2] })
  @Allow()
  partNumbers: unknown;
}
