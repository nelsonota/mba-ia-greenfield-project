import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Redirect,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { Public } from '../auth/decorators/public.decorator';
import { CreateVideoUploadDto } from './dto/create-video-upload.dto';
import { RequestUploadPartsDto } from './dto/request-upload-parts.dto';
import { CompleteVideoUploadDto } from './dto/complete-video-upload.dto';
import { VideoDeliveryService } from './video-delivery.service';
import { StartedVideoUpload, VideoUploadService } from './video-upload.service';
import type { SignedUploadPart } from './video-upload.service';

@Controller('videos')
export class VideosController {
  constructor(
    private readonly videoUploadService: VideoUploadService,
    private readonly videoDeliveryService: VideoDeliveryService,
  ) {}

  @Post('uploads')
  startUpload(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVideoUploadDto,
  ): Promise<StartedVideoUpload> {
    return this.videoUploadService.startUpload(user.sub, dto);
  }

  @Post(':videoId/upload-parts')
  @HttpCode(HttpStatus.OK)
  requestUploadParts(
    @CurrentUser() user: JwtPayload,
    @Param('videoId') videoId: string,
    @Body() dto: RequestUploadPartsDto,
  ): Promise<{ parts: SignedUploadPart[] }> {
    return this.videoUploadService.signUploadParts(
      user.sub,
      videoId,
      dto.partNumbers,
    );
  }

  @Post(':videoId/complete')
  @HttpCode(HttpStatus.ACCEPTED)
  completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('videoId') videoId: string,
    @Body() dto: CompleteVideoUploadDto,
  ) {
    return this.videoUploadService.completeUpload(user.sub, videoId, dto.parts);
  }

  @Delete(':videoId/upload')
  @HttpCode(HttpStatus.NO_CONTENT)
  async abortUpload(
    @CurrentUser() user: JwtPayload,
    @Param('videoId') videoId: string,
  ): Promise<void> {
    await this.videoUploadService.abortUpload(user.sub, videoId);
  }

  @Get(':videoId/playback')
  @Public()
  @Redirect()
  @Header('Cache-Control', 'private, no-store')
  async playback(
    @Param('videoId') videoId: string,
    @CurrentUser() user: JwtPayload | undefined,
  ): Promise<{ url: string; statusCode: number }> {
    const { url } = await this.videoDeliveryService.playback(
      videoId,
      user?.sub,
    );
    return { url, statusCode: HttpStatus.FOUND };
  }

  @Get(':videoId/download')
  @Redirect()
  @Header('Cache-Control', 'private, no-store')
  async download(
    @CurrentUser() user: JwtPayload,
    @Param('videoId') videoId: string,
  ): Promise<{ url: string; statusCode: number }> {
    const { url } = await this.videoDeliveryService.download(videoId, user.sub);
    return { url, statusCode: HttpStatus.FOUND };
  }
}
