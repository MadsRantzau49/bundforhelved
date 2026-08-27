import Link from "next/link";
import {
  Award,
  Ban,
  BarChart3,
  Beer,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Flame,
  Hourglass,
  Medal,
  ShieldCheck,
  Sparkles,
  TimerReset,
  Trophy,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { CategoryIcon } from "@/components/category-icon";
import { achievementMediaUrl } from "@/lib/achievement-media";
import { attemptDateKey, calculateAchievements } from "@/lib/achievements";
import { formatDate, formatTime } from "@/lib/format";
import type { AchievementAsset, Profile, ProfileAttempt } from "@/types/app";

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function ActivityHeatmap({ attempts }: { attempts: ProfileAttempt[] }) {
  const today = attemptDateKey({ created_at: new Date().toISOString() });
  const firstDay = addDays(today, -364);
  const firstWeekday = (new Date(`${firstDay}T12:00:00Z`).getUTCDay() + 6) % 7;
  const counts = new Map<string, number>();
  for (const attempt of attempts) {
    const day = attemptDateKey(attempt);
    if (day >= firstDay && day <= today) counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const cells: Array<{ day: string; count: number } | null> = Array(firstWeekday).fill(null);
  for (let offset = 0; offset < 365; offset += 1) {
    const day = addDays(firstDay, offset);
    cells.push({ day, count: counts.get(day) ?? 0 });
  }
  while (cells.length % 7) cells.push(null);

  const level = (count: number) => count >= 10 ? 5 : count >= 7 ? 4 : count >= 5 ? 3 : count >= 3 ? 2 : count > 0 ? 1 : 0;

  return (
    <section className="activity-card">
      <div className="section-heading">
        <div><p className="eyebrow">De seneste 365 dage</p><h2>Aktivitetsåret</h2></div>
        <Flame aria-hidden="true" />
      </div>
      <p className="activity-card__lead">Jo mørkere grøn, jo flere godkendte tider. Guld betyder 10 eller flere på samme dag.</p>
      <div className="activity-heatmap">
        <div className="activity-heatmap__weekdays" aria-hidden="true"><span>Man</span><span>Tir</span><span>Ons</span><span>Tor</span><span>Fre</span><span>Lør</span><span>Søn</span></div>
        <div className="activity-heatmap__scroll">
          <div className="activity-heatmap__grid">
            {cells.map((cell, index) => cell ? (
              <span
                key={cell.day}
                className={`activity-day activity-day--${level(cell.count)}`}
                title={`${formatDate(`${cell.day}T12:00:00Z`)}: ${cell.count} godkendte tider`}
                aria-label={`${formatDate(`${cell.day}T12:00:00Z`)}: ${cell.count} godkendte tider`}
              />
            ) : <span className="activity-day activity-day--empty" aria-hidden="true" key={`empty-${index}`} />)}
          </div>
        </div>
      </div>
      <div className="activity-legend"><span>Mindre</span>{[0, 1, 2, 3, 4, 5].map((item) => <i className={`activity-day activity-day--${item}`} key={item} />)}<span>Mere</span></div>
    </section>
  );
}

export function ProfileOverview({
  profile,
  attempts,
  achievementAssets = [],
  activeCategoryIds = [],
  own = false,
}: {
  profile: Profile;
  attempts: ProfileAttempt[];
  achievementAssets?: AchievementAsset[];
  activeCategoryIds?: string[];
  own?: boolean;
}) {
  const approvedAttempts = attempts.filter((attempt) => attempt.status === "approved");
  const bestByCategory = new Map<string, ProfileAttempt>();
  const categoryStats = new Map<string, {
    category: ProfileAttempt["categories"];
    count: number;
    total: number;
    best: number;
    latest: string;
  }>();

  for (const attempt of approvedAttempts) {
    const currentBest = bestByCategory.get(attempt.category_id);
    if (!currentBest || attempt.elapsed_ms < currentBest.elapsed_ms) {
      bestByCategory.set(attempt.category_id, attempt);
    }

    const currentStats = categoryStats.get(attempt.category_id);
    if (currentStats) {
      currentStats.count += 1;
      currentStats.total += attempt.elapsed_ms;
      currentStats.best = Math.min(currentStats.best, attempt.elapsed_ms);
    } else {
      categoryStats.set(attempt.category_id, {
        category: attempt.categories,
        count: 1,
        total: attempt.elapsed_ms,
        best: attempt.elapsed_ms,
        latest: attempt.confirmed_at ?? attempt.created_at,
      });
    }
  }

  const bests = [...bestByCategory.values()].sort(
    (left, right) => left.categories.name.localeCompare(right.categories.name, "da"),
  );
  const stats = [...categoryStats.values()].sort(
    (left, right) => left.category.name.localeCompare(right.category.name, "da"),
  );
  const activeDays = new Set(
    approvedAttempts.map(attemptDateKey),
  ).size;
  const achievements = calculateAchievements(attempts, activeCategoryIds);
  const unlockedAchievements = achievements.filter((achievement) => achievement.unlocked).length;
  const artwork = new Map(achievementAssets.map((asset) => [asset.achievement_key, asset.image_path]));
  const dailyCounts = new Map<string, number>();
  for (const attempt of approvedAttempts) {
    const day = attemptDateKey(attempt);
    dailyCounts.set(day, (dailyCounts.get(day) ?? 0) + 1);
  }
  const peakDay = [...dailyCounts].sort((left, right) => right[1] - left[1] || right[0].localeCompare(left[0]))[0];
  const favorite = [...categoryStats.values()].sort((left, right) => right.count - left.count)[0];
  const fastest = approvedAttempts.length ? Math.min(...approvedAttempts.map((attempt) => attempt.elapsed_ms)) : null;
  const longestStreak = achievements.find((achievement) => achievement.metric === "streak")?.current ?? 0;
  const scopeName = (attempt: ProfileAttempt) => attempt.scope_name
    ?? (attempt.clan_id ? "Klan" : "Global");

  return (
    <>
      <section className="profile-hero">
        <div className="profile-hero__pattern" aria-hidden="true" />
        <Avatar username={profile.username} path={profile.avatar_path} size="hero" />
        <p className="eyebrow">{own ? "Din spiller" : "Venneprofil"}</p>
        <h1>@{profile.username}</h1>
        <span className="profile-role">{profile.role === "admin" ? <><ShieldCheck aria-hidden="true" /> Admin</> : "Spiller"}</span>
        <p><CalendarDays aria-hidden="true" /> Med siden {formatDate(profile.created_at)}</p>
      </section>

      <section className="stats-strip">
        <div><Trophy aria-hidden="true" /><strong>{bests.length}</strong><span>personlige rekorder</span></div>
        <div><TimerReset aria-hidden="true" /><strong>{approvedAttempts.length}</strong><span>bekræftede tider</span></div>
        <div><CalendarDays aria-hidden="true" /><strong>{activeDays}</strong><span>aktive dage</span></div>
      </section>

      <ActivityHeatmap attempts={approvedAttempts} />

      <section className="fun-stats">
        <article><Flame aria-hidden="true" /><span>Længste stime</span><strong>{longestStreak}<small> dage</small></strong></article>
        <article><Beer aria-hidden="true" /><span>Mest aktive dag</span><strong>{peakDay?.[1] ?? 0}<small> tider</small></strong><em>{peakDay ? formatDate(`${peakDay[0]}T12:00:00Z`) : "Ikke endnu"}</em></article>
        <article><Sparkles aria-hidden="true" /><span>Favoritkategori</span><strong>{favorite?.category.name ?? "-"}</strong><em>{favorite ? `${favorite.count} tider` : "Ingen favorit endnu"}</em></article>
        <article><TimerReset aria-hidden="true" /><span>Hurtigste tid</span><strong>{fastest === null ? "-" : `${formatTime(fastest)}s`}</strong></article>
      </section>

      <section className="personal-bests">
        <div className="section-heading">
          <div><p className="eyebrow">{own ? "Din hylde" : "Rekordhylden"}</p><h2>Personlige rekorder</h2></div>
          <Link href="/rangliste">Se ranglister</Link>
        </div>
        {bests.length ? (
          <div className="best-grid">
            {bests.map((attempt) => (
              <article key={attempt.category_id} style={{ "--category-color": attempt.categories.accent_color } as React.CSSProperties}>
                <CategoryIcon iconKey={attempt.categories.icon_key} />
                <span>{attempt.categories.name} · {scopeName(attempt)}</span>
                <strong>{formatTime(attempt.elapsed_ms)}<small>s</small></strong>
                <small>{formatDate(attempt.confirmed_at ?? attempt.created_at)}</small>
              </article>
            ))}
          </div>
        ) : (
          <div className="inline-empty">Ingen godkendte tider endnu.{own && <> <Link href="/timer">Start dit første forsøg.</Link></>}</div>
        )}
      </section>

      {stats.length > 0 && (
        <section className="personal-stats">
          <div className="section-heading">
            <div><p className="eyebrow">Tallene bag</p><h2>{own ? "Din statistik" : "Statistik"}</h2></div>
            <BarChart3 aria-hidden="true" />
          </div>
          <div className="personal-stats__grid">
            {stats.map((item) => (
              <article key={item.category.id} style={{ "--category-color": item.category.accent_color } as React.CSSProperties}>
                <div><CategoryIcon iconKey={item.category.icon_key} /><strong>{item.category.name}</strong></div>
                <dl>
                  <div><dt>Forsøg</dt><dd>{item.count}</dd></div>
                  <div><dt>Bedste</dt><dd>{formatTime(item.best)}s</dd></div>
                  <div><dt>Gennemsnit</dt><dd>{formatTime(Math.round(item.total / item.count))}s</dd></div>
                  <div><dt>Senest aktiv</dt><dd>{formatDate(item.latest)}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="achievements-section">
        <div className="section-heading">
          <div><p className="eyebrow">Skabet med blær</p><h2>Bedrifter</h2></div>
          <span>{unlockedAchievements} / {achievements.length} låst op</span>
        </div>
        <div className="achievement-grid">
          {achievements.map((achievement) => {
            const imageUrl = achievementMediaUrl(artwork.get(achievement.key) ?? null);
            const percentage = Math.min(100, Math.round((achievement.current / achievement.target) * 100));
            return (
              <article className={`achievement-card achievement-card--${achievement.rarity}${achievement.unlocked ? " is-unlocked" : ""}`} key={achievement.key}>
                <div className="achievement-card__badge" style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}>
                  {!imageUrl && (achievement.unlocked ? <Award aria-hidden="true" /> : <Medal aria-hidden="true" />)}
                </div>
                <div className="achievement-card__copy">
                  <div><strong>{achievement.title}</strong><span>{achievement.unlocked ? "Opnået" : `${percentage}%`}</span></div>
                  <p>{achievement.description}</p>
                  <div className="achievement-progress" role="progressbar" aria-label={`Fremskridt for ${achievement.title}`} aria-valuemin={0} aria-valuemax={achievement.target} aria-valuenow={Math.min(achievement.current, achievement.target)}><i style={{ width: `${percentage}%` }} /></div>
                  <small>{achievement.current.toLocaleString("da-DK")} / {achievement.target.toLocaleString("da-DK")}</small>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="attempt-history">
        <div className="section-heading">
          <div><p className="eyebrow">Hele historikken</p><h2>{own ? "Alle dine tider" : "Alle tider"}</h2></div>
          <span>{attempts.length} i alt</span>
        </div>
        {attempts.length ? (
          <div className="attempt-history__list">
            {attempts.map((attempt) => (
              <article key={attempt.id}>
                <span
                  className="attempt-history__icon"
                  style={{ "--category-color": attempt.categories.accent_color } as React.CSSProperties}
                >
                  <CategoryIcon iconKey={attempt.categories.icon_key} />
                </span>
                <div>
                  <strong>{attempt.categories.name}</strong>
                  <small><Clock3 aria-hidden="true" /> {formatDate(attempt.confirmed_at ?? attempt.submitted_for_review_at ?? attempt.created_at)} · {scopeName(attempt)}</small>
                  <span className={`profile-attempt-status profile-attempt-status--${attempt.status}`}>
                    {attempt.status === "approved" ? <><CheckCircle2 aria-hidden="true" /> Bekræftet{attempt.reviewer && ` af @${attempt.reviewer.username}`}</> : attempt.status === "pending_review" ? <><Hourglass aria-hidden="true" /> Afventer en ven</> : <><Ban aria-hidden="true" /> Ugyldig</>}
                  </span>
                </div>
                <b>{formatTime(attempt.elapsed_ms)}<small>s</small></b>
              </article>
            ))}
          </div>
        ) : (
          <div className="inline-empty">Ingen tider endnu.</div>
        )}
      </section>
    </>
  );
}
