export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store, max-age=0",
};

export function GET() {
  return Response.json({ ok: true }, { headers });
}

export function HEAD() {
  return new Response(null, { status: 204, headers });
}
