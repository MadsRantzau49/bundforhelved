"use client";

import { useState, useTransition } from "react";
import { Smartphone, Trash2, UserRoundCheck } from "lucide-react";
import { revokeGuestAccess } from "@/actions/guests";
import { Avatar } from "@/components/avatar";
import type { GuestAccess } from "@/types/app";

export function ProfileGuestAccess({
  initialAccess,
}: {
  initialAccess: GuestAccess[];
}) {
  const [removedAccess, setRemovedAccess] = useState<string[]>([]);
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const access = initialAccess.filter(
    (item) => !removedAccess.includes(`${item.direction}:${item.other_user_id}:${item.granted_at}`),
  );

  function revoke(item: GuestAccess) {
    setMessage(undefined);
    startTransition(async () => {
      try {
        const result = await revokeGuestAccess(item.other_user_id, item.direction);
        if (!result.ok) return setMessage(result.error);
        setRemovedAccess((current) => [
          ...current,
          `${item.direction}:${item.other_user_id}:${item.granted_at}`,
        ]);
      } catch {
        setMessage("Gæsteadgangen kunne ikke fjernes. Prøv igen.");
      }
    });
  }

  return (
    <section className="guest-access-card">
      <div className="section-heading">
        <div><p className="eyebrow">Delt telefon</p><h2>Gæsteadgang</h2></div>
        <Smartphone aria-hidden="true" />
      </div>
      <p className="guest-access-card__lead">
        Se og fjern telefoner, der kan registrere tider for andre brugere.
      </p>

      {access.length > 0 && (
        <div className="guest-access-list">
          {access.map((item) => (
            <article key={`${item.direction}-${item.other_user_id}`}>
              <Avatar username={item.username} path={item.avatar_path} size="medium" />
              <div>
                <strong>@{item.username}</strong>
                <span>
                  {item.direction === "guest"
                    ? "Du kan registrere tider som denne gæst"
                    : "Denne bruger kan registrere tider som dig"}
                </span>
              </div>
              <button
                className="icon-button icon-button--danger"
                title="Fjern gæsteadgang"
                disabled={pending}
                onClick={() => revoke(item)}
              >
                {item.direction === "guest" ? <Trash2 aria-hidden="true" /> : <UserRoundCheck aria-hidden="true" />}
              </button>
            </article>
          ))}
        </div>
      )}

      {!access.length && (
        <div className="inline-empty">Ingen gæstebrugere eller delte telefoner endnu.</div>
      )}
      {message && <p className="form-message form-message--error" role="alert">{message}</p>}
    </section>
  );
}
