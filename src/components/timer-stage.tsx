"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronRight,
  CircleStop,
  Globe2,
  Play,
  RotateCcw,
  UserPlus,
  UsersRound,
  WifiOff,
  X,
} from "lucide-react";
import clsx from "clsx";
import {
  confirmAttempt,
  declineAttempt,
  reassignAttempt,
  startAttempt,
  stopAttempt,
  syncAttemptElapsed,
} from "@/actions/attempts";
import { Avatar } from "@/components/avatar";
import { CategoryIcon } from "@/components/category-icon";
import { GuestConnectForm } from "@/components/guest-connect-form";
import { useConnectionStatus } from "@/lib/connection-status";
import { formatTime } from "@/lib/format";
import type { Attempt, Category, TimerPlayer } from "@/types/app";

export function TimerStage({
  categories,
  initialAttempt,
  attemptCategory,
  initialElapsedMs,
  initialPlayers,
  initialClanId,
}: {
  categories: Category[];
  initialAttempt: Attempt | null;
  attemptCategory: Category | null;
  initialElapsedMs: number;
  initialPlayers: TimerPlayer[];
  initialClanId: string | null;
}) {
  const router = useRouter();
  const host = initialPlayers.find((player) => player.is_host) ?? initialPlayers[0];
  const [players, setPlayers] = useState(initialPlayers);
  const [activeAttempt, setActiveAttempt] = useState(initialAttempt);
  const [selectedPlayerId, setSelectedPlayerId] = useState(
    initialAttempt?.user_id ?? host?.player_id ?? "",
  );
  const [selectedClanId, setSelectedClanId] = useState<string | null>(
    initialAttempt ? initialAttempt.clan_id : initialClanId,
  );
  const [selectedId, setSelectedId] = useState(initialAttempt?.category_id ?? categories[0]?.id ?? "");
  const [elapsed, setElapsed] = useState(initialElapsedMs);
  const elapsedRef = useRef(initialElapsedMs);
  const [clockRevision, setClockRevision] = useState(0);
  const [resumeRevision, setResumeRevision] = useState(0);
  const [startMode, setStartMode] = useState(false);
  const [starting, setStarting] = useState(false);
  const [showGuestForm, setShowGuestForm] = useState(false);
  const [showCorrection, setShowCorrection] = useState(false);
  const [error, setError] = useState<string>();
  const online = useConnectionStatus();
  const previousOnline = useRef(online);
  const [pending, startTransition] = useTransition();
  const runKey = activeAttempt?.status === "running" ? activeAttempt.id : null;
  const playerId = activeAttempt?.user_id ?? selectedPlayerId;
  const player = players.find((item) => item.player_id === playerId);
  const clanId = activeAttempt ? activeAttempt.clan_id : selectedClanId;
  const clan = player?.clans.find((item) => item.id === clanId);
  const category = [...categories, ...(attemptCategory ? [attemptCategory] : [])].find(
    (item) => item.id === (activeAttempt?.category_id ?? selectedId),
  );

  useEffect(() => {
    if (online && !previousOnline.current && activeAttempt) {
      setResumeRevision((revision) => revision + 1);
      router.refresh();
    }
    previousOnline.current = online;
  }, [activeAttempt, online, router]);

  useEffect(() => {
    if (!activeAttempt) return;
    const reconcile = () => {
      if (document.visibilityState !== "visible") return;
      setResumeRevision((revision) => revision + 1);
      router.refresh();
    };
    window.addEventListener("pageshow", reconcile);
    document.addEventListener("visibilitychange", reconcile);
    return () => {
      window.removeEventListener("pageshow", reconcile);
      document.removeEventListener("visibilitychange", reconcile);
    };
  }, [activeAttempt, router]);

  useEffect(() => {
    if (!runKey) return;

    const baseline = elapsedRef.current;
    const anchor = performance.now();
    let frame: number;
    const update = (now: number) => {
      const nextElapsed = baseline + Math.max(0, now - anchor);
      elapsedRef.current = nextElapsed;
      setElapsed(nextElapsed);
      frame = window.requestAnimationFrame(update);
    };
    frame = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(frame);
  }, [runKey, clockRevision]);

  useEffect(() => {
    if (!runKey || !online) return;
    let cancelled = false;
    let retry: number | undefined;
    let retryDelay = 2_000;

    const scheduleRetry = () => {
      const delay = document.visibilityState === "visible" ? retryDelay : 15_000;
      retry = window.setTimeout(synchronize, delay);
      retryDelay = Math.min(retryDelay * 2, 30_000);
    };

    const synchronize = async () => {
      try {
        const result = await syncAttemptElapsed(runKey);
        if (cancelled) return;
        if (!result.ok) {
          scheduleRetry();
          return;
        }
        elapsedRef.current = result.data;
        setElapsed(result.data);
        setClockRevision((revision) => revision + 1);
      } catch {
        if (!cancelled) scheduleRetry();
      }
    };

    void synchronize();

    return () => {
      cancelled = true;
      if (retry !== undefined) window.clearTimeout(retry);
    };
  }, [online, resumeRevision, runKey]);

  function vibrate(pattern: number | number[]) {
    if ("vibrate" in navigator) navigator.vibrate(pattern);
  }

  function choosePlayer(nextPlayer: TimerPlayer) {
    setSelectedPlayerId(nextPlayer.player_id);
    if (selectedClanId && !nextPlayer.clans.some((item) => item.id === selectedClanId)) {
      setSelectedClanId(null);
    }
  }

  function addPlayer(nextPlayer: TimerPlayer) {
    if (nextPlayer.needs_refresh) {
      window.location.reload();
      return;
    }
    setPlayers((current) => current.some((item) => item.player_id === nextPlayer.player_id)
      ? current
      : [...current, nextPlayer]);
    choosePlayer(nextPlayer);
    setShowGuestForm(false);
  }

  async function handleStart() {
    if (!selectedId || !selectedPlayerId || starting) return;
    setError(undefined);
    setStarting(true);
    elapsedRef.current = 0;
    setElapsed(0);

    try {
      const result = await startAttempt(selectedId, selectedClanId, selectedPlayerId);
      if (!result.ok) {
        setError(result.error);
        router.refresh();
        return;
      }
      elapsedRef.current = result.data.live_elapsed_ms;
      setElapsed(result.data.live_elapsed_ms);
      setClockRevision((revision) => revision + 1);
      setActiveAttempt(result.data.attempt);
      vibrate(50);
    } catch {
      setError("Uret kunne ikke startes. Siden opdateres for at kontrollere forsøget.");
      router.refresh();
    } finally {
      setStarting(false);
    }
  }

  function handleStop() {
    if (!activeAttempt) return;
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await stopAttempt(activeAttempt.id);
        if (!result.ok) {
          setError(result.error);
          router.refresh();
          return;
        }
        const finalElapsed = result.data.elapsed_ms ?? elapsedRef.current;
        elapsedRef.current = finalElapsed;
        setElapsed(finalElapsed);
        setActiveAttempt(result.data);
        vibrate([60, 50, 120]);
      } catch {
        setError("Stoppet kunne ikke bekræftes. Timerstatus opdateres.");
        router.refresh();
      }
    });
  }

  function handleConfirm() {
    if (!activeAttempt) return;
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await confirmAttempt(activeAttempt.id);
        if (!result.ok) {
          setError(result.error);
          router.refresh();
          return;
        }
        vibrate([50, 40, 50]);
        if (!category?.is_active) {
          router.push("/profil");
        } else {
          const query = new URLSearchParams({ kategori: activeAttempt.category_id, ny: "1" });
          if (activeAttempt.clan_id) query.set("klan", activeAttempt.clan_id);
          router.push(`/rangliste?${query.toString()}`);
        }
        router.refresh();
      } catch {
        setError("Tiden kunne ikke godkendes. Prøv igen.");
        router.refresh();
      }
    });
  }

  function handleDecline() {
    if (!activeAttempt) return;
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await declineAttempt(activeAttempt.id);
        if (!result.ok) {
          setError(result.error);
          router.refresh();
          return;
        }
        setActiveAttempt(null);
        setStartMode(false);
        elapsedRef.current = 0;
        setElapsed(0);
        if (host) setSelectedPlayerId(host.player_id);
        setSelectedClanId(null);
        router.refresh();
      } catch {
        setError("Forsøget kunne ikke afvises. Prøv igen.");
        router.refresh();
      }
    });
  }

  function handleReassign(nextPlayer: TimerPlayer) {
    if (!activeAttempt || nextPlayer.player_id === activeAttempt.user_id) return;
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await reassignAttempt(activeAttempt.id, nextPlayer.player_id);
        if (!result.ok) {
          setError(result.error);
          router.refresh();
          return;
        }
        setActiveAttempt(result.data);
        setSelectedPlayerId(nextPlayer.player_id);
        setShowCorrection(false);
      } catch {
        setError("Spilleren kunne ikke ændres. Prøv igen.");
        router.refresh();
      }
    });
  }

  if (activeAttempt?.status === "awaiting_confirmation") {
    const eligiblePlayers = players.filter(
      (item) => !activeAttempt.clan_id || item.clans.some((scope) => scope.id === activeAttempt.clan_id),
    );

    return (
      <section className="result-stage" style={{ "--accent": category?.accent_color } as React.CSSProperties}>
        <div className="result-stage__burst" aria-hidden="true" />
        <p className="eyebrow">Uret er stoppet</p>
        <div className="result-stage__time">{formatTime(activeAttempt.elapsed_ms ?? elapsed)}<small>sek</small></div>
        <div className="result-stage__category">
          <CategoryIcon iconKey={category?.icon_key ?? "cup"} />
          <span>{category?.name} · {clan ? clan.name : "Global"}</span>
        </div>
        <div className="attempt-player">
          {player && <Avatar username={player.username} path={player.avatar_path} size="medium" />}
          <div><span>Tiden registreres for</span><strong>@{player?.username ?? "ukendt"}</strong></div>
          <button className="text-button" type="button" onClick={() => setShowCorrection((value) => !value)}>
            Forkert person?
          </button>
        </div>
        {showCorrection && (
          <div className="player-correction">
            <strong>Flyt tiden før godkendelse</strong>
            <div className="player-pills">
              {eligiblePlayers.map((item) => (
                <button
                  type="button"
                  className={clsx(item.player_id === activeAttempt.user_id && "is-selected")}
                  key={item.player_id}
                  disabled={pending || item.player_id === activeAttempt.user_id}
                  onClick={() => handleReassign(item)}
                >
                  <Avatar username={item.username} path={item.avatar_path} size="small" />
                  @{item.username}
                </button>
              ))}
              <button type="button" onClick={() => setShowGuestForm((value) => !value)}>
                <UserPlus aria-hidden="true" /> Ny gæst
              </button>
            </div>
            {showGuestForm && <GuestConnectForm onConnected={addPlayer} onCancel={() => setShowGuestForm(false)} />}
          </div>
        )}
        <div className="confirm-card">
          <span className="confirm-card__icon"><Check aria-hidden="true" /></span>
          <h2>Er øllen helt tom?</h2>
          <p>Godkend kun tiden, hvis der ikke er mere tilbage.</p>
          {error && <p className="form-message form-message--error" role="alert">{error}</p>}
          <button className="button button--primary button--wide" onClick={handleConfirm} disabled={pending}>
            <Check aria-hidden="true" /> Ja, godkend tiden
          </button>
          <button className="button button--ghost button--wide" onClick={handleDecline} disabled={pending}>
            <X aria-hidden="true" /> Nej, afvis forsøget
          </button>
        </div>
      </section>
    );
  }

  if (activeAttempt?.status === "running" || starting) {
    return (
      <section className="timer-live" style={{ "--accent": category?.accent_color } as React.CSSProperties}>
        <div className="timer-live__status"><i /> {starting ? "Uret starter" : "Uret kører"}</div>
        <div className="timer-live__category">
          <CategoryIcon iconKey={category?.icon_key ?? "cup"} />
          <span>{category?.name} · {clan ? clan.name : "Global"} · @{player?.username}</span>
        </div>
        <div className="timer-display" aria-label={`${formatTime(elapsed)} sekunder`}>
          {formatTime(elapsed)}
          <small>SEKUNDER</small>
        </div>
        {!online && (
          <p className="offline-warning"><WifiOff aria-hidden="true" /> Forbindelsen er væk. Uret fortsætter på serveren.</p>
        )}
        {error && <p className="form-message form-message--error" role="alert">{error}</p>}
        <button className="stop-button" onClick={handleStop} disabled={pending || !activeAttempt}>
          <CircleStop aria-hidden="true" />
          <span>STOP</span>
        </button>
        <button className="text-button" onClick={handleDecline} disabled={pending || !activeAttempt}>
          Afbryd forsøg
        </button>
      </section>
    );
  }

  if (startMode) {
    return (
      <section className="timer-start-mode" style={{ "--accent": category?.accent_color } as React.CSSProperties}>
        <div className="timer-start-mode__status"><i /> Klar til start</div>
        <div className="timer-start-mode__selection">
          <CategoryIcon iconKey={category?.icon_key ?? "cup"} />
          <strong>{category?.name}</strong>
          <span>{clan ? clan.name : "Global"} · @{player?.username}</span>
        </div>
        <p>Hold øllen klar. Tiden starter, når du rammer knappen.</p>
        {error && <p className="form-message form-message--error" role="alert">{error}</p>}
        {!online && (
          <p className="offline-warning"><WifiOff aria-hidden="true" /> Forbindelsen ser ud til at være væk. Du kan stadig prøve.</p>
        )}
        <button
          className="start-trigger"
          type="button"
          onClick={handleStart}
          disabled={pending || starting || !selectedId || !selectedPlayerId}
          aria-label="Start timeren"
        >
          <Play aria-hidden="true" />
          <span>START</span>
          <small>tryk her</small>
        </button>
        <button
          className="text-button"
          type="button"
          disabled={pending || starting}
          onClick={() => {
            setError(undefined);
            setStartMode(false);
          }}
        >
          Tilbage og ret valg
        </button>
      </section>
    );
  }

  if (!categories.length) {
    return (
      <section className="empty-state">
        <span className="empty-state__mark">0</span>
        <h2>Baren er tom</h2>
        <p>En admin skal oprette mindst én aktiv kategori.</p>
      </section>
    );
  }

  return (
    <section className="timer-idle" style={{ "--accent": category?.accent_color } as React.CSSProperties}>
      <div className="timer-choice">
        <div className="section-heading">
          <div><p className="eyebrow">Trin 1</p><h2>Hvem drikker?</h2></div>
          <span>Delt telefon</span>
        </div>
        <div className="player-pills" role="radiogroup" aria-label="Vælg spiller">
          {players.map((item) => (
            <button
              type="button"
              role="radio"
              aria-checked={item.player_id === selectedPlayerId}
              className={clsx(item.player_id === selectedPlayerId && "is-selected")}
              key={item.player_id}
              onClick={() => choosePlayer(item)}
            >
              <Avatar username={item.username} path={item.avatar_path} size="small" />
              @{item.username}{item.is_host && <small>dig</small>}
            </button>
          ))}
          <button type="button" onClick={() => setShowGuestForm((value) => !value)}>
            <UserPlus aria-hidden="true" /> Tilføj gæst
          </button>
        </div>
        {showGuestForm && <GuestConnectForm onConnected={addPlayer} onCancel={() => setShowGuestForm(false)} />}
      </div>

      <div className="timer-choice">
        <div className="section-heading">
          <div><p className="eyebrow">Trin 2</p><h2>Hvor tæller tiden?</h2></div>
        </div>
        <div className="timer-scope-tabs" role="radiogroup" aria-label="Vælg rangliste">
          <button
            type="button"
            role="radio"
            aria-checked={!selectedClanId}
            className={clsx(!selectedClanId && "is-selected")}
            onClick={() => setSelectedClanId(null)}
          >
            <Globe2 aria-hidden="true" /> Global
          </button>
          {(player?.clans ?? []).map((item) => (
            <button
              type="button"
              role="radio"
              aria-checked={selectedClanId === item.id}
              className={clsx(selectedClanId === item.id && "is-selected")}
              key={item.id}
              onClick={() => setSelectedClanId(item.id)}
            >
              <UsersRound aria-hidden="true" /> {item.name}
            </button>
          ))}
        </div>
        <p className="timer-choice__hint">
          Globale tider tæller kun globalt. En klantid tæller kun i den valgte klan.
        </p>
      </div>

      <div className="section-heading">
        <div>
          <p className="eyebrow">Trin 3</p>
          <h2>Vælg dit våben</h2>
        </div>
        <span>{categories.length} kategorier</span>
      </div>
      <div className="category-grid" role="radiogroup" aria-label="Vælg kategori">
        {categories.map((item) => {
          const selected = item.id === selectedId;
          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={clsx("category-card", selected && "is-selected")}
              style={{ "--category-color": item.accent_color } as React.CSSProperties}
              onClick={() => setSelectedId(item.id)}
            >
              <span className="category-card__check"><Check aria-hidden="true" /></span>
              <CategoryIcon iconKey={item.icon_key} />
              <strong>{item.name}</strong>
              <small>{item.description || "Klar til tiden"}</small>
            </button>
          );
        })}
      </div>

      <div className="ready-card">
        <div className="ready-card__top">
          <span><RotateCcw aria-hidden="true" /> Servertid</span>
          <span className={clsx("connection-dot", !online && "is-offline")}>{online ? "Online" : "Offline"}</span>
        </div>
        <div className="ready-card__dial">
          <span>0.00</span>
          <small>sekunder</small>
        </div>
        <p>
          Tiden gemmes for @{player?.username} på {clan ? clan.name : "Global"}. Uret starter, når serveren svarer.
        </p>
        {error && <p className="form-message form-message--error" role="alert">{error}</p>}
        <button
          className="button button--start"
          onClick={() => {
            setError(undefined);
            setStartMode(true);
          }}
          disabled={pending || !selectedId || !selectedPlayerId}
        >
          <span>GÅ TIL START</span>
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
