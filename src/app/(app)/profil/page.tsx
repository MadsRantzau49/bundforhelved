import type { Metadata } from "next";
import { ProfileOverview } from "@/components/profile-overview";
import { requireProfile } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AchievementAsset, ProfileAttempt } from "@/types/app";

export const metadata: Metadata = { title: "Statistikker" };

type Membership = {
  clan_id: string;
  clans: { id: string; name: string };
};

export default async function ProfilePage() {
  const profile = await requireProfile();
  const supabase = await createSupabaseServerClient();
  async function getAllAttempts() {
    const rows: unknown[] = [];
    for (let from = 0; ; from += 1000) {
      const result = await supabase
        .from("attempts")
        .select("id, category_id, clan_id, elapsed_ms, confirmed_at, submitted_for_review_at, reviewed_by, status, invalidated_reason, created_at, categories!inner(id, name, icon_key, accent_color), reviewer:profiles!attempts_reviewed_by_fkey(username)")
        .eq("user_id", profile.id)
        .in("status", ["approved", "pending_review", "invalidated"])
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, from + 999);
      if (result.error) return { data: null, error: result.error };
      rows.push(...(result.data ?? []));
      if ((result.data?.length ?? 0) < 1000) return { data: rows, error: null };
    }
  }
  const [attemptsResult, membershipsResult, categoriesResult, assetsResult] = await Promise.all([
    getAllAttempts(),
    supabase
      .from("clan_members")
      .select("clan_id, clans!clan_members_clan_id_fkey!inner(id, name)")
      .eq("user_id", profile.id),
    supabase.from("categories").select("id").eq("is_active", true),
    supabase.from("achievement_assets").select("achievement_key, image_path"),
  ]);

  if (attemptsResult.error || membershipsResult.error || categoriesResult.error || assetsResult.error) {
    throw new Error("Profildata kunne ikke hentes.");
  }

  const memberships = (membershipsResult.data ?? []) as unknown as Membership[];
  const clanNames = new Map(memberships.map((membership) => [membership.clan_id, membership.clans.name]));
  const attempts = ((attemptsResult.data ?? []) as unknown as ProfileAttempt[]).map((attempt) => ({
    ...attempt,
    scope_name: attempt.clan_id ? clanNames.get(attempt.clan_id) ?? "Klan" : "Global",
  }));

  return (
    <div className="page page--profile">
      <ProfileOverview
        profile={profile}
        attempts={attempts}
        achievementAssets={(assetsResult.data ?? []) as AchievementAsset[]}
        activeCategoryIds={(categoriesResult.data ?? []).map((category) => category.id)}
        own
      />
    </div>
  );
}
