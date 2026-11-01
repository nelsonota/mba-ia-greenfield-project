import type { Readable } from 'node:stream';

export interface CompletedUploadPart {
  partNumber: number;
  eTag: string;
}

export interface StorageObjectMetadata {
  contentLength: number;
  contentType: string | null;
}

export interface StorageAdapter {
  createMultipartUpload(key: string, contentType: string): Promise<string>;
  createPresignedUploadPartUrl(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresInSeconds?: number,
  ): Promise<string>;
  completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: CompletedUploadPart[],
  ): Promise<void>;
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;
  putObject(
    key: string,
    body: Uint8Array | Readable,
    contentType: string,
  ): Promise<void>;
  getObjectStream(key: string, range?: string): Promise<Readable>;
  getObjectMetadata(key: string): Promise<StorageObjectMetadata>;
  deleteObject(key: string): Promise<void>;
}
