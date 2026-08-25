import { getSupabaseServerEnv } from "@/lib/env";

const userIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const filenamePattern = /^avatar-\d+(?:\.[a-z0-9]{1,16})?$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string; filename: string }> },
) {
  const { userId, filename } = await params;
  if (!userIdPattern.test(userId) || !filenamePattern.test(filename)) {
    return new Response(null, { status: 404 });
  }

  const { url, anonKey } = getSupabaseServerEnv();
  const storageUrl = `${url}/storage/v1/object/public/avatars/${encodeURIComponent(userId)}/${encodeURIComponent(filename)}`;
  const response = await fetch(storageUrl, { headers: { apikey: anonKey } });
  if (!response.ok || !response.body) return new Response(null, { status: response.status === 404 ? 404 : 502 });

  return new Response(response.body, {
    headers: {
      "Content-Type": response.headers.get("content-type") || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
