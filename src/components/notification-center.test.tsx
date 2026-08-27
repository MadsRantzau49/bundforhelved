import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteAllNotificationsAction, markNotificationsReadAction } from "@/actions/notifications";
import { NotificationCenter } from "@/components/notification-center";
import type { SocialNotification } from "@/types/app";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/actions/notifications", () => ({
  deleteAllNotificationsAction: vi.fn(),
  markNotificationsReadAction: vi.fn(),
}));

const notification: SocialNotification = {
  notification_id: "10000000-0000-4000-8000-000000000001",
  type: "friend_request",
  title: "Ny venneanmodning",
  body: "@Mads vil gerne være venner.",
  url: "/venner",
  source_user_id: "20000000-0000-4000-8000-000000000001",
  source_username: "Mads",
  source_avatar_path: null,
  position: null,
  created_at: "2099-01-01T00:00:00.000Z",
  read_at: null,
};

describe("NotificationCenter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(deleteAllNotificationsAction).mockResolvedValue({ ok: true, data: undefined });
    vi.mocked(markNotificationsReadAction).mockResolvedValue({ ok: true, data: undefined });
  });

  afterEach(cleanup);

  it("opens persisted notifications and marks the entire inbox as read", async () => {
    render(
      <NotificationCenter
        initialNotifications={[notification]}
        initialUnread={12}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /12 ulæste/i }));
    expect(screen.getByText("@Mads vil gerne være venner.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /markér alle som læst/i }));

    await waitFor(() => expect(markNotificationsReadAction).toHaveBeenCalledWith());
    expect(screen.getByRole("button", { name: "Notifikationer" })).toBeInTheDocument();
  });

  it("removes the entire inbox from the top action", async () => {
    render(<NotificationCenter initialNotifications={[notification]} initialUnread={1} />);

    fireEvent.click(screen.getByRole("button", { name: /1 ulæste/i }));
    fireEvent.click(screen.getByRole("button", { name: /fjern alle/i }));

    await waitFor(() => expect(deleteAllNotificationsAction).toHaveBeenCalledOnce());
    expect(screen.getByText("Ingen notifikationer endnu.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notifikationer" })).toBeInTheDocument();
  });
});
