export interface StartVideoUploadRequest {
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
}

export interface StartVideoUploadResponse {
  videoId: string;
  status: "draft";
  partSizeBytes: number;
  partCount: number;
}

export interface SignedUploadPart {
  partNumber: number;
  url: string;
  expiresAt: string;
}

export interface RequestUploadPartsResponse {
  parts: SignedUploadPart[];
}

export interface CompleteVideoUploadRequest {
  parts: Array<{ partNumber: number; eTag: string }>;
}

export interface CompleteVideoUploadResponse {
  videoId: string;
  status: "processing";
}
