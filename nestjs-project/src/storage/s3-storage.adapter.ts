import {
  AbortMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Readable } from 'node:stream';
import storageConfig from '../config/storage.config';
import type {
  CompletedUploadPart,
  StorageAdapter,
  StorageObjectMetadata,
} from './storage.types';

const BUCKET_READY_ATTEMPTS = 8;
const BUCKET_RETRY_DELAY_MS = 500;
const DEFAULT_PART_URL_TTL_SECONDS = 900;

@Injectable()
export class S3StorageAdapter implements StorageAdapter, OnModuleInit {
  private readonly logger = new Logger(S3StorageAdapter.name);
  private readonly client: S3Client;

  constructor(
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {
    this.client = new S3Client({
      endpoint: this.config.endpoint,
      region: this.config.region,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
      forcePathStyle: this.config.forcePathStyle,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      maxAttempts: 3,
    });
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.createBucketIfMissing) {
      return;
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= BUCKET_READY_ATTEMPTS; attempt += 1) {
      try {
        await this.client.send(
          new HeadBucketCommand({ Bucket: this.config.bucket }),
        );
        return;
      } catch (error) {
        if (!this.isBucketNotFound(error)) {
          lastError = error;
          if (attempt === BUCKET_READY_ATTEMPTS) {
            break;
          }
          await this.waitForBucketService();
          continue;
        }

        try {
          await this.client.send(
            new CreateBucketCommand({ Bucket: this.config.bucket }),
          );
          this.logger.log(`Created storage bucket "${this.config.bucket}"`);
          return;
        } catch (createError) {
          if (this.isBucketAlreadyOwned(createError)) {
            return;
          }
          lastError = createError;
          if (attempt === BUCKET_READY_ATTEMPTS) {
            break;
          }
          await this.waitForBucketService();
        }
      }
    }

    throw new Error(`Unable to initialize S3 bucket "${this.config.bucket}"`, {
      cause: lastError,
    });
  }

  async createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<string> {
    const response = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );

    if (!response.UploadId) {
      throw new Error('Storage provider returned no multipart upload ID');
    }

    return response.UploadId;
  }

  async createPresignedUploadPartUrl(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresInSeconds = DEFAULT_PART_URL_TTL_SECONDS,
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new UploadPartCommand({
        Bucket: this.config.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: CompletedUploadPart[],
  ): Promise<void> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: [...parts]
            .sort((left, right) => left.partNumber - right.partNumber)
            .map(({ partNumber, eTag }) => ({
              PartNumber: partNumber,
              ETag: eTag,
            })),
        },
      }),
    );
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  async putObject(
    key: string,
    body: Uint8Array | Readable,
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async getObjectStream(key: string, range?: string): Promise<Readable> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Range: range,
      }),
    );

    if (!response.Body) {
      throw new Error(`Storage provider returned no body for object "${key}"`);
    }

    return response.Body as Readable;
  }

  async getObjectMetadata(key: string): Promise<StorageObjectMetadata> {
    const response = await this.client.send(
      new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    if (response.ContentLength === undefined) {
      throw new Error(`Storage provider returned no size for object "${key}"`);
    }
    return {
      contentLength: response.ContentLength,
      contentType: response.ContentType ?? null,
    };
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
  }

  private isBucketNotFound(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const candidate = error as Error & {
      $metadata?: { httpStatusCode?: number };
    };
    return (
      candidate.name === 'NotFound' ||
      candidate.name === 'NoSuchBucket' ||
      candidate.$metadata?.httpStatusCode === 404
    );
  }

  private isBucketAlreadyOwned(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.name === 'BucketAlreadyOwnedByYou' ||
        error.name === 'BucketAlreadyExists')
    );
  }

  private async waitForBucketService(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, BUCKET_RETRY_DELAY_MS));
  }
}
