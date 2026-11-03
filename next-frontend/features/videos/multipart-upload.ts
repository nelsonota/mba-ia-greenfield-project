import type {
  CompleteVideoUploadResponse,
  RequestUploadPartsResponse,
  SignedUploadPart,
  StartVideoUploadResponse,
} from "./contracts";

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_RETRIES = 2;

export interface MultipartUploadProgress {
  bytesUploaded: number;
  totalBytes: number;
  partNumber: number;
  partCount: number;
}

export interface MultipartUploadOptions {
  signal?: AbortSignal;
  concurrency?: number;
  retries?: number;
  onProgress?: (progress: MultipartUploadProgress) => void;
  fetcher?: typeof fetch;
}

export class MultipartUploadError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MultipartUploadError";
  }
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Upload request failed (${response.status})`;
    try {
      const body = (await response.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      // Keep the status-based message for a non-JSON upstream error.
    }
    throw new MultipartUploadError(message, response.status);
  }
  return (await response.json()) as T;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

async function putPart(
  file: File,
  part: SignedUploadPart,
  partSizeBytes: number,
  retries: number,
  signal: AbortSignal | undefined,
  fetcher: typeof fetch,
): Promise<{ partNumber: number; eTag: string }> {
  const start = (part.partNumber - 1) * partSizeBytes;
  const end = Math.min(start + partSizeBytes, file.size);
  const body = file.slice(start, end);
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    signal?.throwIfAborted();
    try {
      const response = await fetcher(part.url, {
        method: "PUT",
        body,
        signal,
      });
      if (!response.ok) throw new MultipartUploadError(`Part upload failed (${response.status})`, response.status);
      const eTag = response.headers.get("etag");
      if (!eTag) throw new MultipartUploadError(`Part ${part.partNumber} response did not include ETag`);
      return { partNumber: part.partNumber, eTag };
    } catch (error) {
      lastError = error;
      if (signal?.aborted || attempt === retries) throw error;
    }
  }

  throw lastError;
}

export async function uploadVideoMultipart(
  file: File,
  options: MultipartUploadOptions = {},
): Promise<CompleteVideoUploadResponse> {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const retries = options.retries ?? DEFAULT_RETRIES;
  assertPositiveInteger(concurrency, "concurrency");
  if (!Number.isSafeInteger(retries) || retries < 0) throw new RangeError("retries must be non-negative");
  if (file.size < 1) throw new RangeError("file must not be empty");

  const fetcher = options.fetcher ?? fetch;
  options.signal?.throwIfAborted();
  let videoId: string | undefined;

  try {
    const started = await readJson<StartVideoUploadResponse>(
      await fetcher("/api/videos/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalFilename: file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        }),
        signal: options.signal,
      }),
    );
    videoId = started.videoId;
    if (
      !started.videoId ||
      started.status !== "draft" ||
      !Number.isSafeInteger(started.partSizeBytes) ||
      started.partSizeBytes < 1 ||
      started.partCount !== Math.ceil(file.size / started.partSizeBytes)
    ) {
      throw new MultipartUploadError("The server returned an invalid upload draft");
    }

    const partNumbers = Array.from({ length: started.partCount }, (_, index) => index + 1);
    const { parts } = await readJson<RequestUploadPartsResponse>(
      await fetcher(`/api/videos/${encodeURIComponent(videoId)}/upload-parts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partNumbers }),
        signal: options.signal,
      }),
    );
    const partByNumber = new Map(parts.map((part) => [part.partNumber, part]));
    if (parts.length !== started.partCount || partNumbers.some((number) => !partByNumber.has(number))) {
      throw new MultipartUploadError("The server did not sign every upload part");
    }

    const completedParts: Array<{ partNumber: number; eTag: string }> = [];
    let nextPartIndex = 0;
    let bytesUploaded = 0;
    let stopped = false;
    const worker = async () => {
      while (!stopped) {
        options.signal?.throwIfAborted();
        const partNumber = nextPartIndex + 1;
        if (partNumber > started.partCount) return;
        nextPartIndex += 1;
        const part = partByNumber.get(partNumber);
        if (!part) throw new MultipartUploadError(`Missing signed URL for part ${partNumber}`);
        try {
          const result = await putPart(
            file,
            part,
            started.partSizeBytes,
            retries,
            options.signal,
            fetcher,
          );
          completedParts.push(result);
          const size = Math.min(started.partSizeBytes, file.size - (partNumber - 1) * started.partSizeBytes);
          bytesUploaded += size;
          options.onProgress?.({ bytesUploaded, totalBytes: file.size, partNumber, partCount: started.partCount });
        } catch (error) {
          stopped = true;
          throw error;
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, started.partCount) }, () => worker()));
    completedParts.sort((left, right) => left.partNumber - right.partNumber);

    return await readJson<CompleteVideoUploadResponse>(
      await fetcher(`/api/videos/${encodeURIComponent(videoId)}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parts: completedParts }),
        signal: options.signal,
      }),
    );
  } catch (error) {
    if (videoId) {
      try {
        await fetcher(`/api/videos/${encodeURIComponent(videoId)}/upload`, { method: "DELETE" });
      } catch {
        // Preserve the upload failure; the server-side draft remains recoverable by owner operations.
      }
    }
    throw error;
  }
}
