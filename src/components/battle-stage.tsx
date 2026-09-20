"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Check,
  CircleStop,
  Clock3,
  Globe2,
  Hourglass,
  Inbox,
  Play,
  Search,
  Shield,
  Swords,
  Trophy,
  UsersRound,
  X,
  Zap,
} from "lucide-react";
import clsx from "clsx";
import {
  cancelBattleAction,
  createBattleAction,
  declineOwnBattleTimeAction,
  refreshBattleHub,
  reviewBattleTimeAction,
  respondBattleAction,
  startBattleAction,
  stopBattleAction,
} from "@/actions/battles";
import { Avatar } from "@/components/avatar";
import { CategoryIcon } from "@/components/category-icon";
import { CategoryVisual } from "@/components/category-visual";
import { ClanImage } from "@/components/clan-image";
import { formatDate, formatTime } from "@/lib/format";
import { rankMediaUrl } from "@/lib/rank-media";
import type { Battle, BattleClan, BattleHub, Category, Friendship } from "@/types/app";

function participant(battle: Battle, userId: string) {
  return battle.participants.find((item) => item.user_id === userId);
}

function opponentFor(battle: Battle, userId: string) {
  return battle.challenger_id === userId ? battle.opponent : battle.challenger;
}

function RankMark({ name, imagePath, large = false }: { name: string | null; imagePath: string | null; large?: boolean }) {
  const image = rankMediaUrl(imagePath);
  return (
    <span aria-label={name ?? "Uden rang"} className={clsx("battle-rank-mark", large && "battle-rank-mark--large")} style={image ? { backgroundImage: `url(${image})` } : undefined}>
      {!image && <Shield aria-hidden="true" />}
    </span>
  );
}

function confirmDecline(message: string, action: () => void) {
  if (window.confirm(message)) action();
}

function eloProjection(battle: Battle, userId: string) {
  const mine = participant(battle, userId)?.elo_before ?? 500;
  const otherId = battle.challenger_id === userId ? battle.opponent_id : battle.challenger_id;
  const other = participant(battle, otherId)?.elo_before ?? 500;
  const expected = 1 / (1 + 10 ** ((other - mine) / 400));
  const projectedLoss = Math.round(40 * (0 - expected));
  return {
    win: Math.max(1, Math.round(40 * (1 - expected))),
    loss: Math.max(-mine, Math.min(-1, projectedLoss)),
  };
}

function EloPair({ battle, userId, projections = false }: { battle: Battle; userId: string; projections?: boolean }) {
  const challenger = participant(battle, battle.challenger_id);
  const opponent = participant(battle, battle.opponent_id);
  const projected = eloProjection(battle, userId);
  return (
    <>
      <div className="battle-elo-pair" aria-label="Elo før kampen">
        <div><Avatar username={battle.challenger.username} path={battle.challenger.avatar_path} size="medium" /><span>@{battle.challenger.username}</span><strong>{challenger?.elo_before ?? "-"}</strong></div>
        <b>VS</b>
        <div><Avatar username={battle.opponent.username} path={battle.opponent.avatar_path} size="medium" /><span>@{battle.opponent.username}</span><strong>{opponent?.elo_before ?? "-"}</strong></div>
      </div>
      {projections && <div className="battle-projection"><span><Trophy aria-hidden="true" /> Sejr <strong>+{projected.win}</strong></span><span><Shield aria-hidden="true" /> Nederlag <strong>{projected.loss}</strong></span></div>}
    </>
  );
}

function MatchSettings({ battle }: { battle: Battle }) {
  return (
    <div className="battle-match-settings">
      <span><CategoryIcon iconKey={battle.category.icon_key} /> <strong>{battle.category.name}</strong><small>Våben</small></span>
      <span>{battle.clan ? <UsersRound aria-hidden="true" /> : <Globe2 aria-hidden="true" />} <strong>{battle.clan?.name ?? "Global"}</strong><small>Rangliste</small></span>
    </div>
  );
}

