import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmAttempt, startAttempt, syncAttemptElapsed } from "@/actions/attempts";
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
  changeAttemptScope: vi.fn(),
  syncAttemptElapsed: vi.fn(),
  uploadAttemptEvidence: vi.fn(),
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
  image_path: null,
  guide_text: "",
  guide_video_path: null,
  demo_video_path: null,
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

  it("submits a stopped attempt for review by friends without a code", async () => {
    vi.mocked(confirmAttempt).mockResolvedValue({
      ok: true,
      data: attempt({
        status: "pending_review",
        stopped_at: "2099-01-01T00:00:02.000Z",
        elapsed_ms: 2_000,
        submitted_for_review_at: "2099-01-01T00:00:03.000Z",
      }),
    });
    render(
      <TimerStage
        categories={[category]}
        initialAttempt={attempt({
          status: "awaiting_confirmation",
          stopped_at: "2099-01-01T00:00:02.000Z",
          elapsed_ms: 2_000,
        })}
        attemptCategory={null}
        initialElapsedMs={2_000}
        initialPlayers={[host]}
        initialClanId={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /send til peer review/i }));
    await waitFor(() => expect(confirmAttempt).toHaveBeenCalled());
    expect(screen.getByText(/accepterede venner kan nu bedømme tiden direkte/i)).toBeInTheDocument();
    expect(screen.queryByText(/reviewkode/i)).not.toBeInTheDocument();
  });

  it("explains that phone video needs HTTPS and keeps the timer usable", async () => {
    vi.stubGlobal("isSecureContext", false);
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

    fireEvent.click(screen.getByRole("checkbox", { name: /optag forsøget/i }));
    fireEvent.click(screen.getByRole("button", { name: /gå til start/i }));

    expect(await screen.findByText(/video kræver https/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start timeren/i })).toBeEnabled();
  });

  it("switches from the rear to the front camera", async () => {
    const rearTrack = { stop: vi.fn() };
    const frontTrack = { stop: vi.fn() };
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce({ getTracks: () => [rearTrack] })
      .mockResolvedValueOnce({ getTracks: () => [frontTrack] });
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    vi.stubGlobal("MediaRecorder", class {});
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

    fireEvent.click(screen.getByRole("checkbox", { name: /optag forsøget/i }));
    fireEvent.click(screen.getByRole("button", { name: /gå til start/i }));

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: "environment" }, audio: false }));
    const switchButton = await screen.findByRole("button", { name: /skift til frontkamera/i });
    await waitFor(() => expect(switchButton).toBeEnabled());
    fireEvent.click(switchButton);

    await waitFor(() => expect(getUserMedia).toHaveBeenLastCalledWith({ video: { facingMode: "user" }, audio: false }));
    expect(rearTrack.stop).toHaveBeenCalled();
  });
});
