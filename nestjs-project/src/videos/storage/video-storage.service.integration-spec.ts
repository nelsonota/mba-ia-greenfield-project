import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Readable } from 'node:stream';
import storageConfig from '../../config/storage.config';
import { StorageUnavailableException } from '../exceptions/storage-unavailable.exception';
import { VideoStorageService } from './video-storage.service';

describe('VideoStorageService (MinIO integration)', () => {
  let moduleRef: TestingModule;
  let storage: VideoStorageService;
  const previousPublicEndpoint = process.env.S3_PUBLIC_ENDPOINT;

  beforeAll(async () => {
    // Jest runs in the API container; this host alias reaches the same browser-published MinIO port.
    process.env.S3_PUBLIC_ENDPOINT = 'http://host.docker.internal:9002';
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ load: [storageConfig] })],
      providers: [VideoStorageService],
    }).compile();
    storage = moduleRef.get(VideoStorageService);
  });

  afterAll(async () => {
    await moduleRef.close();
    if (previousPublicEndpoint === undefined) {
      delete process.env.S3_PUBLIC_ENDPOINT;
    } else {
      process.env.S3_PUBLIC_ENDPOINT = previousPublicEndpoint;
    }
  });

  it('creates multipart uploads, signs browser URLs, completes them and supports Range reads', async () => {
    const key = `integration/${crypto.randomUUID()}.bin`;
    const uploadId = await storage.initiateMultipart(
      key,
      'application/octet-stream',
    );
    const { url, expiresAt } = await storage.signUploadPart(key, uploadId, 1);
    expect(new URL(url).hostname).toBe('host.docker.internal');
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const response = await fetch(url, {
      method: 'PUT',
      headers: { Origin: 'http://localhost:3001' },
      body: Buffer.from('video-bytes'),
    });
    expect(response.ok).toBe(true);
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'http://localhost:3001',
    );
    expect(response.headers.get('access-control-expose-headers')).toMatch(
      /etag/i,
    );
    const eTag = response.headers.get('etag');
    expect(eTag).toBeTruthy();

    await storage.completeMultipart(key, uploadId, [
      { partNumber: 1, eTag: eTag! },
    ]);
    const object = await storage.getObject(key, 'bytes=0-4');
    expect(object.contentRange).toMatch(/^bytes 0-4\//);
    expect(object.body).toBeInstanceOf(Readable);
    const chunks: Buffer[] = [];
    const byteStream = object.body as AsyncIterable<Uint8Array>;
    for await (const chunk of byteStream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('video');
    const signedRead = await storage.signGetObject(key);
    expect(signedRead.url).toContain('http://host.docker.internal:9002/');
    const browserRead = await fetch(signedRead.url, {
      headers: { Origin: 'http://localhost:3001' },
    });
    expect(browserRead.headers.get('access-control-allow-origin')).toBe(
      'http://localhost:3001',
    );
    expect(browserRead.headers.get('access-control-expose-headers')).toMatch(
      /etag/i,
    );
    await browserRead.arrayBuffer();
  });

  it('streams large objects through multipart storage and maps provider failures', async () => {
    const key = `integration/${crypto.randomUUID()}.stream`;
    const source = Readable.from([
      Buffer.alloc(5 * 1024 * 1024, 7),
      Buffer.alloc(4 * 1024 * 1024, 9),
    ]);
    await storage.putStream(key, source, 'application/octet-stream');
    const object = await storage.getObject(key, 'bytes=0-0');
    const chunks: Buffer[] = [];
    const byteStream = object.body as AsyncIterable<Uint8Array>;
    for await (const chunk of byteStream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([7]));

    await expect(
      storage.getObject(`missing/${crypto.randomUUID()}`),
    ).rejects.toBeInstanceOf(StorageUnavailableException);
  });

  it('aborts an open multipart upload', async () => {
    const key = `integration/${crypto.randomUUID()}.aborted`;
    const uploadId = await storage.initiateMultipart(
      key,
      'application/octet-stream',
    );
    await expect(
      storage.abortMultipart(key, uploadId),
    ).resolves.toBeUndefined();
  });
});