function ResultCard({
  battle,
  userId,
  pending,
  reviewOpponent,
  declineOwn,
}: {
  battle: Battle;
  userId: string;
  pending: boolean;
  reviewOpponent: (approve: boolean) => void;
  declineOwn: () => void;
}) {
  const mine = participant(battle, userId);
  const otherId = battle.challenger_id === userId ? battle.opponent_id : battle.challenger_id;
  const other = participant(battle, otherId);
  const opponent = opponentFor(battle, userId);
  const displayedWinner = battle.settled_at ? battle.winner_id : battle.provisional_winner_id;
  const won = displayedWinner === userId;
  const settled = Boolean(battle.settled_at);
  const opponentNeedsReview = other?.attempt?.status === "pending_review";
  const ownOfficial = mine?.attempt?.status === "approved";
  const ownDeclined = mine?.attempt?.status === "declined" || mine?.attempt?.status === "invalidated";
  const rankChanged = mine?.rank_before_name !== mine?.rank_after_name;
  return (
    <article className={clsx("battle-result", won && "is-win", settled && !won && "is-loss")}>
      <div className="battle-result__headline">
        <span>{won ? <Trophy aria-hidden="true" /> : <Shield aria-hidden="true" />}</span>
        <div><p className="eyebrow">mod @{opponent.username}</p><h2>{ownDeclined && !settled ? "TID AFVIST" : settled && !displayedWinner ? "INGEN VINDER" : won ? "DU VANDT" : "DU TABTE"}</h2></div>
      </div>
      <div className="battle-result__times">
        <span>Din tid <strong>{mine?.elapsed_ms == null ? "-" : `${formatTime(mine.elapsed_ms)}s`}</strong></span>
        <span>@{opponent.username} <strong>{other?.elapsed_ms == null ? "Drikker..." : `${formatTime(other.elapsed_ms)}s`}</strong></span>
      </div>
      {mine?.elo_after != null && (
        <div className="battle-result__rating">
          <RankMark name={mine.rank_after_name ?? mine.rank_before_name} imagePath={mine.rank_after_image_path ?? mine.rank_before_image_path} />
          <span><small>{rankChanged ? `${mine.rank_before_name} → ${mine.rank_after_name}` : mine.rank_after_name}</small><strong>{mine.elo_before} → {mine.elo_after}</strong></span>
          <b className={clsx((mine.elo_change ?? 0) >= 0 && "is-positive")}>{(mine.elo_change ?? 0) >= 0 ? "+" : ""}{mine.elo_change}</b>
        </div>
      )}
      <div className="battle-result__official">
        <span className={ownOfficial ? "is-approved" : ownDeclined ? "is-declined" : "is-pending"}>{ownOfficial ? <><BadgeCheck aria-hidden="true" /> Din tid er officiel</> : ownDeclined ? <><X aria-hidden="true" /> Din tid er afvist</> : <><Hourglass aria-hidden="true" /> Din tid venter på godkendelse</>}</span>
          {mine?.attempt?.status === "pending_review" && <button className="button button--danger" disabled={pending} onClick={() => confirmDecline("Er du sikker på, at du vil afvise din egen tid? Det kan ikke fortrydes.", declineOwn)}><X aria-hidden="true" /> Afvis min egen tid</button>}
          {opponentNeedsReview && <div className="battle-result__review-actions"><button className="button button--primary" disabled={pending} onClick={() => reviewOpponent(true)}><BadgeCheck aria-hidden="true" /> Godkend @{opponent.username}</button><button className="button button--danger" disabled={pending} onClick={() => confirmDecline(`Er du sikker på, at du vil afvise @${opponent.username}s tid? Det kan ikke fortrydes.`, () => reviewOpponent(false))}><X aria-hidden="true" /> Afvis tiden</button></div>}
        {!opponentNeedsReview && other?.attempt && <span className="is-approved"><Check aria-hidden="true" /> Modstanderens tid er behandlet</span>}
      </div>
    </article>
  );
}

