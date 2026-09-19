import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listPeerReviewAttemptsAction, reviewAttemptAction } from "@/actions/reviews";
import { PeerReviewList } from "@/components/peer-review-list";
import type { PeerReviewAttempt } from "@/types/app";

vi.mock("@/actions/reviews", () => ({
  listPeerReviewAttemptsAction: vi.fn(),
  reviewAttemptAction: vi.fn(),
}));

const review: PeerReviewAttempt = {
  attempt_id: "20000000-0000-4000-8000-000000000001",
  user_id: "10000000-0000-4000-8000-000000000002",
  username: "vennen",
  avatar_path: null,
  category_id: "00000000-0000-4000-8000-000000000001",
  category_name: "Flaske",
  category_icon_key: "bottle",
  category_accent_color: "#D97706",
  clan_id: null,
  clan_name: null,
  elapsed_ms: 2_000,
  stopped_at: "2099-01-01T00:00:02.000Z",
  submitted_for_review_at: "2099-01-01T00:00:03.000Z",
  evidence_video_path: null,
  evidence_video_url: null,
};

describe("PeerReviewList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reviewAttemptAction).mockResolvedValue({ ok: true, data: undefined });
  });

  afterEach(cleanup);

  it("lets a friend approve directly without entering a code", async () => {
    render(<PeerReviewList initialAttempts={[review]} initialTotal={1} />);

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /bekræft tiden/i }));

    await waitFor(() => expect(reviewAttemptAction).toHaveBeenCalledWith(review.attempt_id, true));
    expect(await screen.findByText("Tiden er bekræftet.")).toBeInTheDocument();
  }, 10_000);

  it("loads additional reviews without loading the whole queue", async () => {
    const nextReview = { ...review, attempt_id: "20000000-0000-4000-8000-000000000002" };
    vi.mocked(listPeerReviewAttemptsAction).mockResolvedValue({
      ok: true,
      data: { attempts: [nextReview], total: 2, hasMore: false, nextCursor: null },
    });
    render(<PeerReviewList initialAttempts={[review]} initialTotal={2} />);

    fireEvent.click(screen.getByRole("button", { name: /indlæs flere/i }));

    await waitFor(() => expect(listPeerReviewAttemptsAction).toHaveBeenCalledWith({
      submittedAt: review.submitted_for_review_at,
      id: review.attempt_id,
    }));
    expect(screen.getAllByRole("button", { name: /bekræft tiden/i })).toHaveLength(2);
  });
});
