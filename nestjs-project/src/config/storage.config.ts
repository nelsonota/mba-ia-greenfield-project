import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  endpoint: process.env.S3_ENDPOINT || 'http://rustfs:9000',
  region: process.env.S3_REGION || 'us-east-1',
  accessKeyId: process.env.S3_ACCESS_KEY_ID || 'streamtube',
  secretAccessKey:
    process.env.S3_SECRET_ACCESS_KEY || 'streamtube-local-secret',
  bucket: process.env.S3_BUCKET || 'streamtube-videos',
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  createBucketIfMissing: process.env.S3_CREATE_BUCKET_IF_MISSING !== 'false',
}));
