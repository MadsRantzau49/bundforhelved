"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Camera,
  ChevronRight,
  CircleStop,
  Globe2,
  Play,
  RotateCcw,
  SwitchCamera,
  UserPlus,
  UsersRound,
  WifiOff,
  X,
} from "lucide-react";
import clsx from "clsx";
import {
  changeAttemptScope,
  confirmAttempt,
  declineAttempt,
  reassignAttempt,
  startAttempt,
  stopAttempt,
  syncAttemptElapsed,
  uploadAttemptEvidence,
} from "@/actions/attempts";
import { Avatar } from "@/components/avatar";
import { CategoryIcon } from "@/components/category-icon";
import { CategoryVisual } from "@/components/category-visual";
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
  const [showScopeCorrection, setShowScopeCorrection] = useState(false);
  const [recordEvidence, setRecordEvidence] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraFacingMode, setCameraFacingMode] = useState<"environment" | "user">("environment");
  const [cameraSwitching, setCameraSwitching] = useState(false);
  const [cameraError, setCameraError] = useState<string>();
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingFrameRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const cameraPreviewRef = useRef<HTMLVideoElement | null>(null);
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

  useEffect(() => {
    let disposed = false;
    if (!startMode || !recordEvidence) return;
    if (!window.isSecureContext) {
      queueMicrotask(() => {
        if (!disposed) {
          setCameraError("Video kræver HTTPS på telefoner og andre enheder. Timeren kan stadig bruges uden video.");
          setRecordEvidence(false);
        }
      });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      queueMicrotask(() => {
        if (!disposed) {
          setCameraError("Browseren understøtter ikke videooptagelse. Timeren kan stadig bruges uden video.");
          setRecordEvidence(false);
        }
      });
      return;
    }

    queueMicrotask(() => {
      if (!disposed) {
        setCameraError(undefined);
        setCameraReady(false);
        setCameraFacingMode("environment");
      }
    });
    void navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((stream) => {
        if (disposed) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        cameraStreamRef.current = stream;
        if (cameraPreviewRef.current) cameraPreviewRef.current.srcObject = stream;
        setCameraReady(true);
      })
      .catch((cameraFailure: unknown) => {
        if (disposed) return;
        const name = cameraFailure instanceof DOMException ? cameraFailure.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setCameraError("Kameraadgang blev afvist. Tillad kameraadgang og prøv igen.");
        } else if (name === "NotFoundError") {
          setCameraError("Der blev ikke fundet et kamera på enheden.");
        } else if (name === "NotReadableError") {
          setCameraError("Kameraet bruges allerede af en anden app.");
        } else {
          setCameraError("Kameraet kunne ikke åbnes. Prøv igen uden video.");
        }
        setRecordEvidence(false);
      });

    return () => {
      disposed = true;
      const recorder = mediaRecorderRef.current;
      if (recorder?.state === "recording") recorder.stop();
      stopRecordingStream();
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
      mediaRecorderRef.current = null;
    };
  }, [recordEvidence, startMode]);

  function vibrate(pattern: number | number[]) {
    if ("vibrate" in navigator) navigator.vibrate(pattern);
  }

  function attachCameraPreview(element: HTMLVideoElement | null) {
    cameraPreviewRef.current = element;
    if (element && cameraStreamRef.current) element.srcObject = cameraStreamRef.current;
  }

  function stopRecordingStream() {
    if (recordingFrameRef.current !== null) {
      window.cancelAnimationFrame(recordingFrameRef.current);
      recordingFrameRef.current = null;
    }
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
  }

  async function switchCamera() {
    if (!recordEvidence || !cameraReady || cameraSwitching) return;
    const nextFacingMode = cameraFacingMode === "environment" ? "user" : "environment";
    setCameraSwitching(true);
    setCameraError(undefined);

    try {
      const previousStream = cameraStreamRef.current;
      // Android devices commonly permit only one camera stream at a time.
      previousStream?.getTracks().forEach((track) => track.stop());
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: nextFacingMode }, audio: false });
      cameraStreamRef.current = stream;
      if (cameraPreviewRef.current) cameraPreviewRef.current.srcObject = stream;
      setCameraFacingMode(nextFacingMode);
    } catch {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: cameraFacingMode }, audio: false });
        cameraStreamRef.current = stream;
        if (cameraPreviewRef.current) cameraPreviewRef.current.srcObject = stream;
        setCameraError("Kameraet kunne ikke skiftes. Det forrige kamera er genåbnet.");
      } catch {
        setCameraReady(false);
        setCameraError("Kameraet kunne ikke skiftes. Prøv igen.");
      }
    } finally {
      setCameraSwitching(false);
    }
  }

  function beginEvidenceRecording() {
    if (!recordEvidence) return true;
    const stream = cameraStreamRef.current;
    if (!stream || !cameraReady) {
      setCameraError("Vent på kameraet, før du starter.");
      return false;
    }
    try {
      const preferredTypes = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
      const mimeType = preferredTypes.find((type) => MediaRecorder.isTypeSupported(type));
      const preview = cameraPreviewRef.current;
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!preview || !context || !canvas.captureStream) throw new Error("Camera capture is unavailable");
      canvas.width = preview.videoWidth || 1280;
      canvas.height = preview.videoHeight || 720;
      const drawCameraFrame = () => {
        const currentPreview = cameraPreviewRef.current;
        if (currentPreview?.videoWidth && currentPreview?.videoHeight) {
          if (canvas.width !== currentPreview.videoWidth || canvas.height !== currentPreview.videoHeight) {
            canvas.width = currentPreview.videoWidth;
            canvas.height = currentPreview.videoHeight;
          }
          context.drawImage(currentPreview, 0, 0, canvas.width, canvas.height);
        }
        recordingFrameRef.current = window.requestAnimationFrame(drawCameraFrame);
      };
      drawCameraFrame();
      const recordingStream = canvas.captureStream(30);
      recordingStreamRef.current = recordingStream;
      const recorder = mimeType ? new MediaRecorder(recordingStream, { mimeType }) : new MediaRecorder(recordingStream);
      mediaChunksRef.current = [];
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size) mediaChunksRef.current.push(event.data);
      });
      recorder.start(250);
      mediaRecorderRef.current = recorder;
      return true;
    } catch {
      stopRecordingStream();
      setCameraError("Videooptagelsen kunne ikke startes. Slå video fra og prøv igen.");
      return false;
    }
  }

  function finishEvidenceRecording(): Promise<Blob | null> {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return Promise.resolve(null);
    return new Promise((resolve) => {
      recorder.addEventListener("stop", () => {
        const type = recorder.mimeType.split(";")[0] || "video/webm";
        resolve(mediaChunksRef.current.length ? new Blob(mediaChunksRef.current, { type }) : null);
        mediaRecorderRef.current = null;
        stopRecordingStream();
      }, { once: true });
      recorder.stop();
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    });
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

    if (!beginEvidenceRecording()) {
      setStarting(false);
      return;
    }

    try {
      const result = await startAttempt(selectedId, selectedClanId, selectedPlayerId);
      if (!result.ok) {
        void finishEvidenceRecording();
        setRecordEvidence(false);
        setCameraReady(false);
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
        const evidence = finishEvidenceRecording();
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
        const video = await evidence;
        if (video) {
          const extension = video.type === "video/mp4" ? "mp4" : video.type === "video/quicktime" ? "mov" : "webm";
          const formData = new FormData();
          formData.set("video", new File([video], `evidence.${extension}`, { type: video.type }));
          const upload = await uploadAttemptEvidence(result.data.id, formData);
          if (!upload.ok) setError(`Tiden er stoppet, men videoen blev ikke gemt: ${upload.error}`);
          else setActiveAttempt(upload.data);
        }
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
        setActiveAttempt(result.data);
        setStartMode(false);
        vibrate([50, 40, 50]);
      } catch {
        setError("Tiden kunne ikke godkendes. Prøv igen.");
        router.refresh();
      }
    });
  }

  function handleDecline() {
    if (!activeAttempt) return;
    setError(undefined);
    void finishEvidenceRecording();
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

  function handleScopeChange(nextClanId: string | null) {
    if (!activeAttempt || nextClanId === activeAttempt.clan_id) return;
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await changeAttemptScope(activeAttempt.id, nextClanId);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setActiveAttempt(result.data);
        setSelectedClanId(nextClanId);
        setShowScopeCorrection(false);
      } catch {
        setError("Ranglisten kunne ikke ændres. Prøv igen.");
      }
    });
  }

  if (activeAttempt?.status === "pending_review") {
    return (
      <section className="review-submitted" style={{ "--accent": category?.accent_color } as React.CSSProperties}>
        <span className="review-submitted__icon"><Check aria-hidden="true" /></span>
        <p className="eyebrow">Sendt til peer review</p>
        <h2>Tiden venter på en anden bruger</h2>
        <div className="review-submitted__time">{formatTime(activeAttempt.elapsed_ms ?? elapsed)}<small>s</small></div>
        <div className="review-submitted__identity">
          {player && <Avatar username={player.username} path={player.avatar_path} size="large" />}
          <div><strong>@{player?.username}</strong><span>{category?.name} · {clan?.name ?? "Global"}</span></div>
        </div>
        <p>En af spillerens accepterede venner kan nu bedømme tiden direkte under Venner.</p>
        <button className="button button--primary button--wide" onClick={() => {
          const query = new URLSearchParams({ kategori: activeAttempt.category_id, ny: "1" });
          if (activeAttempt.clan_id) query.set("klan", activeAttempt.clan_id);
          router.push(`/rangliste?${query.toString()}`);
          router.refresh();
        }}>Se tiden på ranglisten</button>
        <button className="button button--ghost button--wide" onClick={() => {
          setActiveAttempt(null);
          setSelectedClanId(null);
          setElapsed(0);
          setRecordEvidence(false);
          router.refresh();
        }}>Sæt en ny tid</button>
      </section>
    );
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
        <div className="attempt-player attempt-scope">
          <span className="attempt-scope__icon">{clan ? <UsersRound aria-hidden="true" /> : <Globe2 aria-hidden="true" />}</span>
          <div><span>Tiden tæller på</span><strong>{clan?.name ?? "Global"}</strong></div>
          <button className="text-button" type="button" onClick={() => setShowScopeCorrection((value) => !value)}>Forkert rangliste?</button>
        </div>
        {showScopeCorrection && (
          <div className="player-correction">
            <strong>Flyt tiden før peer review</strong>
            <div className="timer-scope-tabs">
              <button type="button" className={clsx(!activeAttempt.clan_id && "is-selected")} disabled={pending || !activeAttempt.clan_id} onClick={() => handleScopeChange(null)}><Globe2 aria-hidden="true" /> Global</button>
              {(player?.clans ?? []).map((item) => <button type="button" key={item.id} className={clsx(activeAttempt.clan_id === item.id && "is-selected")} disabled={pending || activeAttempt.clan_id === item.id} onClick={() => handleScopeChange(item.id)}><UsersRound aria-hidden="true" /> {item.name}</button>)}
            </div>
          </div>
        )}
        <div className="confirm-card">
          <span className="confirm-card__icon"><Check aria-hidden="true" /></span>
          <h2>Er øllen helt tom?</h2>
          <p>Bekræft at øllen er tom. Derefter kan en af spillerens venner godkende tiden.</p>
          {error && <p className="form-message form-message--error" role="alert">{error}</p>}
          <button className="button button--primary button--wide" onClick={handleConfirm} disabled={pending}>
            <Check aria-hidden="true" /> Ja, send til peer review
          </button>
          <details className="safe-reject">
            <summary>Øllen var ikke tom</summary>
            <p>Afvisning er flyttet væk fra godkendelsen for at undgå fejltryk.</p>
            <button className="button button--danger button--wide" onClick={() => { if (window.confirm("Afvis forsøget permanent?")) handleDecline(); }} disabled={pending}><X aria-hidden="true" /> Afvis forsøget</button>
          </details>
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
        <div className="timer-live__identity">{player && <Avatar username={player.username} path={player.avatar_path} size="medium" />}<div><span>Drikker for</span><strong>@{player?.username} · {clan?.name ?? "Global"}</strong></div></div>
        {recordEvidence && <div className="timer-camera timer-camera--live"><video ref={attachCameraPreview} autoPlay muted playsInline /><button type="button" className="timer-camera__switch" onClick={switchCamera} disabled={!cameraReady || cameraSwitching} aria-label={cameraFacingMode === "environment" ? "Skift til frontkamera" : "Skift til bagkamera"}><SwitchCamera aria-hidden="true" /></button><span><Camera aria-hidden="true" /> Video optages</span></div>}
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
        <div className="timer-start-identity">{player && <Avatar username={player.username} path={player.avatar_path} size="large" />}<div><span>Du starter for</span><strong>@{player?.username}</strong><small>{clan?.name ?? "Global"}</small></div></div>
        <p>Hold øllen klar. Tiden starter for spilleren og ranglisten ovenfor, når du rammer knappen.</p>
        {recordEvidence && <div className="timer-camera"><video ref={attachCameraPreview} autoPlay muted playsInline /><button type="button" className="timer-camera__switch" onClick={switchCamera} disabled={!cameraReady || cameraSwitching} aria-label={cameraFacingMode === "environment" ? "Skift til frontkamera" : "Skift til bagkamera"}><SwitchCamera aria-hidden="true" /></button><span><Camera aria-hidden="true" /> {cameraReady ? "Kamera klar" : "Åbner kamera..."}</span></div>}
        {cameraError && <p className="form-message form-message--error" role="alert">{cameraError}</p>}
        {error && <p className="form-message form-message--error" role="alert">{error}</p>}
        {!online && (
          <p className="offline-warning"><WifiOff aria-hidden="true" /> Forbindelsen ser ud til at være væk. Du kan stadig prøve.</p>
        )}
        <button
          className="start-trigger"
          type="button"
          onClick={handleStart}
          disabled={pending || starting || !selectedId || !selectedPlayerId || (recordEvidence && !cameraReady)}
          aria-label="Start timeren"
        >
          {player ? <Avatar username={player.username} path={player.avatar_path} size="large" /> : <Play aria-hidden="true" />}
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
          Alle tider tæller globalt. Vælger du en klan, tæller tiden også på klanens tavle.
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
              <CategoryVisual iconKey={item.icon_key} imagePath={item.image_path} name={item.name} />
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
        <div className="ready-card__identity">{player && <Avatar username={player.username} path={player.avatar_path} size="medium" />}<p><strong>@{player?.username}</strong><span>{clan?.name ?? "Global"} · {category?.name}</span></p></div>
        <p>Tjek spiller og rangliste ovenfor. Uret starter først, når serveren svarer.</p>
        <label className="timer-record-option"><input type="checkbox" checked={recordEvidence} onChange={(event) => setRecordEvidence(event.target.checked)} /><Camera aria-hidden="true" /><span><strong>Optag forsøget</strong><small>Frivillig video til peer review</small></span></label>
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
