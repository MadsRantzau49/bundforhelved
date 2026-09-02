import type { Metadata } from "next";
import { TimerStage } from "@/components/timer-stage";
import { requireProfile } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Attempt, Category, TimerPlayer } from "@/types/app";

export const metadata: Metadata = { title: "Timer" };

export default async function TimerPage({
  searchParams,
}: {
  searchParams: Promise<{ klan?: string }>;
}) {
  const params = await searchParams;
  const profile = await requireProfile();
  const supabase = await createSupabaseServerClient();
  const [categoriesResult, attemptResult, playersResult, latestAttemptResult] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name, icon_key, accent_color, description, image_path, guide_text, guide_video_path, demo_video_path, sort_order, is_active")
      .eq("is_active", true)
      .order("sort_order")
      .order("name"),
    supabase
      .from("attempts")
      .select("id, user_id, recorded_by, category_id, clan_id, started_at, stopped_at, elapsed_ms, status, confirmed_at, submitted_for_review_at, evidence_video_path")
      .eq("recorded_by", profile.id)
      .in("status", ["running", "awaiting_confirmation"])
      .limit(1)
      .maybeSingle(),
    supabase.rpc("get_timer_players"),
    supabase
      .from("attempts")
      .select("user_id, category_id, clan_id")
      .eq("recorded_by", profile.id)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (categoriesResult.error || attemptResult.error || playersResult.error || latestAttemptResult.error) {
    throw new Error("Timerdata kunne ikke hentes.");
  }

  const categories = (categoriesResult.data ?? []) as Category[];
  const activeAttempt = (attemptResult.data as Attempt | null) ?? null;
  let players = (playersResult.data ?? []) as TimerPlayer[];
  const clanIds = [...new Set(players.flatMap((player) => player.clans.map((clan) => clan.id)))];
  if (clanIds.length) {
    const { data, error } = await supabase.from("clans").select("id, image_path").in("id", clanIds);
    if (error) throw new Error("Klanbillederne kunne ikke hentes.");
    const clanImages = new Map((data ?? []).map((clan) => [clan.id, clan.image_path]));
    players = players.map((player) => ({
      ...player,
      clans: player.clans.map((clan) => ({ ...clan, image_path: clanImages.get(clan.id) ?? null })),
    }));
  }
  const host = players.find((player) => player.is_host);
  const latestAttempt = latestAttemptResult.data;
  const configuredPlayer = players.find((player) => player.player_id === latestAttempt?.user_id) ?? host;
  const initialPlayerId = activeAttempt?.user_id ?? configuredPlayer?.player_id ?? "";
  const initialCategoryId = activeAttempt?.category_id
    ?? (categories.some((category) => category.id === latestAttempt?.category_id) ? latestAttempt?.category_id : categories[0]?.id)
    ?? "";
  const initialPlayer = players.find((player) => player.player_id === initialPlayerId);
  const requestedClanId = params.klan && initialPlayer?.clans.some((clan) => clan.id === params.klan) ? params.klan : null;
  const previousClanId = latestAttempt?.clan_id && initialPlayer?.clans.some((clan) => clan.id === latestAttempt.clan_id)
    ? latestAttempt.clan_id
    : null;
  const initialClanId = activeAttempt?.clan_id ?? requestedClanId ?? previousClanId;
  let initialElapsedMs = activeAttempt?.elapsed_ms ?? 0;
  if (activeAttempt?.status === "running") {
    const elapsedResult = await supabase.rpc("get_attempt_live_elapsed", { attempt: activeAttempt.id });
    if (elapsedResult.error) throw new Error("Timerens servertid kunne ikke hentes.");
    initialElapsedMs = Number(elapsedResult.data ?? 0);
  }
  let attemptCategory: Category | null = null;
  if (activeAttempt && !categories.some((category) => category.id === activeAttempt.category_id)) {
    const { data, error } = await supabase
      .from("categories")
      .select("id, name, icon_key, accent_color, description, image_path, guide_text, guide_video_path, demo_video_path, sort_order, is_active")
      .eq("id", activeAttempt.category_id)
      .maybeSingle();
    if (error) throw new Error("Forsøgets kategori kunne ikke hentes.");
    attemptCategory = data as Category | null;
  }

  return (
    <div className="page page--timer">
      <TimerStage
        key={[
          activeAttempt?.id ?? "idle",
          activeAttempt?.status ?? "none",
          activeAttempt?.user_id ?? "host",
          initialClanId ?? "global",
          players.map((player) => player.player_id).join(","),
        ].join(":")}
        categories={categories}
        initialAttempt={activeAttempt}
        attemptCategory={attemptCategory}
        initialElapsedMs={initialElapsedMs}
        initialPlayers={players}
        initialClanId={initialClanId}
        initialPlayerId={initialPlayerId}
        initialCategoryId={initialCategoryId}
      />
    </div>
  );
}
