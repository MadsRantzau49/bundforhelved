import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const pathPattern = /^[0-9a-f-]{36}\/image-\d{10,17}\.(?:jpe?g|png|webp|gif)$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join("/");
  if (!pathPattern.test(path)) return new NextResponse("Not found", { status: 404 });

  const { data, error } = await createSupabaseAdminClient().storage.from("rank-media").download(path);
  if (error || !data) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(data, {
    headers: {
      "Content-Type": data.type || "application/octet-stream",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
