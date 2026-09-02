import type { Metadata } from "next";
import { ScanSearch } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PeerReviewList } from "@/components/peer-review-list";
import { requireProfile } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PeerReviewAttempt } from "@/types/app";

export const metadata: Metadata = { title: "Godkend tider" };

function evidenceUrl(path: string | null) {
  if (!path) return null;
  return `/api/attempt-videos/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export default async function PeerReviewPage() {
  await requireProfile();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_peer_review_attempts");
  if (error) throw new Error("Tiderne kunne ikke hentes.");
  const attempts = ((data ?? []) as PeerReviewAttempt[]).map((attempt) => ({
    ...attempt,
    evidence_video_url: evidenceUrl(attempt.evidence_video_path),
  }));

  return (
    <div className="page page--review">
      <PageHeader
        eyebrow="Vennernes tider"
        title="Godkend tider"
        description="Her kan du kun bekræfte eller afvise tider fra dine venner."
        action={<span className="header-clan"><ScanSearch aria-hidden="true" /></span>}
      />
      <section className="friend-reviews">
        <div className="section-heading">
          <div><p className="eyebrow">Afventer dig</p><h2>Tider til godkendelse</h2></div>
          <span className={attempts.length ? "friend-reviews__count is-active" : "friend-reviews__count"}><ScanSearch aria-hidden="true" /> {attempts.length}</span>
        </div>
        <p className="friend-reviews__lead">Du ser kun tider fra accepterede venner, som ikke er optaget på din konto.</p>
        <PeerReviewList initialAttempts={attempts} />
      </section>
    </div>
  );
}