function ReviewTasks({
  matches,
  userId,
  pending,
  review,
  declineOwn,
}: {
  matches: Battle[];
  userId: string;
  pending: boolean;
  review: (battleId: string, approve: boolean) => void;
  declineOwn: (battleId: string) => void;
}) {
  if (!matches.length) return null;
  return (
    <section className="battle-review-tasks">
      <div className="battle-review-tasks__title"><BadgeCheck aria-hidden="true" /><strong>TIDER DER MANGLER SVAR</strong></div>
      {matches.map((battle) => {
        const mine = participant(battle, userId);
        const otherId = battle.challenger_id === userId ? battle.opponent_id : battle.challenger_id;
        const other = participant(battle, otherId);
        const opponent = opponentFor(battle, userId);
        return (
          <article key={battle.id}>
            <Avatar username={opponent.username} path={opponent.avatar_path} size="small" />
            <div><strong>@{opponent.username}</strong><span>{mine?.elapsed_ms == null ? "-" : `${formatTime(mine.elapsed_ms)}s`} / {other?.elapsed_ms == null ? "drikker" : `${formatTime(other.elapsed_ms)}s`}</span></div>
            {other?.attempt?.status === "pending_review" && <div className="battle-review-tasks__actions"><button className="icon-button battle-inbox__accept" title="Godkend tid" disabled={pending} onClick={() => review(battle.id, true)}><Check aria-hidden="true" /></button><button className="icon-button icon-button--danger" title="Afvis tid" disabled={pending} onClick={() => confirmDecline(`Er du sikker på, at du vil afvise @${opponent.username}s tid? Det kan ikke fortrydes.`, () => review(battle.id, false))}><X aria-hidden="true" /></button></div>}
            {mine?.attempt?.status === "pending_review" && <button className="text-button battle-review-tasks__self" disabled={pending} onClick={() => confirmDecline("Er du sikker på, at du vil afvise din egen tid? Det kan ikke fortrydes.", () => declineOwn(battle.id))}>Afvis min tid</button>}
          </article>
        );
      })}
    </section>
  );
}

function InvitationList({
  invitations,
  pending,
  respond,
}: {
  invitations: Battle[];
  pending: boolean;
  respond: (battleId: string, accept: boolean) => void;
}) {
  if (!invitations.length) return null;
  return (
    <section className="battle-inbox">
      <div className="battle-inbox__title"><Inbox aria-hidden="true" /><strong>{invitations.length} {invitations.length === 1 ? "udfordring" : "udfordringer"}</strong></div>
      <div className="battle-inbox__list">
        {invitations.map((battle) => (
          <article key={battle.id}>
            <Avatar username={battle.challenger.username} path={battle.challenger.avatar_path} size="medium" />
            <div><strong>@{battle.challenger.username}</strong><span><CategoryIcon iconKey={battle.category.icon_key} /> {battle.category.name} · {battle.clan?.name ?? "Global"}</span></div>
            <button className="icon-button battle-inbox__accept" aria-label={`Acceptér udfordring fra ${battle.challenger.username}`} disabled={pending} onClick={() => respond(battle.id, true)}><Check aria-hidden="true" /></button>
            <button className="icon-button icon-button--danger" aria-label={`Afvis udfordring fra ${battle.challenger.username}`} disabled={pending} onClick={() => respond(battle.id, false)}><X aria-hidden="true" /></button>
          </article>
        ))}
      </div>
    </section>
  );
}

