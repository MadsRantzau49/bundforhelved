import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Battle, BattleHistoryPage, BattleHub, BattleStanding } from "@/types/app";

const battleSelect = "id, challenger_id, opponent_id, category_id, clan_id, battle_mode, handicap_user_id, handicap_ms, suggested_handicap_ms, max_handicap_ms, challenger_best_ms, opponent_best_ms, handicap_expected_challenger, repeat_opponent_count, elo_stake_multiplier, battle_elo_factor, status, starts_at, provisional_winner_id, winner_id, settled_at, completed_at, created_at, challenger:profiles!battles_challenger_id_fkey(id, username, avatar_path), opponent:profiles!battles_opponent_id_fkey(id, username, avatar_path), category:categories!battles_category_id_fkey(id, name, icon_key, accent_color, image_path, battle_elo_factor), clan:clans!battles_clan_id_fkey(id, name, image_path), participants:battle_participants(user_id, accepted_at, finished_at, elapsed_ms, attempt_id, elo_before, elo_after, elo_change, rank_before_name, rank_before_image_path, rank_after_name, rank_after_image_path, attempt:attempts!battle_participants_attempt_id_fkey(id, status))";

async function queryBattleHistory(userId: string, before?: string): Promise<BattleHistoryPage> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("battles")
    .select(battleSelect)
    .or(`challenger_id.eq.${userId},opponent_id.eq.${userId}`)
    .eq("status", "completed")
    .not("settled_at", "is", null)
    .order("created_at", { ascending: false })
    .limit(6);
  if (before) query = query.lt("created_at", before);
  const { data, error } = await query;
  if (error) throw error;
  return { battles: (data ?? []).slice(0, 5) as unknown as Battle[], has_more: (data?.length ?? 0) > 5 };
}

export async function loadBattleHistoryPage(userId: string, before?: string): Promise<BattleHistoryPage> {
  return queryBattleHistory(userId, before);
}

export async function loadBattleHub(userId: string): Promise<BattleHub> {
  const supabase = await createSupabaseServerClient();
  const [battlesResult, historyPage, standingResult, timerResult] = await Promise.all([
    supabase
      .from("battles")
      .select(battleSelect)
      .or(`challenger_id.eq.${userId},opponent_id.eq.${userId}`)
      .in("status", ["pending", "ready", "countdown", "active", "completed"])
      .is("settled_at", null)
      .order("created_at", { ascending: false })
      .limit(30),
    queryBattleHistory(userId),
    supabase.rpc("get_battle_standing", { target: userId }).maybeSingle(),
    supabase.from("attempts").select("id").eq("user_id", userId).in("status", ["running", "awaiting_confirmation"]).limit(1).maybeSingle(),
  ]);
  if (battlesResult.error || standingResult.error || timerResult.error) {
    throw battlesResult.error ?? standingResult.error ?? timerResult.error;
  }

  const battles = (battlesResult.data ?? []) as unknown as Battle[];
  const current = battles.find((battle) => {
    if (battle.status === "pending") return battle.challenger_id === userId;
    if (["ready", "countdown"].includes(battle.status)) return true;
    if (!["active", "completed"].includes(battle.status)) return false;
    return battle.participants.find((item) => item.user_id === userId)?.finished_at == null;
  }) ?? null;
  return {
    current,
    invitations: battles.filter((battle) => battle.status === "pending" && battle.opponent_id === userId),
    review_matches: battles.filter((battle) => {
      const mine = battle.participants.find((item) => item.user_id === userId);
      return Boolean(mine?.finished_at && battle.participants.some((item) => item.attempt?.status === "pending_review"));
    }),
    history: historyPage.battles,
    history_has_more: historyPage.has_more,
    standing: (standingResult.data as BattleStanding | null) ?? null,
    has_active_timer: Boolean(timerResult.data),
  };
}
