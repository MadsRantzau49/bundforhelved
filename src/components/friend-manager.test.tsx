import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  pingFriendForReviewAction,
  searchFriendProfilesAction,
  sendFriendRequestAction,
} from "@/actions/friends";
import { FriendManager } from "@/components/friend-manager";
import type { FriendRecommendation, Friendship } from "@/types/app";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/actions/friends", () => ({
  pingFriendForReviewAction: vi.fn(),
  removeFriendAction: vi.fn(),
  respondFriendRequestAction: vi.fn(),
  searchFriendProfilesAction: vi.fn(),
  sendFriendRequestAction: vi.fn(),
}));

const thomas: Friendship = {
  friendship_id: "10000000-0000-4000-8000-000000000001",
  other_user_id: "20000000-0000-4000-8000-000000000001",
  username: "Thomas",
  avatar_path: null,
  direction: "friend",
  created_at: "2099-01-01T00:00:00.000Z",
};

const mads: FriendRecommendation = {
  user_id: "30000000-0000-4000-8000-000000000001",
  username: "Mads",
  avatar_path: null,
  mutual_friend_count: 1,
  mutual_usernames: ["Thomas"],
};

describe("FriendManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(searchFriendProfilesAction).mockResolvedValue({
      ok: true,
      data: [{ ...mads, relationship: null }],
    });
    vi.mocked(sendFriendRequestAction).mockResolvedValue({ ok: true, data: undefined });
    vi.mocked(pingFriendForReviewAction).mockResolvedValue({ ok: true, data: true });
  });

  afterEach(cleanup);

  it("searches from the typed prefix and keeps the selected user id", async () => {
    render(<FriendManager relationships={[thomas]} recommendations={[mads]} pingableFriendIds={[]} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Brugernavn" }), { target: { value: "m" } });
    const option = await screen.findByRole("option", { name: /@Mads/i });
    expect(searchFriendProfilesAction).toHaveBeenCalledWith("m");
    fireEvent.click(option);
    fireEvent.click(screen.getByRole("button", { name: /send anmodning/i }));

    await waitFor(() => expect(sendFriendRequestAction).toHaveBeenCalledWith("Mads", mads.user_id));
  });

  it("links accepted friends to stats and only shows eligible review pings", () => {
    render(
      <FriendManager
        relationships={[thomas]}
        recommendations={[]}
        pingableFriendIds={[thomas.other_user_id]}
      />,
    );

    expect(screen.getByRole("link", { name: /se profil for @Thomas/i })).toHaveAttribute("href", `/venner/${thomas.other_user_id}`);
    fireEvent.click(screen.getByRole("button", { name: /ping @Thomas/i }));
    expect(pingFriendForReviewAction).toHaveBeenCalledWith(thomas.other_user_id);
  });
});
