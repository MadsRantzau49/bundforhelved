import { getSupabaseServerEnv } from "@/lib/env";

const pathPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(?:image|guide|demo)-\d{10,17}\.(?:jpe?g|png|webp|gif|mp4|webm|mov|qt)$/i;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const segments = (await params).path;
  const path = segments.join("/");
  if (segments.length !== 2 || !pathPattern.test(path)) return new Response(null, { status: 404 });

  const { url, anonKey } = getSupabaseServerEnv();
  const objectUrl = `${url}/storage/v1/object/public/category-media/${segments.map(encodeURIComponent).join("/")}`;
  const range = request.headers.get("range");
  const response = await fetch(objectUrl, { headers: { apikey: anonKey, ...(range ? { Range: range } : {}) } });
  if (!response.ok || !response.body) {
    return new Response(null, { status: response.status === 404 ? 404 : 502 });
  }

  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Security-Policy": "default-src 'none'; media-src 'self'; sandbox",
      "X-Content-Type-Options": "nosniff",
      ...(response.headers.get("content-range") ? { "Content-Range": response.headers.get("content-range")! } : {}),
      ...(response.headers.get("accept-ranges") ? { "Accept-Ranges": response.headers.get("accept-ranges")! } : {}),
      ...(response.headers.get("content-length") ? { "Content-Length": response.headers.get("content-length")! } : {}),
    },
  });
}