export function BattleStage({
  userId,
  categories,
  friends,
  clans,
  initialHub,
}: {
  userId: string;
  categories: Category[];
  friends: Friendship[];
  clans: BattleClan[];
  initialHub: BattleHub;
}) {
  const [hub, setHub] = useState(initialHub);
  const [showCreate, setShowCreate] = useState(false);
  const [opponentQuery, setOpponentQuery] = useState("");
  const [selectedFriend, setSelectedFriend] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(categories[0]?.id ?? "");
  const [selectedClan, setSelectedClan] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [freshResultId, setFreshResultId] = useState<string | null>(null);
  const [freshResultUntil, setFreshResultUntil] = useState(0);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const polling = useRef(false);
  const battle = hub.current;
  const battleStatus = battle?.status;
  const mine = battle ? participant(battle, userId) : undefined;
  const startsAt = battle?.starts_at ? new Date(battle.starts_at).getTime() : null;
  const countdown = Boolean(battle && startsAt && now < startsAt);
  const greenFlash = Boolean(battle && startsAt && now >= startsAt && now < startsAt + 600 && !mine?.finished_at);
  const running = Boolean(battle && startsAt && now >= startsAt && !mine?.finished_at);
  const elapsed = startsAt ? Math.max(0, now - startsAt) : 0;
  const sharedClans = clans.filter((clan) => clan.member_ids.includes(selectedFriend));
  const resultBattle = freshResultId && now < freshResultUntil
    ? [...hub.review_matches, ...hub.history].find((item) => item.id === freshResultId) ?? null
    : null;
  const normalizedQuery = opponentQuery.trim().toLocaleLowerCase("da");
  const searchResults = normalizedQuery
    ? friends.filter((friend) => friend.username.toLocaleLowerCase("da").includes(normalizedQuery)).slice(0, 6)
    : [];
  const recentOpponentIds = hub.history
    .filter((item) => item.status === "completed")
    .map((item) => item.challenger_id === userId ? item.opponent_id : item.challenger_id);
  const suggestions = [...friends]
    .sort((left, right) => {
      const leftIndex = recentOpponentIds.indexOf(left.other_user_id);
      const rightIndex = recentOpponentIds.indexOf(right.other_user_id);
      return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex);
    })
    .slice(0, 3);
  const selectedOpponent = friends.find((friend) => friend.other_user_id === selectedFriend);

  useEffect(() => {
    if (!startsAt || !battle || !["countdown", "active", "completed"].includes(battle.status)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 32);
    return () => window.clearInterval(timer);
  }, [battle, startsAt]);

  useEffect(() => {
    const refresh = async () => {
      if (polling.current || document.visibilityState === "hidden") return;
      polling.current = true;
      try {
        const result = await refreshBattleHub();
        if (result.ok) setHub(result.data);
      } finally {
        polling.current = false;
      }
    };
    const timer = window.setInterval(refresh, battleStatus && ["countdown", "active", "completed"].includes(battleStatus) ? 500 : 1_200);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("pageshow", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [battleStatus]);

  useEffect(() => {
    if (!freshResultUntil) return;
    const timeout = window.setTimeout(() => setFreshResultId(null), Math.max(0, freshResultUntil - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [freshResultUntil]);

  function run(
    action: () => Promise<{ ok: true; data: BattleHub } | { ok: false; error: string }>,
    onSuccess?: (nextHub: BattleHub) => void,
  ) {
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.ok) {
          setHub(result.data);
          onSuccess?.(result.data);
        } else setError(result.error);
      } catch {
        setError("Forbindelsen røg. Prøv igen.");
      }
    });
  }

  const selectOpponent = (friend: Friendship) => {
    setSelectedFriend(friend.other_user_id);
    setOpponentQuery(friend.username);
    setSelectedClan(null);
  };

  if (countdown && battle) {
    return (
      <div className="battle-signal battle-signal--red" aria-label="Vent på grønt">
        <div className="battle-signal__grid" />
        <span className="battle-signal__ring battle-signal__ring--one" />
        <span className="battle-signal__ring battle-signal__ring--two" />
        <div className="battle-signal__versus">
          <Avatar username={battle.challenger.username} path={battle.challenger.avatar_path} size="large" />
          <span><Swords aria-hidden="true" /><strong>HOLD</strong></span>
          <Avatar username={battle.opponent.username} path={battle.opponent.avatar_path} size="large" />
        </div>
        <div className="battle-signal__meter"><i /></div>
      </div>
    );
  }
  if (greenFlash) return <div className="battle-signal battle-signal--green" aria-label="Start nu"><Zap aria-hidden="true" /><strong>DRIK!</strong></div>;

  if (running && battle) {
    const opponentFinished = Boolean(battle.provisional_winner_id && battle.provisional_winner_id !== userId);
    return (
      <div className={clsx("battle-live", opponentFinished && "battle-live--lost")} style={{ "--accent": battle.category.accent_color } as React.CSSProperties}>
        <button className="battle-live__surface" disabled={pending} onClick={() => run(() => stopBattleAction(battle.id), () => { setFreshResultId(battle.id); setFreshResultUntil(Date.now() + 90_000); })} aria-label="Stop din tid" />
        <div className="battle-live__content">
          <span className="battle-live__status"><i /> {opponentFinished ? "Modstanderen er færdig" : "1v1 i gang"}</span>
          <div className="timer-display">{formatTime(elapsed)}<small>SEKUNDER</small></div>
          <div className="stop-button"><CircleStop aria-hidden="true" /><span>{pending ? "STOPPER" : "STOP"}</span><small>Tryk hvor som helst</small></div>
          <span className="battle-live__opponent">mod @{opponentFor(battle, userId).username}</span>
        </div>
      </div>
    );
  }

  if (battle?.status === "ready") {
    const challenger = battle.challenger_id === userId;
    return (
      <section className="battle-lobby">
        <span className="battle-lobby__ready"><Check aria-hidden="true" /></span>
        <h1>KLAR TIL KAMP</h1>
        <EloPair battle={battle} userId={userId} projections />
        <MatchSettings battle={battle} />
        {error && <p className="form-message form-message--error">{error}</p>}
        {challenger ? (
          <button className="button button--start battle-lobby__start" disabled={pending} onClick={() => run(() => startBattleAction(battle.id))}><Play aria-hidden="true" /><span>{pending ? "STARTER..." : "START UDFORDRING"}</span></button>
        ) : (
          <div className="battle-lobby__waiting"><span className="spin"><Clock3 aria-hidden="true" /></span><strong>@{battle.challenger.username} starter kampen</strong></div>
        )}
        <button className="text-button" disabled={pending} onClick={() => run(() => cancelBattleAction(battle.id))}><X aria-hidden="true" /> Forlad kamp</button>
      </section>
    );
  }

  if (battle?.status === "pending") {
    return (
      <>
        {!hub.has_active_timer && <InvitationList invitations={hub.invitations} pending={pending} respond={(id, accept) => run(() => respondBattleAction(id, accept))} />}
        <section className="battle-lobby battle-lobby--pending">
          <span className="battle-lobby__ready"><Clock3 aria-hidden="true" /></span>
          <h1>UDFORDRING SENDT</h1>
          <EloPair battle={battle} userId={userId} />
          <MatchSettings battle={battle} />
          <div className="battle-lobby__waiting"><span className="spin"><Clock3 aria-hidden="true" /></span><strong>Venter på @{battle.opponent.username}</strong></div>
          {error && <p className="form-message form-message--error">{error}</p>}
          <button className="text-button" disabled={pending} onClick={() => run(() => cancelBattleAction(battle.id))}><X aria-hidden="true" /> Annuller</button>
        </section>
      </>
    );
  }

  return (
    <>
      {!hub.has_active_timer && <InvitationList invitations={hub.invitations} pending={pending} respond={(id, accept) => run(() => respondBattleAction(id, accept))} />}
      {resultBattle && <ResultCard battle={resultBattle} userId={userId} pending={pending} reviewOpponent={(approve) => run(() => reviewBattleTimeAction(resultBattle.id, approve))} declineOwn={() => run(() => declineOwnBattleTimeAction(resultBattle.id))} />}

      <section className="battle-home-card">
        {hub.standing && <RankMark name={hub.standing.rank_name} imagePath={hub.standing.rank_image_path} large />}
        <div><span>DIN 1V1-RANG</span><h1>{hub.standing?.rank_name ?? "Uden rang"}</h1><strong>{hub.standing?.elo ?? "-"}<small>ELO</small></strong></div>
        <dl><div><dt>V</dt><dd>{hub.standing?.wins ?? 0}</dd></div><div><dt>T</dt><dd>{hub.standing?.losses ?? 0}</dd></div><div><dt>U</dt><dd>{hub.standing?.draws ?? 0}</dd></div></dl>
        <button className="button button--start" disabled={hub.has_active_timer} onClick={() => setShowCreate(true)}><Swords aria-hidden="true" /><span>{hub.has_active_timer ? "AFSLUT DIN TIMER FØRST" : "NY 1V1"}</span></button>
      </section>

      <ReviewTasks matches={hub.review_matches.filter((item) => item.id !== resultBattle?.id)} userId={userId} pending={pending} review={(id, approve) => run(() => reviewBattleTimeAction(id, approve))} declineOwn={(id) => run(() => declineOwnBattleTimeAction(id))} />

      {showCreate && (
        <section className="battle-create">
          <button className="battle-create__back" aria-label="Luk" onClick={() => setShowCreate(false)}><ArrowLeft aria-hidden="true" /></button>
          <h2>NY 1V1</h2>
          {friends.length && categories.length ? (
            <>
              <div className="battle-opponent-search">
                <label htmlFor="battle-opponent"><Search aria-hidden="true" /><input id="battle-opponent" value={opponentQuery} onChange={(event) => { setOpponentQuery(event.target.value); setSelectedFriend(""); setSelectedClan(null); }} placeholder="Søg efter en ven..." autoComplete="off" /></label>
                {searchResults.length > 0 && <div className="battle-opponent-search__results">{searchResults.map((friend) => <button key={friend.other_user_id} onClick={() => selectOpponent(friend)}><Avatar username={friend.username} path={friend.avatar_path} size="small" /><strong>@{friend.username}</strong><Play aria-hidden="true" /></button>)}</div>}
              </div>
              {!normalizedQuery && <div className="battle-suggestions"><span>Foreslåede modstandere</span>{suggestions.map((friend) => <button key={friend.other_user_id} className={clsx(selectedFriend === friend.other_user_id && "is-selected")} onClick={() => selectOpponent(friend)}><Avatar username={friend.username} path={friend.avatar_path} size="medium" /><strong>@{friend.username}</strong></button>)}</div>}
              {selectedOpponent && <div className="battle-selected-opponent"><Check aria-hidden="true" /><Avatar username={selectedOpponent.username} path={selectedOpponent.avatar_path} size="small" /><strong>@{selectedOpponent.username}</strong></div>}

              <div className="battle-field"><strong>Vælg våben</strong><div className="category-grid">{categories.map((category) => <button key={category.id} className={clsx("category-card", selectedCategory === category.id && "is-selected")} style={{ "--category-color": category.accent_color } as React.CSSProperties} onClick={() => setSelectedCategory(category.id)}><CategoryVisual iconKey={category.icon_key} imagePath={category.image_path} name={category.name} /><strong>{category.name}</strong>{selectedCategory === category.id && <span className="category-card__check"><Check aria-hidden="true" /></span>}</button>)}</div></div>
              <div className="battle-field"><strong>Vælg rangliste</strong><div className="battle-scopes"><button className={clsx(selectedClan === null && "is-selected")} onClick={() => setSelectedClan(null)}><Globe2 aria-hidden="true" /><span><strong>Global</strong></span></button>{sharedClans.map((clan) => <button key={clan.id} className={clsx(selectedClan === clan.id && "is-selected")} onClick={() => setSelectedClan(clan.id)}><ClanImage name={clan.name} path={clan.image_path} /><span><strong>{clan.name}</strong></span></button>)}</div></div>
              {error && <p className="form-message form-message--error">{error}</p>}
              <button className="button button--start" disabled={pending || !selectedFriend || !selectedCategory} onClick={() => run(() => createBattleAction(selectedCategory, selectedClan, selectedFriend), () => setShowCreate(false))}><Swords aria-hidden="true" /><span>{pending ? "SENDER..." : "SEND UDFORDRING"}</span></button>
            </>
          ) : <div className="inline-empty">Tilføj en ven for at starte en 1v1.</div>}
        </section>
      )}

      {hub.history.some((item) => item.status === "completed") && (
        <section className="battle-history"><div className="section-heading"><h2>SENESTE KAMPE</h2></div>{hub.history.filter((item) => item.status === "completed").slice(0, 5).map((item) => {
          const own = participant(item, userId);
          const foe = opponentFor(item, userId);
          return <article key={item.id}><Avatar username={foe.username} path={foe.avatar_path} size="small" /><div><strong>@{foe.username}</strong><small>{item.category.name} · {formatDate(item.completed_at ?? item.created_at)}</small></div><b>{item.winner_id ? item.winner_id === userId ? "V" : "T" : "-"}</b><span>{own?.elo_change != null ? `${own.elo_change >= 0 ? "+" : ""}${own.elo_change}` : "-"}</span></article>;
        })}</section>
      )}
    </>
  );
}
