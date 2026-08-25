import type { Metadata } from "next";
import Link from "next/link";
import {
  BarChart3,
  CalendarDays,
  Clock3,
  LogOut,
  ShieldCheck,
  TimerReset,
  Trophy,
} from "lucide-react";
import { logoutAction } from "@/actions/auth";
import { Avatar } from "@/components/avatar";
import { CategoryIcon } from "@/components/category-icon";
import { ProfileGuestAccess } from "@/components/profile-guest-access";
import { AvatarForm, InstallApp, PasswordForm, UsernameForm } from "@/components/profile-forms";
import { requireProfile } from "@/lib/auth/session";
import { formatDate, formatTime } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { GuestAccess } from "@/types/app";

export const metadata: Metadata = { title: "Profil" };

type ApprovedAttempt = {
  id: string;
  category_id: string;
  clan_id: string | null;
  elapsed_ms: number;
  confirmed_at: string;
  created_at: string;
  categories: {
    id: string;
    name: string;
    icon_key: string;
    accent_color: string;
  };
};

type Membership = {
  clan_id: string;
  clans: { id: string; name: string };
};

export default async function ProfilePage() {
  const profile = await requireProfile();
  const supabase = await createSupabaseServerClient();
  const [attemptsResult, membershipsResult, accessResult] = await Promise.all([
    supabase
      .from("attempts")
      .select("id, category_id, clan_id, elapsed_ms, confirmed_at, created_at, categories!inner(id, name, icon_key, accent_color)")
      .eq("user_id", profile.id)
      .eq("status", "approved")
      .order("confirmed_at", { ascending: false })
      .order("id", { ascending: false }),
    supabase
      .from("clan_members")
      .select("clan_id, clans!clan_members_clan_id_fkey!inner(id, name)")
      .eq("user_id", profile.id),
    supabase.rpc("list_guest_access"),
  ]);

  if (attemptsResult.error || membershipsResult.error || accessResult.error) {
    throw new Error("Profildata kunne ikke hentes.");
  }

  const attempts = (attemptsResult.data ?? []) as unknown as ApprovedAttempt[];
  const memberships = (membershipsResult.data ?? []) as unknown as Membership[];
  const guestAccess = (accessResult.data ?? []) as GuestAccess[];
  const clanNames = new Map(memberships.map((membership) => [membership.clan_id, membership.clans.name]));
  const bestByCategory = new Map<string, ApprovedAttempt>();
  const categoryStats = new Map<string, {
    category: ApprovedAttempt["categories"];
    count: number;
    total: number;
    best: number;
    latest: string;
  }>();

  for (const attempt of attempts) {
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
        latest: attempt.confirmed_at,
      });
    }
  }

  const bests = [...bestByCategory.values()].sort(
    (left, right) => left.categories.name.localeCompare(right.categories.name, "da"),
  );
  const stats = [...categoryStats.values()].sort(
    (left, right) => left.category.name.localeCompare(right.category.name, "da"),
  );
  const activeDays = new Set(attempts.map((attempt) => formatDate(attempt.confirmed_at))).size;
  const scopeName = (attempt: ApprovedAttempt) => attempt.clan_id
    ? clanNames.get(attempt.clan_id) ?? "Klan"
    : "Global";

  return (
    <div className="page page--profile">
      <section className="profile-hero">
        <div className="profile-hero__pattern" aria-hidden="true" />
        <Avatar username={profile.username} path={profile.avatar_path} size="hero" />
        <p className="eyebrow">Din spiller</p>
        <h1>@{profile.username}</h1>
        <span className="profile-role">{profile.role === "admin" ? <><ShieldCheck aria-hidden="true" /> Admin</> : "Spiller"}</span>
        <p><CalendarDays aria-hidden="true" /> Med siden {formatDate(profile.created_at)}</p>
      </section>

      <section className="stats-strip">
        <div><Trophy aria-hidden="true" /><strong>{bests.length}</strong><span>personlige rekorder</span></div>
        <div><TimerReset aria-hidden="true" /><strong>{attempts.length}</strong><span>godkendte tider</span></div>
        <div><CalendarDays aria-hidden="true" /><strong>{activeDays}</strong><span>aktive dage</span></div>
      </section>

      <section className="personal-bests">
        <div className="section-heading">
          <div><p className="eyebrow">Din hylde</p><h2>Personlige rekorder</h2></div>
          <Link href="/rangliste">Se ranglister</Link>
        </div>
        {bests.length ? (
          <div className="best-grid">
            {bests.map((attempt) => (
              <article key={attempt.category_id} style={{ "--category-color": attempt.categories.accent_color } as React.CSSProperties}>
                <CategoryIcon iconKey={attempt.categories.icon_key} />
                <span>{attempt.categories.name} · {scopeName(attempt)}</span>
                <strong>{formatTime(attempt.elapsed_ms)}<small>s</small></strong>
                <small>{formatDate(attempt.confirmed_at)}</small>
              </article>
            ))}
          </div>
        ) : (
          <div className="inline-empty">Ingen tider endnu. <Link href="/timer">Start dit første forsøg.</Link></div>
        )}
      </section>

      {stats.length > 0 && (
        <section className="personal-stats">
          <div className="section-heading">
            <div><p className="eyebrow">Tallene bag</p><h2>Din statistik</h2></div>
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

      <section className="attempt-history">
        <div className="section-heading">
          <div><p className="eyebrow">Hele historikken</p><h2>Alle dine tider</h2></div>
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
                  <small><Clock3 aria-hidden="true" /> {formatDate(attempt.confirmed_at)} · {scopeName(attempt)}</small>
                </div>
                <b>{formatTime(attempt.elapsed_ms)}<small>s</small></b>
              </article>
            ))}
          </div>
        ) : (
          <div className="inline-empty">Dine godkendte tider kommer til at stå her.</div>
        )}
      </section>

      <ProfileGuestAccess initialAccess={guestAccess} />

      <InstallApp />

      <section className="profile-settings">
        <UsernameForm username={profile.username} />
        <AvatarForm />
        <PasswordForm />
      </section>

      {profile.role === "admin" && (
        <Link href="/admin" className="admin-link-card">
          <ShieldCheck aria-hidden="true" />
          <div><strong>Administration</strong><span>Kategorier, brugere og mistænkelige tider</span></div>
        </Link>
      )}

      <form action={logoutAction}>
        <button type="submit" className="button button--ghost button--wide logout-button"><LogOut aria-hidden="true" /> Log ud</button>
      </form>
      <p className="responsible-note">Kun for 18+. Drik med omtanke.</p>
    </div>
  );
}
