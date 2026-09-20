import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ProfileOverview } from "@/components/profile-overview";
import { requireProfile } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation";
import type { AchievementAsset, BattleStanding, FriendProfileData } from "@/types/app";

export const metadata: Metadata = { title: "Spillerstatistik" };

export default async function PlayerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const currentProfile = await requireProfile();
  const playerId = uuidSchema.safeParse((await params).id);
  if (!playerId.success) notFound();
  if (playerId.data === currentProfile.id) redirect("/profil");

  const supabase = await createSupabaseServerClient();
  const [playerResult, categoriesResult, assetsResult, standingResult] = await Promise.all([
    supabase.rpc("get_player_profile", { player: playerId.data }),
    supabase.from("categories").select("id").eq("is_active", true),
    supabase.from("achievement_assets").select("achievement_key, image_path"),
    supabase.rpc("get_battle_standing", { target: playerId.data }).maybeSingle(),
  ]);
  if (playerResult.error || !playerResult.data || categoriesResult.error || assetsResult.error || standingResult.error) notFound();
  const player = playerResult.data as FriendProfileData;

  return (
    <div className="page page--profile">
      <Link href="/rangliste" className="back-link"><ArrowLeft aria-hidden="true" /> Tilbage til resultater</Link>
      <ProfileOverview
        profile={player.profile}
        attempts={player.attempts}
        achievementAssets={(assetsResult.data ?? []) as AchievementAsset[]}
        activeCategoryIds={(categoriesResult.data ?? []).map((category) => category.id)}
        battleStanding={(standingResult.data as BattleStanding | null) ?? null}
      />
    </div>
  );
}
