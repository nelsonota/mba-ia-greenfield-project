import {
  Body,
  Controller,
  Delete,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Get,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { CreateVideoDto } from './dto/create-video.dto';
import { CreateVideoResponseDto } from './dto/create-video-response.dto';
import { VideosService } from './videos.service';
import { UploadSessionService } from './upload-session.service';
import { UploadPartsDto } from './dto/upload-parts.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { UploadPartsResponseDto } from './dto/upload-parts-response.dto';
import { CompleteUploadResponseDto } from './dto/complete-upload-response.dto';
import { OptionalAuth } from '../auth/decorators/optional-auth.decorator';
import { VideoDeliveryService } from './video-delivery.service';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(
    private readonly videosService: VideosService,
    private readonly uploadSessionService: UploadSessionService,
    private readonly videoDeliveryService: VideoDeliveryService,
  ) {}

  @Post()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a video draft and initialize a multipart upload',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Opaque key scoped to the authenticated owner',
  })
  @ApiResponse({ status: 201, type: CreateVideoResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Invalid upload metadata or idempotency key',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Authentication is required',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Idempotency key conflicts with an existing request',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 413,
    description: 'Video exceeds the 10 GB upload limit',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 503,
    description: 'Storage could not start the multipart session',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async create(
    @CurrentUser() user: JwtPayload,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateVideoDto,
  ): Promise<CreateVideoResponseDto> {
    return this.videosService.createDraft(user.sub, idempotencyKey, dto);
  }

  @Post(':videoId/upload-parts')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create signed URLs for multipart upload parts' })
  @ApiResponse({ status: 200, type: UploadPartsResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Part numbers are invalid',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'Video belongs to another owner',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video was not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Multipart upload is not active',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 503,
    description: 'Object storage is temporarily unavailable',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async signParts(
    @CurrentUser() user: JwtPayload,
    @Param('videoId') videoId: string,
    @Body() dto: UploadPartsDto,
  ): Promise<UploadPartsResponseDto> {
    return this.uploadSessionService.signUploadParts(
      user.sub,
      videoId,
      dto.partNumbers,
    );
  }

  @Post(':videoId/complete-upload')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Complete multipart upload and enqueue processing' })
  @ApiResponse({ status: 202, type: CompleteUploadResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Multipart parts or ETags are invalid',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'Video belongs to another owner',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video was not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Multipart upload is not active',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 503,
    description: 'Storage or processing queue is temporarily unavailable',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('videoId') videoId: string,
    @Body() dto: CompleteUploadDto,
  ): Promise<CompleteUploadResponseDto> {
    return this.uploadSessionService.completeUpload(
      user.sub,
      videoId,
      dto.parts,
    );
  }

  @Delete(':videoId/upload')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Abort an active multipart upload' })
  @ApiResponse({ status: 204, description: 'Upload aborted' })
  @ApiResponse({
    status: 403,
    description: 'Video belongs to another owner',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video was not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Multipart upload is not active',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 503,
    description: 'Object storage is temporarily unavailable',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async abortUpload(
    @CurrentUser() user: JwtPayload,
    @Param('videoId') videoId: string,
  ): Promise<void> {
    await this.uploadSessionService.abortUpload(user.sub, videoId);
  }

  @Get(':videoId/stream')
  @OptionalAuth()
  @ApiOperation({ summary: 'Stream a ready video, optionally by byte range' })
  @ApiHeader({ name: 'Range', required: false, example: 'bytes=0-1023' })
  @ApiResponse({ status: 200, description: 'Video stream' })
  @ApiResponse({ status: 206, description: 'Partial video stream' })
  @ApiResponse({
    status: 404,
    description: 'Video is unavailable',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 416,
    description: 'Requested range cannot be served',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 503,
    description: 'Storage is temporarily unavailable',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async stream(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('videoId') videoId: string,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const result = await this.videoDeliveryService.streamVideo(
      user?.sub,
      videoId,
      range,
    );
    response.status(result.statusCode);
    response.setHeader('Accept-Ranges', 'bytes');
    if (result.contentRange)
      response.setHeader('Content-Range', result.contentRange);
    return new StreamableFile(result.body, {
      type: result.contentType,
      length: result.contentLength,
    });
  }

  @Get(':videoId/download')
  @OptionalAuth()
  @ApiOperation({ summary: 'Download a ready video as an attachment' })
  @ApiResponse({ status: 200, description: 'Video attachment' })
  @ApiResponse({
    status: 404,
    description: 'Video is unavailable',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 503,
    description: 'Storage is temporarily unavailable',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async download(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('videoId') videoId: string,
  ): Promise<StreamableFile> {
    const result = await this.videoDeliveryService.downloadVideo(
      user?.sub,
      videoId,
    );
    return new StreamableFile(result.body, {
      type: result.contentType,
      length: result.contentLength,
      disposition: result.contentDisposition,
    });
  }
}
