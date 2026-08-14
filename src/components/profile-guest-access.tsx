"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, RefreshCw, Smartphone, Trash2, UserRoundCheck } from "lucide-react";
import { issueGuestOtp, revokeGuestAccess } from "@/actions/guests";
import { Avatar } from "@/components/avatar";
import type { GuestAccess, GuestRequest } from "@/types/app";

export function ProfileGuestAccess({
  initialRequests,
  initialAccess,
}: {
  initialRequests: GuestRequest[];
  initialAccess: GuestAccess[];
}) {
  const router = useRouter();
  const [removedAccess, setRemovedAccess] = useState<string[]>([]);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const incoming = initialRequests.filter((request) => request.direction === "incoming");
  const outgoing = initialRequests.filter((request) => request.direction === "outgoing");
  const access = initialAccess.filter(
    (item) => !removedAccess.includes(`${item.direction}:${item.other_user_id}:${item.granted_at}`),
  );

  function showCode(requestId: string) {
    setMessage(undefined);
    startTransition(async () => {
      try {
        const result = await issueGuestOtp(requestId);
        if (!result.ok) return setMessage(result.error);
        setCodes((current) => ({ ...current, [requestId]: result.data }));
      } catch {
        setMessage("Gæstekoden kunne ikke oprettes. Prøv igen.");
      }
    });
  }

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
        <div className="guest-access-card__actions">
          <button
            className="icon-button"
            type="button"
            title="Hent nye anmodninger"
            disabled={pending}
            onClick={() => startTransition(() => router.refresh())}
          >
            <RefreshCw className={pending ? "spin" : undefined} aria-hidden="true" />
          </button>
          <Smartphone aria-hidden="true" />
        </div>
      </div>
      <p className="guest-access-card__lead">
        Godkend en anden telefon til at registrere tider som dig. Adgangen giver ikke adgang til din profil eller kode.
      </p>

      {incoming.map((request) => (
        <article className="guest-request" key={request.request_id}>
          <Avatar username={request.username} path={request.avatar_path} size="medium" />
          <div>
            <strong>@{request.username} vil tilføje dig</strong>
            <span>Vis kun koden, hvis I står ved den samme telefon.</span>
            {codes[request.request_id] && <code className="guest-otp">{codes[request.request_id]}</code>}
          </div>
          <button
            className="button button--small button--secondary"
            disabled={pending}
            onClick={() => showCode(request.request_id)}
          >
            <KeyRound aria-hidden="true" /> {codes[request.request_id] ? "Ny kode" : "Vis kode"}
          </button>
        </article>
      ))}

      {outgoing.map((request) => (
        <article className="guest-request" key={request.request_id}>
          <Avatar username={request.username} path={request.avatar_path} size="medium" />
          <div>
            <strong>Venter på @{request.username}</strong>
            <span>Brugeren skal vise koden på sin egen Mig-side.</span>
          </div>
          <span className="role-badge"><KeyRound aria-hidden="true" /> Afventer</span>
        </article>
      ))}

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

      {!incoming.length && !outgoing.length && !access.length && (
        <div className="inline-empty">Ingen gæsteanmodninger eller delte telefoner endnu.</div>
      )}
      {message && <p className="form-message form-message--error" role="alert">{message}</p>}
    </section>
  );
}
