import type { Metadata } from "next";
import { ShieldCheck, TimerReset, UsersRound } from "lucide-react";
import { AdminDashboard } from "@/components/admin-dashboard";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth/session";
import { getAdminAttemptPage } from "@/lib/admin-attempts";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AchievementAsset, AdminClan, BattleRank, Category, Profile } from "@/types/app";

export const metadata: Metadata = { title: "Administration" };

export default async function AdminPage() {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const [categoriesResult, usersResult, attemptsResult, clansResult, achievementAssetsResult, battleRanksResult, battleRatingsResult] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name, icon_key, accent_color, description, image_path, guide_text, guide_video_path, demo_video_path, sort_order, is_active")
      .order("sort_order"),
    supabase
      .from("profiles")
      .select("id, username, avatar_path, role, created_at")
      .order("created_at", { ascending: false }),
    getAdminAttemptPage({ query: "", status: null, cursor: null }),
    supabase
      .from("clans")
      .select("id, name, clan_members!clan_members_clan_id_fkey(user_id)")
      .order("name"),
    supabase.from("achievement_assets").select("achievement_key, image_path"),
    supabase.from("battle_ranks").select("id, name, image_path, min_elo, max_elo, sort_order").order("min_elo"),
    supabase.from("battle_ratings").select("user_id, elo, wins, losses, draws"),
  ]);

  if (categoriesResult.error || usersResult.error || clansResult.error || achievementAssetsResult.error || battleRanksResult.error || battleRatingsResult.error) {
    throw new Error("Administrationsdata kunne ikke hentes.");
  }

  const categories = (categoriesResult.data ?? []) as Category[];
  const users = (usersResult.data ?? []) as Profile[];
  const clans = (clansResult.data ?? []) as unknown as AdminClan[];
  const achievementAssets = (achievementAssetsResult.data ?? []) as AchievementAsset[];

  return (
    <div className="page page--admin">
      <PageHeader
        eyebrow="Kontrolrummet"
        title="Administration"
        description="Hold kategorierne åbne, tavlen ærlig og spillerlisten ren."
        action={<span className="header-admin"><ShieldCheck aria-hidden="true" /></span>}
      />
      <div className="admin-summary">
        <div><span><TimerReset aria-hidden="true" /></span><strong>{attemptsResult.total}</strong><small>alle stoppede tider</small></div>
        <div><span><UsersRound aria-hidden="true" /></span><strong>{users.length}</strong><small>brugere</small></div>
        <div><span><ShieldCheck aria-hidden="true" /></span><strong>{categories.filter((category) => category.is_active).length}</strong><small>aktive kategorier</small></div>
      </div>
      <AdminDashboard categories={categories} users={users} initialAttemptPage={attemptsResult} clans={clans} achievementAssets={achievementAssets} battleRanks={(battleRanksResult.data ?? []) as BattleRank[]} battleRatings={battleRatingsResult.data ?? []} currentUserId={admin.id} />
    </div>
  );
}
