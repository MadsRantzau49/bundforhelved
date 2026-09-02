import { getSupabaseServerEnv } from "@/lib/env";

const pathPattern = /^[a-z0-9][a-z0-9-]{0,79}\/image-\d{10,17}\.(?:jpe?g|png|webp|gif)$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const segments = (await params).path;
  const path = segments.join("/");
  if (segments.length !== 2 || !pathPattern.test(path)) return new Response(null, { status: 404 });

  const { url, anonKey } = getSupabaseServerEnv();
  const objectUrl = `${url}/storage/v1/object/public/achievement-media/${segments.map(encodeURIComponent).join("/")}`;
  const response = await fetch(objectUrl, { headers: { apikey: anonKey } });
  if (!response.ok || !response.body) return new Response(null, { status: response.status === 404 ? 404 : 502 });

  return new Response(response.body, {
    headers: {
      "Content-Type": response.headers.get("content-type") || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
      "X-Content-Type-Options": "nosniff",
      ...(response.headers.get("content-length") ? { "Content-Length": response.headers.get("content-length")! } : {}),
    },
  });
}
