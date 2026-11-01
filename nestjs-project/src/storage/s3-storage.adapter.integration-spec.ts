import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import storageConfig from '../config/storage.config';
import { S3StorageAdapter } from './s3-storage.adapter';

const readStream = async (stream: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

describe('S3StorageAdapter (integration)', () => {
  const adapter = new S3StorageAdapter(storageConfig());

  beforeAll(async () => {
    await adapter.onModuleInit();
  });

  it('completes a multipart upload and streams full and ranged object reads', async () => {
    const key = `storage-integration/${randomUUID()}.txt`;
    const expectedBody = Buffer.from(
      'streamtube multipart storage integration',
    );
    const uploadId = await adapter.createMultipartUpload(key, 'text/plain');

    try {
      const uploadUrl = await adapter.createPresignedUploadPartUrl(
        key,
        uploadId,
        1,
      );
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: expectedBody,
      });

      if (!uploadResponse.ok) {
        throw new Error(await uploadResponse.clone().text());
      }
      expect(uploadResponse.status).toBe(200);
      const eTag = uploadResponse.headers.get('etag');
      expect(eTag).toBeTruthy();

      await adapter.completeMultipartUpload(key, uploadId, [
        { partNumber: 1, eTag: eTag! },
      ]);

      await expect(
        readStream(await adapter.getObjectStream(key)),
      ).resolves.toEqual(expectedBody);
      await expect(
        readStream(await adapter.getObjectStream(key, 'bytes=0-9')),
      ).resolves.toEqual(expectedBody.subarray(0, 10));
    } finally {
      await adapter.deleteObject(key);
    }
  });

  it('aborts an active multipart upload', async () => {
    const key = `storage-integration/${randomUUID()}.aborted`;
    const uploadId = await adapter.createMultipartUpload(
      key,
      'application/octet-stream',
    );

    await expect(
      adapter.abortMultipartUpload(key, uploadId),
    ).resolves.toBeUndefined();
  });
});
