import { ApiProperty } from '@nestjs/swagger';

export class UploadPartsResponseDto {
  @ApiProperty()
  videoId: string;

  @ApiProperty()
  uploadId: string;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  urls: Record<string, string>;
}
