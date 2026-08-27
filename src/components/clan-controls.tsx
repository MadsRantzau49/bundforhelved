"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Crown, LogOut, RefreshCw, Shield, Trash2, UserMinus, UserPlus } from "lucide-react";
import {
  addFriendToClanAction,
  deleteClanAction,
  leaveClanAction,
  regenerateCodeAction,
  removeClanMemberAction,
  transferClanAction,
  updateClanAction,
} from "@/actions/clans";
import { Avatar } from "@/components/avatar";
import type { ActionResult, Clan, ClanRole, Friendship, Profile } from "@/types/app";

type Member = {
  user_id: string;
  role: ClanRole;
  joined_at: string;
  profiles: Pick<Profile, "id" | "username" | "avatar_path">;
};

export function ClanControls({
  clan,
  members,
  friends,
  currentUserId,
}: {
  clan: Clan;
  members: Member[];
  friends: Friendship[];
  currentUserId: string;
}) {
  const router = useRouter();
  const membership = members.find((member) => member.user_id === currentUserId);
  const isOwner = membership?.role === "owner";
  const [message, setMessage] = useState<string>();
  const [messageIsError, setMessageIsError] = useState(false);
  const [inviteCode, setInviteCode] = useState(clan.invite_code);
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [pending, startTransition] = useTransition();
  const [detailsState, detailsAction, detailsPending] = useActionState(updateClanAction.bind(null, clan.id), {});
  const availableFriends = friends.filter((friend) => !members.some((member) => member.user_id === friend.other_user_id));

  async function copyCode() {
    if (copying || pending) return;
    const codeToCopy = inviteCode;
    setCopying(true);
    setMessage(undefined);
    try {
      let didCopy = false;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(codeToCopy);
          didCopy = true;
        } catch {
          // Plain HTTP on a shared LAN commonly blocks the Clipboard API.
        }
      }

      if (!didCopy) {
        const input = document.createElement("textarea");
        input.value = codeToCopy;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.focus();
        input.select();
        didCopy = document.execCommand("copy");
        input.remove();
      }

      if (!didCopy) throw new Error("Clipboard unavailable");
      setCopied(true);
      setMessageIsError(false);
      setMessage("Koden er kopieret.");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setMessageIsError(true);
      setMessage("Koden kunne ikke kopieres. Hold fingeren på koden og markér den manuelt.");
    } finally {
      setCopying(false);
    }
  }

  function run<T>(action: () => Promise<ActionResult<T>>, onSuccess?: (data: T) => void) {
    setMessage(undefined);
    setMessageIsError(false);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setMessageIsError(true);
          return setMessage(result.error ?? "Handlingen mislykkedes.");
        }
        onSuccess?.(result.data);
        router.refresh();
      } catch {
        setMessageIsError(true);
        setMessage("Handlingen mislykkedes. Prøv igen.");
      }
    });
  }

  return (
    <>
      <section className="invite-card">
        <div>
          <p className="eyebrow">Privat invitation</p>
          <h2>Del koden</h2>
          <p>Alle med koden kan hoppe ind i klanen.</p>
        </div>
        <button
          className="invite-code"
          type="button"
          onClick={copyCode}
          disabled={pending || copying}
          aria-label={`Kopiér invitationskode ${inviteCode}`}
        >
          <code>{inviteCode}</code>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </button>
        {isOwner && (
          <button
            className="text-button"
            type="button"
            disabled={pending || copying}
            onClick={() => run(
              () => regenerateCodeAction(clan.id),
              (newCode) => {
                setCopied(false);
                setInviteCode(newCode);
                setMessageIsError(false);
                setMessage("En ny kode er oprettet. Den gamle virker ikke længere.");
              },
            )}
          >
            <RefreshCw aria-hidden="true" /> Lav en ny kode
          </button>
        )}
      </section>

      {isOwner && (
        <section className="clan-settings panel">
          <p className="eyebrow">Klanadministration</p>
          <h2>Navn og profilbillede</h2>
          <p>Kun klanens ejer kan ændre disse oplysninger.</p>
          <form action={detailsAction}>
            <input type="hidden" name="currentImagePath" value={clan.image_path ?? ""} />
            <div className="field">
              <label htmlFor="clan-settings-name">Klannavn</label>
              <input id="clan-settings-name" name="name" defaultValue={clan.name} minLength={2} maxLength={64} required />
            </div>
            <div className="field">
              <label htmlFor="clan-image">Profilbillede</label>
              <input id="clan-image" name="image" type="file" accept="image/jpeg,image/png,image/webp" />
            </div>
            {detailsState.error && <p className="form-message form-message--error" role="alert">{detailsState.error}</p>}
            {detailsState.success && <p className="form-message form-message--success" role="status">{detailsState.success}</p>}
            <button className="button button--primary" disabled={detailsPending}>
              {detailsPending ? "Gemmer..." : "Gem ændringer"}
            </button>
          </form>
        </section>
      )}

      <section className="members-section">
        <div className="section-heading">
          <div><p className="eyebrow">Holdkortet</p><h2>{members.length} medlemmer</h2></div>
        </div>
        <div className="member-list">
          {members.map((member) => (
            <article className="member-row" key={member.user_id}>
              <Avatar username={member.profiles.username} path={member.profiles.avatar_path} size="medium" />
              <div>
                <strong>@{member.profiles.username}</strong>
                <small>{member.role === "owner" ? "Klanejer" : "Medlem"}</small>
              </div>
              {member.role === "owner" ? (
                <span className="role-badge"><Crown aria-hidden="true" /> Ejer</span>
              ) : isOwner ? (
                <div className="member-actions">
                  <button
                    className="icon-button"
                    title="Gør til ejer"
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm(`Overfør ejerskabet til @${member.profiles.username}?`)) {
                        run(() => transferClanAction(clan.id, member.user_id));
                      }
                    }}
                  >
                    <Shield aria-hidden="true" />
                  </button>
                  <button
                    className="icon-button icon-button--danger"
                    title="Fjern medlem"
                    disabled={pending}
                    onClick={() => run(() => removeClanMemberAction(clan.id, member.user_id))}
                  >
                    <UserMinus aria-hidden="true" />
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      {isOwner && (
        <section className="members-section">
          <div className="section-heading">
            <div><p className="eyebrow">Dine venner</p><h2>Tilføj til klanen</h2></div>
          </div>
          {availableFriends.length ? (
            <div className="member-list">
              {availableFriends.map((friend) => (
                <article className="member-row" key={friend.other_user_id}>
                  <Avatar username={friend.username} path={friend.avatar_path} size="medium" />
                  <div><strong>@{friend.username}</strong><small>Accepteret ven</small></div>
                  <button
                    className="button button--ghost button--small"
                    disabled={pending}
                    onClick={() => run(
                      () => addFriendToClanAction(clan.id, friend.other_user_id),
                      () => setMessage(`@${friend.username} er tilføjet til klanen.`),
                    )}
                  >
                    <UserPlus aria-hidden="true" /> Tilføj
                  </button>
                </article>
              ))}
            </div>
          ) : <div className="inline-empty">Alle dine venner er allerede med, eller du har ingen accepterede venner endnu.</div>}
        </section>
      )}

      {message && (
        <p
          className={`form-message ${messageIsError ? "form-message--error" : "form-message--success"}`}
          role={messageIsError ? "alert" : "status"}
        >
          {message}
        </p>
      )}

      <section className="danger-zone">
        <div><p className="eyebrow">Udgangen</p><h2>{isOwner ? "Administrer klanen" : "Forlad klanen"}</h2></div>
        {isOwner ? (
          <button
            className="button button--danger"
            disabled={pending}
            onClick={() => {
              if (window.confirm("Slet klanen permanent? Alle tider, der hører til klanen, bliver også slettet.")) {
                run(() => deleteClanAction(clan.id), () => router.push("/klaner"));
              }
            }}
          >
            <Trash2 aria-hidden="true" /> Slet klan
          </button>
        ) : (
          <button
            className="button button--danger"
            disabled={pending}
            onClick={() => run(() => leaveClanAction(clan.id), () => router.push("/klaner"))}
          >
            <LogOut aria-hidden="true" /> Forlad klan
          </button>
        )}
      </section>
    </>
  );
}
