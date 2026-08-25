"use client";

import { useState, useTransition } from "react";
import { KeyRound, UserPlus } from "lucide-react";
import { connectGuestAccess } from "@/actions/guests";
import type { TimerPlayer } from "@/types/app";

export function GuestConnectForm({
  onConnected,
  onCancel,
}: {
  onConnected: (player: TimerPlayer) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function connect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await connectGuestAccess(username, password);
        if (!result.ok) return setError(result.error);
        await onConnected(result.data);
      } catch {
        setError("Gæsten kunne ikke tilføjes. Prøv igen.");
      }
    });
  }

  return (
    <form className="guest-connect" onSubmit={connect}>
      <div className="guest-connect__title">
        <UserPlus aria-hidden="true" />
        <div>
          <strong>Tilføj gæst</strong>
          <span>Log ind med gæstens brugernavn og adgangskode.</span>
        </div>
      </div>
      <div className="field">
        <label htmlFor="guest-username">Brugernavn</label>
        <input
          id="guest-username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoCorrect="off"
          placeholder="brugernavn"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="guest-password">Adgangskode</label>
        <div className="input-wrap">
          <KeyRound aria-hidden="true" />
          <input
            id="guest-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="off"
            maxLength={64}
            required
          />
        </div>
      </div>
      {error && <p className="form-message form-message--error" role="alert">{error}</p>}
      <div className="guest-connect__actions">
        <button className="button button--small button--primary" disabled={pending}>
          {pending ? "Logger ind..." : "Tilføj gæst"}
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
