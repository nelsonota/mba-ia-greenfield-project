export interface ProcessVideoJobData {
  videoId: string;
  sourceObjectKey: string;
}

export interface ExtractedVideoMetadata {
  container: string | null;
  videoCodec: string;
  width: number | null;
  height: number | null;
  frameRate: string | null;
  audioCodec: string | null;
  bitRate: string | null;
}

export interface ProcessedVideoMedia {
  durationSeconds: string;
  metadata: ExtractedVideoMetadata;
}
