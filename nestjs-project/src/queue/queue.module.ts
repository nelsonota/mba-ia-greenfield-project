import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import queueConfig from '../config/queue.config';
import {
  VIDEO_PROCESSING_DEFAULT_JOB_OPTIONS,
  VIDEO_PROCESSING_QUEUE,
} from './queue.constants';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [queueConfig.KEY],
      useFactory: (config: ConfigType<typeof queueConfig>) => ({
        connection: config.redis,
      }),
    }),
    BullModule.registerQueue({
      name: VIDEO_PROCESSING_QUEUE,
      defaultJobOptions: VIDEO_PROCESSING_DEFAULT_JOB_OPTIONS,
      forceDisconnectOnShutdown: true,
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
