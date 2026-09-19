import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AdminAttempt, AdminAttemptPage } from "@/types/app";

type AdminAttemptRow = Omit<AdminAttempt, "profiles" | "recorder" | "categories" | "clans"> & {
  player_username: string;
  player_avatar_path: string | null;
  recorder_username: string | null;
  category_name: string;
  category_icon_key: string;
  category_accent_color: string;
  clan_name: string | null;
  total_count: number | string;
};

export async function getAdminAttemptPage({
  query,
  status,
  cursor,
  limit = 50,
}: {
  query: string;
  status: string | null;
  cursor: AdminAttemptPage["nextCursor"];
  limit?: number;
}): Promise<AdminAttemptPage> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_admin_attempts", {
    search_query: query,
    status_filter: status,
    before_stopped_at: cursor?.stoppedAt ?? null,
    before_attempt_id: cursor?.id ?? null,
    page_size: limit + 1,
  });
  if (error) throw error;

  const rows = (data ?? []) as AdminAttemptRow[];
  const pageRows = rows.slice(0, limit);
  const attempts = pageRows.map((row): AdminAttempt => ({
    id: row.id,
    user_id: row.user_id,
    recorded_by: row.recorded_by,
    category_id: row.category_id,
    clan_id: row.clan_id,
    elapsed_ms: Number(row.elapsed_ms),
    stopped_at: row.stopped_at,
    confirmed_at: row.confirmed_at,
    submitted_for_review_at: row.submitted_for_review_at,
    reviewed_at: row.reviewed_at,
    status: row.status,
    invalidated_reason: row.invalidated_reason,
    profiles: {
      id: row.user_id,
      username: row.player_username,
      avatar_path: row.player_avatar_path,
    },
    recorder: row.recorded_by && row.recorder_username ? {
      id: row.recorded_by,
      username: row.recorder_username,
    } : null,
    categories: {
      id: row.category_id,
      name: row.category_name,
      icon_key: row.category_icon_key,
      accent_color: row.category_accent_color,
    },
    clans: row.clan_id && row.clan_name ? { id: row.clan_id, name: row.clan_name } : null,
  }));
  const total = Number(rows[0]?.total_count ?? 0);
  const last = attempts.at(-1);

  return {
    attempts,
    total,
    hasMore: rows.length > limit,
    nextCursor: last ? { stoppedAt: last.stopped_at, id: last.id } : null,
  };
}
