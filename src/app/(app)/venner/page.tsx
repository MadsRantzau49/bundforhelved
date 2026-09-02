import type { Metadata } from "next";
import { UsersRound } from "lucide-react";
import { FriendManager } from "@/components/friend-manager";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FriendRecommendation, Friendship } from "@/types/app";

export const metadata: Metadata = { title: "Venner" };

export default async function FriendsPage() {
  const profile = await requireProfile();
  const supabase = await createSupabaseServerClient();
  const [friendshipsResult, recommendationsResult, ownPendingResult] = await Promise.all([
    supabase.rpc("list_friendships"),
    supabase.rpc("list_friend_recommendations"),
    supabase
      .from("attempts")
      .select("recorded_by")
      .eq("user_id", profile.id)
      .eq("status", "pending_review"),
  ]);

  if (friendshipsResult.error || recommendationsResult.error || ownPendingResult.error) {
    throw new Error("Venner kunne ikke hentes.");
  }

  const relationships = (friendshipsResult.data ?? []) as Friendship[];
  const recommendations = (recommendationsResult.data ?? []) as FriendRecommendation[];
  const pingableFriendIds = relationships
    .filter((relationship) => relationship.direction === "friend")
    .filter((relationship) => (ownPendingResult.data ?? []).some(
      (attempt) => !attempt.recorded_by || attempt.recorded_by !== relationship.other_user_id,
    ))
    .map((relationship) => relationship.other_user_id);
  return (
    <div className="page page--friends">
      <PageHeader
        eyebrow="Din vennebog"
        title="Venner"
        description="Tilføj spillere, svar på anmodninger, og hold styr på din venneliste."
        action={<span className="header-clan"><UsersRound aria-hidden="true" /></span>}
      />

      <FriendManager
        relationships={relationships}
        recommendations={recommendations}
        pingableFriendIds={pingableFriendIds}
      />
    </div>
  );
}
