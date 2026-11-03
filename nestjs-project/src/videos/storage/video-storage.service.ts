import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import storageConfig from '../../config/storage.config';
import { StorageUnavailableException } from '../exceptions/storage-unavailable.exception';
import {
  InvalidUploadPartsException,
  UploadNotInProgressException,
} from '../exceptions/video-upload.exceptions';

export interface MultipartPart {
  partNumber: number;
  eTag: string;
}

export interface StoredObject {
  body: Readable;
  contentType?: string;
  contentLength?: number;
  contentRange?: string;
  acceptRanges?: string;
}

@Injectable()
export class VideoStorageService implements OnModuleDestroy {
  private readonly client: S3Client;
  private readonly publicClient: S3Client;

  constructor(
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {
    this.client = this.createClient(config.endpoint);
    this.publicClient = this.createClient(config.publicEndpoint);
  }

  onModuleDestroy(): void {
    this.client.destroy();
    this.publicClient.destroy();
  }

  async initiateMultipart(key: string, contentType: string): Promise<string> {
    try {
      const result = await this.client.send(
        new CreateMultipartUploadCommand({
          Bucket: this.config.bucket,
          Key: key,
          ContentType: contentType,
        }),
      );
      if (!result.UploadId)
        throw new Error('Storage returned no multipart upload ID');
      return result.UploadId;
    } catch {
      throw new StorageUnavailableException();
    }
  }

  async signUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
  ): Promise<{ url: string; expiresAt: Date }> {
    try {
      const url = await getSignedUrl(
        this.publicClient,
        new UploadPartCommand({
          Bucket: this.config.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
        }),
        { expiresIn: this.config.signedUrlExpiresIn },
      );
      return {
        url,
        expiresAt: new Date(Date.now() + this.config.signedUrlExpiresIn * 1000),
      };
    } catch {
      throw new StorageUnavailableException();
    }
  }

  async completeMultipart(
    key: string,
    uploadId: string,
    parts: MultipartPart[],
  ): Promise<void> {
    try {
      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.config.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map(({ partNumber, eTag }) => ({
              PartNumber: partNumber,
              ETag: eTag,
            })),
          },
        }),
      );
    } catch (error) {
      const errorName = error instanceof Error ? error.name : '';
      if (errorName === 'InvalidPart' || errorName === 'InvalidPartOrder') {
        throw new InvalidUploadPartsException();
      }
      if (errorName === 'NoSuchUpload')
        throw new UploadNotInProgressException();
      throw new StorageUnavailableException();
    }
  }

  async abortMultipart(key: string, uploadId: string): Promise<void> {
    try {
      await this.client.send(
        new AbortMultipartUploadCommand({
          Bucket: this.config.bucket,
          Key: key,
          UploadId: uploadId,
        }),
      );
    } catch {
      throw new StorageUnavailableException();
    }
  }

  async getObject(key: string, range?: string): Promise<StoredObject> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Range: range,
        }),
      );
      if (!(result.Body instanceof Readable))
        throw new Error('Storage returned a non-readable body');
      return {
        body: result.Body,
        contentType: result.ContentType,
        contentLength: result.ContentLength,
        contentRange: result.ContentRange,
        acceptRanges: result.AcceptRanges,
      };
    } catch {
      throw new StorageUnavailableException();
    }
  }

  async putStream(
    key: string,
    body: Readable,
    contentType: string,
  ): Promise<void> {
    try {
      const upload = new Upload({
        client: this.client,
        params: {
          Bucket: this.config.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        },
        queueSize: 2,
        partSize: 8 * 1024 * 1024,
        leavePartsOnError: false,
      });
      await upload.done();
    } catch {
      throw new StorageUnavailableException();
    }
  }

  async signGetObject(
    key: string,
    responseContentDisposition?: string,
  ): Promise<{ url: string; expiresAt: Date }> {
    try {
      const url = await getSignedUrl(
        this.publicClient,
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          ResponseContentDisposition: responseContentDisposition,
        }),
        { expiresIn: this.config.signedUrlExpiresIn },
      );
      return {
        url,
        expiresAt: new Date(Date.now() + this.config.signedUrlExpiresIn * 1000),
      };
    } catch {
      throw new StorageUnavailableException();
    }
  }

  private createClient(endpoint: string): S3Client {
    return new S3Client({
      endpoint,
      region: this.config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: this.config.accessKey,
        secretAccessKey: this.config.secretKey,
      },
    });
  }
}
