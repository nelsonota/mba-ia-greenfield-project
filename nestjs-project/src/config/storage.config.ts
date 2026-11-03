import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  endpoint: process.env.S3_ENDPOINT ?? 'http://minio:9000',
  publicEndpoint: process.env.S3_PUBLIC_ENDPOINT ?? 'http://localhost:9002',
  region: process.env.S3_REGION ?? 'us-east-1',
  bucket: process.env.S3_BUCKET ?? 'streamtube-videos',
  accessKey: process.env.S3_ACCESS_KEY ?? 'streamtube',
  secretKey: process.env.S3_SECRET_KEY ?? 'streamtube-secret',
  signedUrlExpiresIn: parseInt(
    process.env.S3_SIGNED_URL_EXPIRES_IN ?? '900',
    10,
  ),
}));
