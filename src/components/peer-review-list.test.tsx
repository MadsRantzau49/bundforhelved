import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reviewAttemptAction } from "@/actions/reviews";
import { PeerReviewList } from "@/components/peer-review-list";
import type { PeerReviewAttempt } from "@/types/app";

vi.mock("@/actions/reviews", () => ({
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

  it("lets a friend approve directly without entering a code", async () => {
    render(<PeerReviewList initialAttempts={[review]} />);

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /bekræft tiden/i }));

    await waitFor(() => expect(reviewAttemptAction).toHaveBeenCalledWith(review.attempt_id, true));
    expect(await screen.findByText("Tiden er bekræftet.")).toBeInTheDocument();
  });
});
