"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock3, Handshake, Search, Trash2, UserPlus, X } from "lucide-react";
import {
  removeFriendAction,
  respondFriendRequestAction,
  sendFriendRequestAction,
} from "@/actions/friends";
import { Avatar } from "@/components/avatar";
import type { Friendship } from "@/types/app";

type Message = { text: string; error: boolean };

export function FriendManager({ relationships }: { relationships: Friendship[] }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState<Message>();
  const [pendingId, setPendingId] = useState<string>();
  const [pending, startTransition] = useTransition();
  const friends = relationships.filter((item) => item.direction === "friend");
  const incoming = relationships.filter((item) => item.direction === "incoming");
  const outgoing = relationships.filter((item) => item.direction === "outgoing");

  function run(
    id: string,
    action: () => Promise<{ ok: boolean; error?: string }>,
    success: string,
    onSuccess?: () => void,
  ) {
    setMessage(undefined);
    setPendingId(id);
    startTransition(async () => {
      try {
        const result = await action();
        setMessage({ text: result.ok ? success : result.error ?? "Handlingen mislykkedes.", error: !result.ok });
        if (result.ok) {
          onSuccess?.();
          router.refresh();
        }
      } catch {
        setMessage({ text: "Forbindelsen røg. Prøv igen.", error: true });
      } finally {
        setPendingId(undefined);
      }
    });
  }

  function sendRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = username;
    run("new", () => sendFriendRequestAction(target), `Venneanmodningen til @${target.trim()} er sendt.`, () => setUsername(""));
  }

  return (
    <div className="friend-manager">
      {message && (
        <p className={message.error ? "form-message form-message--error" : "form-message form-message--success"} role={message.error ? "alert" : "status"}>
          {message.text}
        </p>
      )}

      <section className="friend-add-card">
        <span className="friend-add-card__icon"><UserPlus aria-hidden="true" /></span>
        <div>
          <p className="eyebrow">Find en spiller</p>
          <h2>Tilføj en ven</h2>
          <p>Skriv brugerens præcise brugernavn. Personen skal acceptere, før I bliver venner.</p>
        </div>
        <form onSubmit={sendRequest}>
          <label htmlFor="friend-username">Brugernavn</label>
          <div className="input-wrap">
            <Search aria-hidden="true" />
            <input
              id="friend-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              minLength={1}
              maxLength={64}
              autoCapitalize="none"
              autoComplete="off"
              placeholder="brugernavn"
              required
            />
          </div>
          <button className="button button--primary" disabled={pending || !username.trim()}>
            <UserPlus aria-hidden="true" /> {pendingId === "new" ? "Sender..." : "Send anmodning"}
          </button>
        </form>
      </section>

      {incoming.length > 0 && (
        <section className="friend-section friend-section--incoming">
          <div className="section-heading"><div><p className="eyebrow">Venter på dig</p><h2>Anmodninger</h2></div><span>{incoming.length}</span></div>
          <div className="friend-list">
            {incoming.map((item) => (
              <article className="friend-row" key={item.friendship_id}>
                <Avatar username={item.username} path={item.avatar_path} size="medium" />
                <div><strong>@{item.username}</strong><span>Vil gerne være venner</span></div>
                <div className="friend-row__actions">
                  <button className="icon-button friend-accept" title={`Acceptér @${item.username}`} disabled={pending} onClick={() => run(item.friendship_id, () => respondFriendRequestAction(item.friendship_id, true), `Du og @${item.username} er nu venner.`)}><Check aria-hidden="true" /></button>
                  <button className="icon-button icon-button--danger" title={`Afvis @${item.username}`} disabled={pending} onClick={() => run(item.friendship_id, () => respondFriendRequestAction(item.friendship_id, false), "Venneanmodningen er afvist.")}><X aria-hidden="true" /></button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="friend-section">
        <div className="section-heading"><div><p className="eyebrow">Jeres egen top</p><h2>Dine venner</h2></div><span>{friends.length}</span></div>
        {friends.length ? (
          <div className="friend-list">
            {friends.map((item) => (
              <article className="friend-row" key={item.friendship_id}>
                <Avatar username={item.username} path={item.avatar_path} size="medium" />
                <div><strong>@{item.username}</strong><span><Handshake aria-hidden="true" /> Ven og peer reviewer</span></div>
                <button
                  className="icon-button icon-button--danger"
                  title={`Fjern @${item.username} som ven`}
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm(`Fjern @${item.username} som ven?`)) {
                      run(item.friendship_id, () => removeFriendAction(item.friendship_id), `@${item.username} er fjernet som ven.`);
                    }
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </article>
            ))}
          </div>
        ) : <div className="inline-empty">Du har ingen venner endnu. Send den første anmodning ovenfor.</div>}
      </section>

      {outgoing.length > 0 && (
        <section className="friend-section friend-section--outgoing">
          <div className="section-heading"><div><p className="eyebrow">Sendt</p><h2>Afventer svar</h2></div><span>{outgoing.length}</span></div>
          <div className="friend-list">
            {outgoing.map((item) => (
              <article className="friend-row" key={item.friendship_id}>
                <Avatar username={item.username} path={item.avatar_path} size="medium" />
                <div><strong>@{item.username}</strong><span><Clock3 aria-hidden="true" /> Anmodning sendt</span></div>
                <button className="icon-button icon-button--danger" title="Annuller anmodning" disabled={pending} onClick={() => run(item.friendship_id, () => removeFriendAction(item.friendship_id), "Venneanmodningen er annulleret.")}><X aria-hidden="true" /></button>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
