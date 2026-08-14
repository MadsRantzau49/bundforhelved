"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Crown, LogOut, RefreshCw, Shield, Trash2, UserMinus } from "lucide-react";
import {
  deleteClanAction,
  leaveClanAction,
  regenerateCodeAction,
  removeClanMemberAction,
  transferClanAction,
} from "@/actions/clans";
import { Avatar } from "@/components/avatar";
import type { ActionResult, Clan, ClanRole, Profile } from "@/types/app";

type Member = {
  user_id: string;
  role: ClanRole;
  joined_at: string;
  profiles: Pick<Profile, "id" | "username" | "avatar_path">;
};

export function ClanControls({
  clan,
  members,
  currentUserId,
}: {
  clan: Clan;
  members: Member[];
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
