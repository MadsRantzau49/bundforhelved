"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Film, Handshake, X } from "lucide-react";
import { listPeerReviewAttemptsAction, reviewAttemptAction } from "@/actions/reviews";
import { Avatar } from "@/components/avatar";
import { CategoryIcon } from "@/components/category-icon";
import { formatDate, formatTime } from "@/lib/format";
import type { PeerReviewAttempt } from "@/types/app";

export function PeerReviewList({ initialAttempts, initialTotal }: { initialAttempts: PeerReviewAttempt[]; initialTotal: number }) {
  const [attempts, setAttempts] = useState(initialAttempts);
  const [total, setTotal] = useState(initialTotal);
  const [hasMore, setHasMore] = useState(initialAttempts.length < initialTotal);
  const [nextCursor, setNextCursor] = useState(
    initialAttempts.length
      ? { submittedAt: initialAttempts.at(-1)!.submitted_for_review_at, id: initialAttempts.at(-1)!.attempt_id }
      : null,
  );
  const [message, setMessage] = useState<string>();
  const [pendingId, setPendingId] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [loadingMore, startLoadingMore] = useTransition();

  function decide(attempt: PeerReviewAttempt, approve: boolean) {
    if (!approve && !window.confirm(`Afvis tiden for @${attempt.username}? Den forsvinder fra ranglisten.`)) return;

    setMessage(undefined);
    setPendingId(attempt.attempt_id);
    startTransition(async () => {
      try {
        const result = await reviewAttemptAction(attempt.attempt_id, approve);
        if (result.ok) {
          setAttempts((current) => current.filter((item) => item.attempt_id !== attempt.attempt_id));
          setTotal((current) => Math.max(0, current - 1));
          setMessage(approve ? "Tiden er bekræftet." : "Tiden er afvist.");
        } else {
          setMessage(result.error);
        }
      } catch {
        setMessage("Forbindelsen røg. Prøv igen.");
      } finally {
        setPendingId(undefined);
      }
    });
  }

  function loadMore() {
    startLoadingMore(async () => {
      if (!nextCursor) return;
      const result = await listPeerReviewAttemptsAction(nextCursor);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setAttempts((current) => {
        const known = new Set(current.map((attempt) => attempt.attempt_id));
        return [...current, ...result.data.attempts.filter((attempt) => !known.has(attempt.attempt_id))];
      });
      setTotal(result.data.total);
      setHasMore(result.data.hasMore);
      setNextCursor(result.data.nextCursor);
    });
  }

  if (!attempts.length && !hasMore) {
    return (
      <div className="peer-review-list">
        {message && <p className="admin-toast" role="status">{message}</p>}
        <section className="empty-state"><span className="empty-state__mark"><CheckCircle2 aria-hidden="true" /></span><h2>Alt er bedømt</h2><p>Ingen af dine venner har tider, som du kan peer reviewe lige nu.</p></section>
      </div>
    );
  }

  return (
    <div className="peer-review-list">
      {message && <p className="admin-toast" role="status">{message}</p>}
      {attempts.map((attempt) => (
        <article className="review-card" key={attempt.attempt_id} style={{ "--category-color": attempt.category_accent_color } as React.CSSProperties}>
          <header>
            <Avatar username={attempt.username} path={attempt.avatar_path} size="large" />
            <div><p className="eyebrow">Afventer din dom</p><h2>@{attempt.username}</h2><span>{formatDate(attempt.submitted_for_review_at)} · {attempt.clan_name ?? "Global"}</span></div>
            <strong>{formatTime(attempt.elapsed_ms)}<small>s</small></strong>
          </header>
          <div className="review-card__category"><CategoryIcon iconKey={attempt.category_icon_key} /><span>{attempt.category_name}</span></div>
          {attempt.evidence_video_url ? (
            <div className="review-video"><strong><Film aria-hidden="true" /> Frivillig video</strong><video src={attempt.evidence_video_url} controls playsInline preload="none" /></div>
          ) : <p className="review-card__no-video"><Film aria-hidden="true" /> Tiden blev sat uden video.</p>}
          <p className="review-friend"><Handshake aria-hidden="true" /> I er venner, så du kan bedømme tiden direkte.</p>
          <button className="button button--primary button--wide review-approve" disabled={pending || loadingMore} onClick={() => decide(attempt, true)}>
            <CheckCircle2 aria-hidden="true" /> {pendingId === attempt.attempt_id ? "Bekræfter..." : "Bekræft tiden"}
          </button>
          <details className="safe-reject">
            <summary>Er tiden ugyldig?</summary>
            <p>Afvisning er adskilt for at undgå fejltryk.</p>
            <button className="button button--danger button--wide" disabled={pending || loadingMore} onClick={() => decide(attempt, false)}><X aria-hidden="true" /> Afvis tiden</button>
          </details>
        </article>
      ))}
      {hasMore && nextCursor && <button className="button button--ghost button--wide" type="button" disabled={pending || loadingMore} onClick={loadMore}>{loadingMore ? "Henter..." : `Indlæs flere (${attempts.length} af ${total})`}</button>}
    </div>
  );
}
