import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startAttempt, syncAttemptElapsed } from "@/actions/attempts";
import { TimerStage } from "@/components/timer-stage";
import type { Attempt, Category, TimerPlayer } from "@/types/app";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/actions/attempts", () => ({
  startAttempt: vi.fn(),
  stopAttempt: vi.fn(),
  confirmAttempt: vi.fn(),
  declineAttempt: vi.fn(),
  reassignAttempt: vi.fn(),
  syncAttemptElapsed: vi.fn(),
}));

vi.mock("@/actions/guests", () => ({
  connectGuestAccess: vi.fn(),
}));

const category: Category = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Flaske",
  icon_key: "bottle",
  accent_color: "#D97706",
  description: "Test",
  sort_order: 1,
  is_active: true,
};

const host: TimerPlayer = {
  player_id: "10000000-0000-4000-8000-000000000001",
  username: "host_user",
  avatar_path: null,
  is_host: true,
  clans: [],
};

function attempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    user_id: host.player_id,
    recorded_by: host.player_id,
    category_id: category.id,
    clan_id: null,
    started_at: "2099-01-01T00:00:00.000Z",
    stopped_at: null,
    elapsed_ms: null,
    status: "running",
    confirmed_at: null,
    ...overrides,
  };
}

describe("TimerStage", () => {
  let frame: FrameRequestCallback | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    frame = undefined;
    vi.mocked(syncAttemptElapsed).mockResolvedValue({ ok: false, error: "Ingen synkronisering" });
    vi.spyOn(performance, "now").mockReturnValue(100);
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("advances from the server baseline without comparing browser wall clocks", () => {
    render(
      <TimerStage
        categories={[category]}
        initialAttempt={attempt()}
        attemptCategory={null}
        initialElapsedMs={1_000}
        initialPlayers={[host]}
        initialClanId={null}
      />,
    );

    expect(screen.getByLabelText("1.00 sekunder")).toBeInTheDocument();
    expect(frame).toBeTypeOf("function");
    act(() => frame?.(350));
    expect(screen.getByLabelText("1.25 sekunder")).toBeInTheDocument();
  });

  it("opens a large start mode before starting for the selected scope", async () => {
    vi.mocked(startAttempt).mockResolvedValue({
      ok: true,
      data: { attempt: attempt(), live_elapsed_ms: 0 },
    });
    render(
      <TimerStage
        categories={[category]}
        initialAttempt={null}
        attemptCategory={null}
        initialElapsedMs={0}
        initialPlayers={[host]}
        initialClanId={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /gå til start/i }));
    expect(startAttempt).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /start timeren/i })).toHaveClass("start-trigger");

    fireEvent.click(screen.getByRole("button", { name: /start timeren/i }));
    await waitFor(() => expect(startAttempt).toHaveBeenCalledWith(category.id, null, host.player_id));
  });
});
