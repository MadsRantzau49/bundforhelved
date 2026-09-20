import type { Metadata } from "next";
import { ScanSearch } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PeerReviewList } from "@/components/peer-review-list";
import { requireProfile } from "@/lib/auth/session";
import { getPeerReviewPage } from "@/lib/peer-reviews";

export const metadata: Metadata = { title: "Godkend tider" };

export default async function PeerReviewPage() {
  await requireProfile();
  const reviewPage = await getPeerReviewPage(null);

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
          <span className={reviewPage.total ? "friend-reviews__count is-active" : "friend-reviews__count"}><ScanSearch aria-hidden="true" /> {reviewPage.total}</span>
        </div>
        <p className="friend-reviews__lead">Du ser kun tider fra accepterede venner, som ikke er optaget på din konto.</p>
        <PeerReviewList initialAttempts={reviewPage.attempts} initialTotal={reviewPage.total} />
      </section>
    </div>
  );
}
