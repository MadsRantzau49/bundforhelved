import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PeerReviewAttempt, PeerReviewPage } from "@/types/app";

type PeerReviewRow = PeerReviewAttempt & { total_count?: number | string };

function evidenceUrl(path: string | null) {
  if (!path) return null;
  return `/api/attempt-videos/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export async function getPeerReviewPage(
  cursor: PeerReviewPage["nextCursor"],
  limit = 20,
): Promise<PeerReviewPage> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_peer_review_attempts", {
    before_submitted_at: cursor?.submittedAt ?? null,
    before_attempt_id: cursor?.id ?? null,
    page_size: limit + 1,
  });
  if (error) throw error;

  const rows = (data ?? []) as PeerReviewRow[];
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    attempts: pageRows.map((row) => {
      const attempt = { ...row };
      delete attempt.total_count;
      return { ...attempt, evidence_video_url: evidenceUrl(attempt.evidence_video_path) };
    }),
    total: Number(rows[0]?.total_count ?? 0),
    hasMore: rows.length > limit,
    nextCursor: last ? { submittedAt: last.submitted_for_review_at, id: last.attempt_id } : null,
  };
}
