import { describe, expect, it, vi } from "vitest";
import { uploadVideoMultipart } from "./multipart-upload";

function createFetchHarness(options: { failPartOnce?: number; failPartAlways?: number } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const partAttempts = new Map<number, number>();
  const fetcher: typeof fetch = vi.fn(async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "/api/videos/uploads") {
      return Response.json({ videoId: "video-1", status: "draft", partSizeBytes: 3, partCount: 3 });
    }
    if (url.endsWith("/upload-parts")) {
      return Response.json({
        parts: [1, 2, 3].map((partNumber) => ({
          partNumber,
          url: `https://storage.example/part/${partNumber}`,
          expiresAt: "2026-11-03T12:00:00.000Z",
        })),
      });
    }
    if (url.startsWith("https://storage.example/part/")) {
      const partNumber = Number(url.split("/").at(-1));
      const attempts = (partAttempts.get(partNumber) ?? 0) + 1;
      partAttempts.set(partNumber, attempts);
      if (partNumber === options.failPartAlways || (partNumber === options.failPartOnce && attempts === 1)) {
        return new Response(null, { status: 503 });
      }
      return new Response(null, { status: 200, headers: { etag: `"etag-${partNumber}"` } });
    }
    if (url.endsWith("/complete")) {
      return Response.json({ videoId: "video-1", status: "processing" }, { status: 202 });
    }
    if (url.endsWith("/upload")) return new Response(null, { status: 204 });
    throw new Error(`Unexpected request: ${url}`);
  });

  return { calls, partAttempts, fetcher };
}

describe("uploadVideoMultipart", () => {
  it("creates the draft first, uploads slices directly with bounded workers, reports progress, and completes in part order", async () => {
    const { calls, fetcher } = createFetchHarness();
    const progress: number[] = [];
    const file = new File(["abcdefgh"], "sample.mp4", { type: "video/mp4" });

    await expect(
      uploadVideoMultipart(file, {
        concurrency: 2,
        fetcher,
        onProgress: ({ bytesUploaded }) => progress.push(bytesUploaded),
      }),
    ).resolves.toEqual({ videoId: "video-1", status: "processing" });

    expect(calls[0].url).toBe("/api/videos/uploads");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      originalFilename: "sample.mp4",
      contentType: "video/mp4",
      sizeBytes: 8,
    });
    expect(calls.filter(({ url }) => url.startsWith("https://storage.example/part/"))).toHaveLength(3);
    expect(calls.filter(({ url }) => url.startsWith("https://storage.example/part/"))).toHaveLength(3);
    expect(progress.sort((a, b) => a - b)).toEqual([3, 6, 8]);
    const completion = calls.find(({ url }) => url.endsWith("/complete"));
    expect(JSON.parse(String(completion?.init?.body))).toEqual({
      parts: [
        { partNumber: 1, eTag: '"etag-1"' },
        { partNumber: 2, eTag: '"etag-2"' },
        { partNumber: 3, eTag: '"etag-3"' },
      ],
    });
    expect(calls.findIndex(({ url }) => url === "/api/videos/uploads")).toBeLessThan(
      calls.findIndex(({ url }) => url.startsWith("https://storage.example/part/")),
    );
  });

  it("retries only the failed part and preserves successful part uploads", async () => {
    const { calls, partAttempts, fetcher } = createFetchHarness({ failPartOnce: 2 });

    await uploadVideoMultipart(new File(["abcdefgh"], "sample.mp4", { type: "video/mp4" }), { fetcher });

    expect(partAttempts.get(1)).toBe(1);
    expect(partAttempts.get(2)).toBe(2);
    expect(partAttempts.get(3)).toBe(1);
    expect(calls.filter(({ url }) => url.endsWith("/complete"))).toHaveLength(1);
  });

  it("does not exceed the configured number of parallel storage requests", async () => {
    let active = 0;
    let maximumActive = 0;
    const { fetcher: baseFetcher } = createFetchHarness();
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      if (String(input).startsWith("https://storage.example/part/")) {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        const response = await baseFetcher(input, init);
        active -= 1;
        return response;
      }
      return baseFetcher(input, init);
    });

    await uploadVideoMultipart(new File(["abcdefgh"], "sample.mp4"), {
      concurrency: 2,
      fetcher,
    });

    expect(maximumActive).toBe(2);
  });

  it("aborts the draft after a part exhausts retries and does not complete", async () => {
    const { calls, fetcher } = createFetchHarness({ failPartAlways: 2 });

    await expect(
      uploadVideoMultipart(new File(["abcdefgh"], "sample.mp4", { type: "video/mp4" }), {
        fetcher,
        retries: 1,
      }),
    ).rejects.toThrow("Part upload failed (503)");

    expect(calls.filter(({ url }) => url.endsWith("/upload"))).toHaveLength(1);
    expect(calls.filter(({ url }) => url.endsWith("/complete"))).toHaveLength(0);
  });

  it("does not start the draft when already cancelled", async () => {
    const { calls, fetcher } = createFetchHarness();
    const controller = new AbortController();
    controller.abort();

    await expect(
      uploadVideoMultipart(new File(["x"], "sample.mp4"), { fetcher, signal: controller.signal }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
