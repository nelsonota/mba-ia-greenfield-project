import "server-only";

import { env } from "@/lib/env";
import { getSession } from "@/lib/auth/session";

export async function proxyVideoUploadRequest(
  path: string,
  init: { method: "POST" | "DELETE"; body?: unknown },
): Promise<Response> {
  const session = await getSession();
  if (!session.isLoggedIn || !session.accessToken) {
    return Response.json(
      { statusCode: 401, error: "UNAUTHENTICATED", message: "Authentication required" },
      { status: 401 },
    );
  }

  const upstreamResponse = await fetch(`${env.API_URL}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    cache: "no-store",
  });

  const body = upstreamResponse.status === 204 ? null : await upstreamResponse.text();
  const headers = new Headers();
  const contentType = upstreamResponse.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("cache-control", "private, no-store");

  return new Response(body, { status: upstreamResponse.status, headers });
}
