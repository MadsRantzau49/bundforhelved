import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Battle, BattleHub, BattleStanding } from "@/types/app";

export async function loadBattleHub(userId: string): Promise<BattleHub> {
  const supabase = await createSupabaseServerClient();
  const [battlesResult, standingResult, timerResult] = await Promise.all([
    supabase
      .from("battles")
      .select("id, challenger_id, opponent_id, category_id, clan_id, status, starts_at, provisional_winner_id, winner_id, settled_at, completed_at, created_at, challenger:profiles!battles_challenger_id_fkey(id, username, avatar_path), opponent:profiles!battles_opponent_id_fkey(id, username, avatar_path), category:categories!battles_category_id_fkey(id, name, icon_key, accent_color, image_path), clan:clans!battles_clan_id_fkey(id, name, image_path), participants:battle_participants(user_id, accepted_at, finished_at, elapsed_ms, attempt_id, elo_before, elo_after, elo_change, rank_before_name, rank_before_image_path, rank_after_name, rank_after_image_path, attempt:attempts!battle_participants_attempt_id_fkey(id, status))")
      .or(`challenger_id.eq.${userId},opponent_id.eq.${userId}`)
      .order("created_at", { ascending: false })
      .limit(30),
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
    history: battles.filter((battle) => battle.settled_at != null || ["declined", "cancelled"].includes(battle.status)),
    standing: (standingResult.data as BattleStanding | null) ?? null,
    has_active_timer: Boolean(timerResult.data),
  };
}
