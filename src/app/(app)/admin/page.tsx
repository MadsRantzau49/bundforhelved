import type { Metadata } from "next";
import { ShieldCheck, TimerReset, UsersRound } from "lucide-react";
import { AdminDashboard } from "@/components/admin-dashboard";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AchievementAsset, Category, Profile } from "@/types/app";

export const metadata: Metadata = { title: "Administration" };

export default async function AdminPage() {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  async function getAllStoppedAttempts() {
    const rows: unknown[] = [];
    for (let from = 0; ; from += 1000) {
      const result = await supabase
        .from("attempts")
        .select("id, user_id, recorded_by, category_id, clan_id, elapsed_ms, stopped_at, confirmed_at, submitted_for_review_at, reviewed_at, status, invalidated_reason, profiles!attempts_user_id_fkey(id, username, avatar_path), recorder:profiles!attempts_recorded_by_fkey(id, username), categories!inner(id, name, icon_key, accent_color), clans(id, name)")
        .neq("status", "running")
        .order("stopped_at", { ascending: false })
        .range(from, from + 999);
      if (result.error) return { data: null, error: result.error };
      rows.push(...(result.data ?? []));
      if ((result.data?.length ?? 0) < 1000) return { data: rows, error: null };
    }
  }
  const [categoriesResult, usersResult, attemptsResult, clansResult, achievementAssetsResult] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name, icon_key, accent_color, description, image_path, guide_text, guide_video_path, demo_video_path, sort_order, is_active")
      .order("sort_order"),
    supabase
      .from("profiles")
      .select("id, username, avatar_path, role, created_at")
      .order("created_at", { ascending: false }),
    getAllStoppedAttempts(),
    supabase
      .from("clans")
      .select("id, name, clan_members!clan_members_clan_id_fkey(user_id)")
      .order("name"),
    supabase.from("achievement_assets").select("achievement_key, image_path"),
  ]);

  if (categoriesResult.error || usersResult.error || attemptsResult.error || clansResult.error || achievementAssetsResult.error) {
    throw new Error("Administrationsdata kunne ikke hentes.");
  }

  const categories = (categoriesResult.data ?? []) as Category[];
  const users = (usersResult.data ?? []) as Profile[];
  const attempts = (attemptsResult.data ?? []) as unknown as Parameters<typeof AdminDashboard>[0]["attempts"];
  const clans = (clansResult.data ?? []) as unknown as Parameters<typeof AdminDashboard>[0]["clans"];
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
        <div><span><TimerReset aria-hidden="true" /></span><strong>{attempts.length}</strong><small>alle stoppede tider</small></div>
        <div><span><UsersRound aria-hidden="true" /></span><strong>{users.length}</strong><small>brugere</small></div>
        <div><span><ShieldCheck aria-hidden="true" /></span><strong>{categories.filter((category) => category.is_active).length}</strong><small>aktive kategorier</small></div>
      </div>
      <AdminDashboard categories={categories} users={users} attempts={attempts} clans={clans} achievementAssets={achievementAssets} currentUserId={admin.id} />
    </div>
  );
}
