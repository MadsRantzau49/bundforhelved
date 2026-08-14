"use client";

import { useState, useTransition } from "react";
import { KeyRound, UserPlus } from "lucide-react";
import { redeemGuestAccess, requestGuestAccess } from "@/actions/guests";
import type { GuestRequestStart, TimerPlayer } from "@/types/app";

export function GuestConnectForm({
  onConnected,
  onCancel,
}: {
  onConnected: (player: TimerPlayer) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const [username, setUsername] = useState("");
  const [otp, setOtp] = useState("");
  const [request, setRequest] = useState<GuestRequestStart>();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function sendRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await requestGuestAccess(username);
        if (!result.ok) return setError(result.error);
        setRequest(result.data);
      } catch {
        setError("Anmodningen kunne ikke sendes. Prøv igen.");
      }
    });
  }

  function redeem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!request) return;
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await redeemGuestAccess(request.request_id, otp);
        if (!result.ok) return setError(result.error);
        await onConnected(result.data);
      } catch {
        setError("Koden kunne ikke godkendes. Opdater siden og prøv igen.");
      }
    });
  }

  if (request) {
    return (
      <form className="guest-connect" onSubmit={redeem}>
        <div className="guest-connect__title">
          <KeyRound aria-hidden="true" />
          <div>
            <strong>Kode fra @{request.username}</strong>
            <span>Bed brugeren åbne Mig og trykke “Vis kode”.</span>
          </div>
        </div>
        <div className="field">
          <label htmlFor="guest-otp">Engangskode</label>
          <input
            id="guest-otp"
            value={otp}
            onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            placeholder="000000"
            required
          />
        </div>
        {error && <p className="form-message form-message--error" role="alert">{error}</p>}
        <div className="guest-connect__actions">
          <button className="button button--small button--primary" disabled={pending || otp.length !== 6}>
            {pending ? "Godkender..." : "Tilføj gæst"}
          </button>
          <button className="text-button" type="button" disabled={pending} onClick={() => setRequest(undefined)}>
            Skift bruger
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className="guest-connect" onSubmit={sendRequest}>
      <div className="guest-connect__title">
        <UserPlus aria-hidden="true" />
        <div>
          <strong>Tilføj gæst</strong>
          <span>Brugeren godkender telefonen med en kode under Mig.</span>
        </div>
      </div>
      <div className="field">
        <label htmlFor="guest-username">Brugernavn</label>
        <input
          id="guest-username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          placeholder="brugernavn"
          required
        />
      </div>
      {error && <p className="form-message form-message--error" role="alert">{error}</p>}
      <div className="guest-connect__actions">
        <button className="button button--small button--primary" disabled={pending}>
          {pending ? "Sender..." : "Send kode"}
        </button>
        {onCancel && (
          <button className="text-button" type="button" disabled={pending} onClick={onCancel}>
            Annuller
          </button>
        )}
      </div>
    </form>
  );
}
