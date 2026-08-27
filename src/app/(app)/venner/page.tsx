import type { Metadata } from "next";
import { ScanSearch, UsersRound } from "lucide-react";
import { FriendManager } from "@/components/friend-manager";
import { PageHeader } from "@/components/page-header";
import { PeerReviewList } from "@/components/peer-review-list";
import { requireProfile } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Friendship, PeerReviewAttempt } from "@/types/app";

export const metadata: Metadata = { title: "Venner" };

function evidenceUrl(path: string | null) {
  if (!path) return null;
  return `/api/attempt-videos/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export default async function FriendsPage() {
  await requireProfile();
  const supabase = await createSupabaseServerClient();
  const [friendshipsResult, attemptsResult] = await Promise.all([
    supabase.rpc("list_friendships"),
    supabase.rpc("list_peer_review_attempts"),
  ]);

  if (friendshipsResult.error || attemptsResult.error) {
    throw new Error("Venner kunne ikke hentes.");
  }

  const relationships = (friendshipsResult.data ?? []) as Friendship[];
  const attempts = ((attemptsResult.data ?? []) as PeerReviewAttempt[]).map((attempt) => ({
    ...attempt,
    evidence_video_url: evidenceUrl(attempt.evidence_video_path),
  }));

  return (
    <div className="page page--friends">
      <PageHeader
        eyebrow="Vennebog og dommerbord"
        title="Venner"
        description="Tilføj spillere, svar på anmodninger, og peer review dine venners tider uden en kode."
        action={<span className="header-clan"><UsersRound aria-hidden="true" /></span>}
      />

      <FriendManager relationships={relationships} />

      <section className="friend-reviews" id="reviews">
        <div className="section-heading">
          <div><p className="eyebrow">Vennernes tider</p><h2>Peer review</h2></div>
          <ScanSearch aria-hidden="true" />
        </div>
        <p className="friend-reviews__lead">Du ser kun tider fra accepterede venner, som ikke er optaget på din konto.</p>
        <PeerReviewList initialAttempts={attempts} />
      </section>
    </div>
  );
}
