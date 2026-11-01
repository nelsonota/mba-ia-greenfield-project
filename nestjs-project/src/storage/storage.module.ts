import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { STORAGE_ADAPTER } from './storage.constants';
import { S3StorageAdapter } from './s3-storage.adapter';

@Module({
  imports: [ConfigModule],
  providers: [
    S3StorageAdapter,
    { provide: STORAGE_ADAPTER, useExisting: S3StorageAdapter },
  ],
  exports: [STORAGE_ADAPTER, S3StorageAdapter],
})
export class StorageModule {}
