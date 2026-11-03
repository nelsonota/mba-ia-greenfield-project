import { proxyVideoUploadRequest } from "@/lib/videos/upload-api";

export async function POST(request: Request) {
  const body = await request.json();
  return proxyVideoUploadRequest("/videos/uploads", { method: "POST", body });
}
