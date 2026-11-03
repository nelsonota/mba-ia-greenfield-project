import { proxyVideoUploadRequest } from "@/lib/videos/upload-api";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ videoId: string }> },
) {
  const { videoId } = await params;
  return proxyVideoUploadRequest(`/videos/${encodeURIComponent(videoId)}/upload`, {
    method: "DELETE",
  });
}
