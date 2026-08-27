import type { Metadata } from "next";
import { TimerStage } from "@/components/timer-stage";
import { PageHeader } from "@/components/page-header";
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
  const [categoriesResult, attemptResult, playersResult] = await Promise.all([
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
  ]);

  if (categoriesResult.error || attemptResult.error || playersResult.error) {
    throw new Error("Timerdata kunne ikke hentes.");
  }

  const categories = (categoriesResult.data ?? []) as Category[];
  const activeAttempt = (attemptResult.data as Attempt | null) ?? null;
  const players = (playersResult.data ?? []) as TimerPlayer[];
  const host = players.find((player) => player.is_host);
  const initialClanId = !activeAttempt && host?.clans.some((clan) => clan.id === params.klan)
    ? params.klan ?? null
    : null;
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
      <PageHeader
        eyebrow={`Delt telefon: @${profile.username}`}
        title="Bund den. Sæt tiden."
        description="Vælg spiller, rangliste og kategori. Serveren holder øje med hundrededelene."
      />
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
      />
    </div>
  );
}
