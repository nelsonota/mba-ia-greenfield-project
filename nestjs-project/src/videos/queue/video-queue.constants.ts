import type { DefaultJobOptions } from 'bullmq';

export const VIDEO_PROCESSING_QUEUE = 'video-processing';
export const PROCESS_VIDEO_JOB = 'process-video';

export const VIDEO_QUEUE_DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: 1000,
  removeOnFail: 1000,
} satisfies DefaultJobOptions;

export interface ProcessVideoJob {
  videoId: string;
  objectKey: string;
}
