interface ResponseBody {
  body: unknown;
}

export function accessToken(response: ResponseBody): string {
  return (response.body as { access_token: string }).access_token;
}

export function videoId(response: ResponseBody): string {
  return (response.body as { videoId: string }).videoId;
}

export function errorCode(response: ResponseBody): string | undefined {
  return (response.body as { error?: string }).error;
}

export function signedParts(response: ResponseBody):
  | Array<{
      partNumber: number;
      url: string;
      expiresAt: string;
    }>
  | undefined {
  return (
    response.body as {
      parts?: Array<{ partNumber: number; url: string; expiresAt: string }>;
    }
  ).parts;
}
