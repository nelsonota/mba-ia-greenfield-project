import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateVideoDto {
  @ApiProperty({ maxLength: 255, example: 'lecture.mp4' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName: string;

  @ApiProperty({ example: 'video/mp4', pattern: '^video/' })
  @IsString()
  @Matches(/^video\/[a-zA-Z0-9][a-zA-Z0-9.+-]*$/)
  contentType: string;

  @ApiProperty({ minimum: 1, example: 1048576, type: Number })
  @IsInt()
  @Min(1)
  sizeBytes: number;
}
