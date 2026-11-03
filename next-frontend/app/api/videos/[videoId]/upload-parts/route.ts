import { proxyVideoUploadRequest } from "@/lib/videos/upload-api";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ videoId: string }> },
) {
  const { videoId } = await params;
  const body = await request.json();
  return proxyVideoUploadRequest(`/videos/${encodeURIComponent(videoId)}/upload-parts`, {
    method: "POST",
    body,
  });
}
