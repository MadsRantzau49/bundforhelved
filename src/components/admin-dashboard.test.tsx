import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listAdminAttemptsAction } from "@/actions/admin";
import { AdminDashboard } from "@/components/admin-dashboard";
import type { AdminAttempt, AdminAttemptPage, Category, Profile } from "@/types/app";

vi.mock("@/actions/admin", () => ({
  adminUpdateAttemptAction: vi.fn(),
  createCategoryAction: vi.fn(),
  deleteUserAction: vi.fn(),
  listAdminAttemptsAction: vi.fn(),
  resetUserPasswordAction: vi.fn(),
  setUserAdminAction: vi.fn(),
  toggleCategoryAction: vi.fn(),
  updateAchievementImageAction: vi.fn(),
  updateCategoryAction: vi.fn(),
}));

const category: Category = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Flaske",
  icon_key: "bottle",
  accent_color: "#D97706",
  description: "Test",
  image_path: null,
  guide_text: "",
  guide_video_path: null,
  demo_video_path: null,
  sort_order: 1,
  is_active: true,
};

const user: Profile = {
  id: "10000000-0000-4000-8000-000000000001",
  username: "admin",
  avatar_path: null,
  role: "admin",
  created_at: "2099-01-01T00:00:00.000Z",
};

function adminAttempt(id: string): AdminAttempt {
  return {
    id,
    user_id: user.id,
    recorded_by: user.id,
    category_id: category.id,
    clan_id: null,
    elapsed_ms: 2_000,
    stopped_at: "2099-01-01T00:00:02.000Z",
    confirmed_at: "2099-01-01T00:00:03.000Z",
    submitted_for_review_at: "2099-01-01T00:00:03.000Z",
    reviewed_at: "2099-01-01T00:00:04.000Z",
    status: "approved",
    invalidated_reason: null,
    profiles: { id: user.id, username: user.username, avatar_path: null },
    recorder: { id: user.id, username: user.username },
    categories: {
      id: category.id,
      name: category.name,
      icon_key: category.icon_key,
      accent_color: category.accent_color,
    },
    clans: null,
  };
}

function renderDashboard(initialAttemptPage: AdminAttemptPage) {
  return render(
    <AdminDashboard
      categories={[category]}
      users={[user]}
      initialAttemptPage={initialAttemptPage}
      clans={[]}
      achievementAssets={[]}
      battleRanks={[]}
      battleRatings={[]}
      currentUserId={user.id}
    />,
  );
}

describe("AdminDashboard", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("loads the next page of attempts on demand", async () => {
    const first = adminAttempt("20000000-0000-4000-8000-000000000001");
    const second = adminAttempt("20000000-0000-4000-8000-000000000002");
    vi.mocked(listAdminAttemptsAction).mockResolvedValue({
      ok: true,
      data: { attempts: [second], total: 2, hasMore: false, nextCursor: null },
    });
    renderDashboard({
      attempts: [first],
      total: 2,
      hasMore: true,
      nextCursor: { stoppedAt: first.stopped_at, id: first.id },
    });

    fireEvent.click(screen.getByRole("button", { name: "Indlæs flere tider" }));

    await waitFor(() => expect(listAdminAttemptsAction).toHaveBeenCalledWith("", "all", {
      stoppedAt: first.stopped_at,
      id: first.id,
    }));
    expect(await screen.findByText("2 af 2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Indlæs flere tider" })).not.toBeInTheDocument();
  }, 15_000);

  it("searches all attempts on the server", async () => {
    vi.mocked(listAdminAttemptsAction).mockResolvedValue({
      ok: true,
      data: { attempts: [], total: 0, hasMore: false, nextCursor: null },
    });
    renderDashboard({
      attempts: [adminAttempt("20000000-0000-4000-8000-000000000001")],
      total: 1,
      hasMore: false,
      nextCursor: null,
    });

    fireEvent.change(screen.getByPlaceholderText(/søg bruger/i), { target: { value: "krus" } });

    await waitFor(() => expect(listAdminAttemptsAction).toHaveBeenCalledWith("krus", "all", null));
    expect(await screen.findByText("Ingen tider matcher filtrene.", {}, { timeout: 10_000 })).toBeInTheDocument();
  }, 15_000);
});
