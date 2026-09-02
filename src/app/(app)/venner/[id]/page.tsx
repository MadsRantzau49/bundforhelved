import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ProfileOverview } from "@/components/profile-overview";
import { requireProfile } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation";
import type { AchievementAsset, FriendProfileData } from "@/types/app";

export const metadata: Metadata = { title: "Venneprofil" };

export default async function FriendProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const currentProfile = await requireProfile();
  const friendId = uuidSchema.safeParse((await params).id);
  if (!friendId.success) notFound();
  if (friendId.data === currentProfile.id) redirect("/profil");

  const supabase = await createSupabaseServerClient();
  const [friendResult, categoriesResult, assetsResult] = await Promise.all([
    supabase.rpc("get_friend_profile", { friend: friendId.data }),
    supabase.from("categories").select("id").eq("is_active", true),
    supabase.from("achievement_assets").select("achievement_key, image_path"),
  ]);
  if (friendResult.error || !friendResult.data || categoriesResult.error || assetsResult.error) notFound();
  const data = friendResult.data;
  const friend = data as FriendProfileData;

  return (
    <div className="page page--profile">
      <Link href="/venner" className="back-link"><ArrowLeft aria-hidden="true" /> Tilbage til venner</Link>
      <ProfileOverview
        profile={friend.profile}
        attempts={friend.attempts}
        achievementAssets={(assetsResult.data ?? []) as AchievementAsset[]}
        activeCategoryIds={(categoriesResult.data ?? []).map((category) => category.id)}
      />
    </div>
  );
}
