import { beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { env } from "@/lib/env";
import { server } from "@/mocks/server";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
const { getSession } = await import("@/lib/auth/session");
const { POST: startUpload } = await import("@/app/api/videos/uploads/route");
const { POST: requestParts } = await import("@/app/api/videos/[videoId]/upload-parts/route");
const { POST: completeUpload } = await import("@/app/api/videos/[videoId]/complete/route");
const { DELETE: abortUpload } = await import("@/app/api/videos/[videoId]/upload/route");

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/videos/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("video upload BFF routes", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockResolvedValue({
      isLoggedIn: true,
      accessToken: "owner-access-token",
    } as Awaited<ReturnType<typeof getSession>>);
  });

  it("creates the draft through the authenticated backend before any part bytes are sent", async () => {
    let authorization: string | null = null;
    let payload: unknown;
    server.use(
      http.post(`${env.API_URL}/videos/uploads`, async ({ request }) => {
        authorization = request.headers.get("authorization");
        payload = await request.json();
        return HttpResponse.json(
          { videoId: "video-123", status: "draft", partSizeBytes: 64, partCount: 1 },
          { status: 201 },
        );
      }),
    );

    const response = await startUpload(
      jsonRequest({ originalFilename: "sample.mp4", contentType: "video/mp4", sizeBytes: 12 }),
    );

    expect(response.status).toBe(201);
    expect(authorization).toBe("Bearer owner-access-token");
    expect(payload).toEqual({ originalFilename: "sample.mp4", contentType: "video/mp4", sizeBytes: 12 });
    expect(await response.json()).toMatchObject({ videoId: "video-123", status: "draft" });
  });

  it("forwards signed part requests and completion payloads with encoded video IDs", async () => {
    const paths: string[] = [];
    server.use(
      http.post(`${env.API_URL}/videos/:videoId/upload-parts`, async ({ request, params }) => {
        paths.push(`${params.videoId}:parts:${JSON.stringify(await request.json())}`);
        return HttpResponse.json({ parts: [{ partNumber: 1, url: "https://storage.example/1", expiresAt: "soon" }] });
      }),
      http.post(`${env.API_URL}/videos/:videoId/complete`, async ({ request, params }) => {
        paths.push(`${params.videoId}:complete:${JSON.stringify(await request.json())}`);
        return HttpResponse.json({ videoId: "video/123", status: "processing" }, { status: 202 });
      }),
    );
    const context = { params: Promise.resolve({ videoId: "video/123" }) };

    const partResponse = await requestParts(jsonRequest({ partNumbers: [1] }), context);
    const completionResponse = await completeUpload(
      jsonRequest({ parts: [{ partNumber: 1, eTag: '"etag"' }] }),
      context,
    );

    expect(partResponse.status).toBe(200);
    expect(await partResponse.json()).toMatchObject({ parts: [{ partNumber: 1 }] });
    expect(completionResponse.status).toBe(202);
    expect(paths).toContain('video/123:parts:{"partNumbers":[1]}');
    expect(paths).toContain('video/123:complete:{"parts":[{"partNumber":1,"eTag":"\\"etag\\""}]}');
  });

  it("aborts through the backend without forwarding any file bytes", async () => {
    let method = "";
    server.use(
      http.delete(`${env.API_URL}/videos/:videoId/upload`, ({ request }) => {
        method = request.method;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const response = await abortUpload(new Request("http://localhost/api/videos/video-123/upload"), {
      params: Promise.resolve({ videoId: "video-123" }),
    });

    expect(method).toBe("DELETE");
    expect(response.status).toBe(204);
  });

  it("requires an authenticated session and passes backend errors through", async () => {
    vi.mocked(getSession).mockResolvedValue({ isLoggedIn: false } as Awaited<ReturnType<typeof getSession>>);
    const unauthenticated = await startUpload(jsonRequest({}));
    expect(unauthenticated.status).toBe(401);

    vi.mocked(getSession).mockResolvedValue({
      isLoggedIn: true,
      accessToken: "owner-access-token",
    } as Awaited<ReturnType<typeof getSession>>);
    server.use(
      http.post(`${env.API_URL}/videos/uploads`, () =>
        HttpResponse.json({ statusCode: 403, error: "VIDEO_ACCESS_DENIED" }, { status: 403 }),
      ),
    );
    const denied = await startUpload(jsonRequest({}));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: "VIDEO_ACCESS_DENIED" });
  });
});
