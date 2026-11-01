import { ApiProperty } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export class CompleteUploadDto {
  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: { partNumber: { type: 'number' }, eTag: { type: 'string' } },
    },
  })
  @Allow()
  parts: unknown;
}
