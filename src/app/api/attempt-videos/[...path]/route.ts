import { createSupabaseServerClient } from "@/lib/supabase/server";

const pathPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/evidence-\d{10,17}\.(?:mp4|webm|mov|qt)$/i;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const segments = (await params).path;
  const path = segments.join("/");
  if (segments.length !== 2 || !pathPattern.test(path)) return new Response(null, { status: 404 });

  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return new Response(null, { status: 401 });

  const { data: signed, error: signedError } = await supabase.storage
    .from("attempt-videos")
    .createSignedUrl(path, 60);
  if (signedError || !signed?.signedUrl) return new Response(null, { status: 403 });

  const range = request.headers.get("range");
  const response = await fetch(signed.signedUrl, {
    headers: range ? { Range: range } : undefined,
    cache: "no-store",
  });
  if (!response.ok || !response.body) {
    return new Response(null, { status: response.status === 404 ? 404 : 502 });
  }

  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") || "application/octet-stream",
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Security-Policy": "default-src 'none'; media-src 'self'; sandbox",
      "X-Content-Type-Options": "nosniff",
      ...(response.headers.get("content-range") ? { "Content-Range": response.headers.get("content-range")! } : {}),
      ...(response.headers.get("accept-ranges") ? { "Accept-Ranges": response.headers.get("accept-ranges")! } : {}),
      ...(response.headers.get("content-length") ? { "Content-Length": response.headers.get("content-length")! } : {}),
    },
  });
}
