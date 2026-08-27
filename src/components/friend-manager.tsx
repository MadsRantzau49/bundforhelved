"use client";

import Link from "next/link";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Check, Clock3, Handshake, Search, Trash2, UserPlus, UsersRound, X } from "lucide-react";
import {
  pingFriendForReviewAction,
  removeFriendAction,
  respondFriendRequestAction,
  searchFriendProfilesAction,
  sendFriendRequestAction,
} from "@/actions/friends";
import { Avatar } from "@/components/avatar";
import type { FriendRecommendation, FriendSearchResult, Friendship } from "@/types/app";

type Message = { text: string; error: boolean };

const relationshipLabel: Record<Exclude<FriendSearchResult["relationship"], null>, string> = {
  friend: "Allerede venner",
  incoming: "Har sendt dig en anmodning",
  outgoing: "Anmodning sendt",
};

export function FriendManager({
  relationships,
  recommendations,
  pingableFriendIds,
}: {
  relationships: Friendship[];
  recommendations: FriendRecommendation[];
  pingableFriendIds: string[];
}) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string>();
  const [suggestions, setSuggestions] = useState<FriendSearchResult[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<Message>();
  const [pendingId, setPendingId] = useState<string>();
  const [pending, startTransition] = useTransition();
  const friends = relationships.filter((item) => item.direction === "friend");
  const incoming = relationships.filter((item) => item.direction === "incoming");
  const outgoing = relationships.filter((item) => item.direction === "outgoing");

  useEffect(() => {
    const prefix = username.trim();
    if (!prefix || !searchOpen) return;

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      const result = await searchFriendProfilesAction(prefix);
      if (cancelled) return;
      setSuggestions(result.ok ? result.data : []);
      setActiveSuggestion(-1);
      setSearching(false);
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [searchOpen, username]);

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

  function request(usernameValue: string, expectedUserId?: string) {
    const target = usernameValue.trim();
    run(
      `request-${target}`,
      () => sendFriendRequestAction(target, expectedUserId),
      `Venneanmodningen til @${target} er sendt.`,
      () => {
        setUsername("");
        setSelectedUserId(undefined);
        setSuggestions([]);
        setSearchOpen(false);
      },
    );
  }

  function sendRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    request(username, selectedUserId);
  }

  function selectSuggestion(suggestion: FriendSearchResult) {
    setUsername(suggestion.username);
    setSelectedUserId(suggestion.user_id);
    setSearchOpen(false);
    setSearching(false);
    setActiveSuggestion(-1);
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
          <p>Søg fra starten af brugernavnet. Du får højst 10 forslag.</p>
        </div>
        <form onSubmit={sendRequest}>
          <label htmlFor="friend-username">Brugernavn</label>
          <div className="friend-search">
            <div className="input-wrap">
              <Search aria-hidden="true" />
              <input
                id="friend-username"
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  setSelectedUserId(undefined);
                  setSuggestions([]);
                  setActiveSuggestion(-1);
                  setSearching(Boolean(event.target.value.trim()));
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                onBlur={() => window.setTimeout(() => setSearchOpen(false), 120)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setSearchOpen(false);
                    setActiveSuggestion(-1);
                    return;
                  }
                  if (!suggestions.length || !searchOpen) return;
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActiveSuggestion((current) => Math.min(current + 1, suggestions.length - 1));
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveSuggestion((current) => Math.max(current - 1, 0));
                  } else if (event.key === "Enter" && activeSuggestion >= 0) {
                    event.preventDefault();
                    selectSuggestion(suggestions[activeSuggestion]);
                  }
                }}
                minLength={1}
                maxLength={64}
                autoCapitalize="none"
                autoComplete="off"
                placeholder="Skriv fx m for Mads"
                role="combobox"
                aria-autocomplete="list"
                aria-controls="friend-search-results"
                aria-expanded={searchOpen && (searching || suggestions.length > 0)}
                aria-activedescendant={activeSuggestion >= 0 ? `friend-suggestion-${suggestions[activeSuggestion]?.user_id}` : undefined}
                required
              />
            </div>
            {searchOpen && username.trim() && (searching || suggestions.length > 0) && (
              <div className="friend-search__results" id="friend-search-results" role="listbox">
                {searching ? <span className="friend-search__loading">Søger...</span> : suggestions.map((suggestion) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={activeSuggestion === suggestions.indexOf(suggestion)}
                    id={`friend-suggestion-${suggestion.user_id}`}
                    key={suggestion.user_id}
                    onClick={() => selectSuggestion(suggestion)}
                  >
                    <Avatar username={suggestion.username} path={suggestion.avatar_path} size="small" />
                    <span><strong>@{suggestion.username}</strong><small>{suggestion.relationship ? relationshipLabel[suggestion.relationship] : "Kan tilføjes"}</small></span>
                    {!suggestion.relationship && <UserPlus aria-hidden="true" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="button button--primary" disabled={pending || !username.trim()}>
            <UserPlus aria-hidden="true" /> {pendingId?.startsWith("request-") ? "Sender..." : "Send anmodning"}
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

      {recommendations.length > 0 && (
        <section className="friend-section friend-section--recommended">
          <div className="section-heading"><div><p className="eyebrow">Venner af venner</p><h2>Foreslåede venner</h2></div><UsersRound aria-hidden="true" /></div>
          <div className="friend-list">
            {recommendations.map((item) => (
              <article className="friend-row" key={item.user_id}>
                <Avatar username={item.username} path={item.avatar_path} size="medium" />
                <div>
                  <strong>@{item.username}</strong>
                  <span>{item.mutual_friend_count === 1 ? `Ven med @${item.mutual_usernames[0]}` : `${item.mutual_friend_count} fælles venner`}</span>
                </div>
                <button className="icon-button friend-accept" title={`Tilføj @${item.username}`} disabled={pending} onClick={() => request(item.username, item.user_id)}><UserPlus aria-hidden="true" /></button>
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
                <Link href={`/venner/${item.other_user_id}`} aria-label={`Se profil for @${item.username}`}><Avatar username={item.username} path={item.avatar_path} size="medium" /></Link>
                <div><Link href={`/venner/${item.other_user_id}`}><strong>@{item.username}</strong></Link><span><Handshake aria-hidden="true" /> Ven og peer reviewer</span></div>
                <div className="friend-row__actions">
                  {pingableFriendIds.includes(item.other_user_id) && (
                    <button
                      className="icon-button friend-ping"
                      title={`Ping @${item.username} om peer review`}
                      disabled={pending}
                      onClick={() => run(`ping-${item.other_user_id}`, () => pingFriendForReviewAction(item.other_user_id), `@${item.username} har fået et ping.`)}
                    >
                      <BellRing aria-hidden="true" />
                    </button>
                  )}
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
                </div>
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
