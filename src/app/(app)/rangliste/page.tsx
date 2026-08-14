import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Crown, Globe2, Medal, Sparkles, Trophy, UsersRound } from "lucide-react";
import clsx from "clsx";
import { Avatar } from "@/components/avatar";
import { CategoryIcon } from "@/components/category-icon";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth/session";
import { formatTime } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Category, ClanMembership, LeaderboardEntry } from "@/types/app";

export const metadata: Metadata = { title: "Rangliste" };

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ kategori?: string; klan?: string; ny?: string }>;
}) {
  const params = await searchParams;
  const profile = await requireProfile();
  const supabase = await createSupabaseServerClient();
  const [categoriesResult, membershipsResult] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name, icon_key, accent_color, description, sort_order, is_active")
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("clan_members")
      .select("clan_id, user_id, role, joined_at, clans!clan_members_clan_id_fkey!inner(id, name, created_by, created_at)")
      .eq("user_id", profile.id)
      .order("joined_at"),
  ]);

  if (categoriesResult.error || membershipsResult.error) {
    throw new Error("Ranglisten kunne ikke hentes.");
  }

  const categories = (categoriesResult.data ?? []) as Category[];
  const memberships = (membershipsResult.data ?? []) as unknown as ClanMembership[];
  if (params.kategori && !categories.some((item) => item.id === params.kategori)) {
    redirect(params.ny === "1" ? "/profil" : "/rangliste");
  }
  const category = categories.find((item) => item.id === params.kategori) ?? categories[0];
  const selectedMembership = memberships.find((item) => item.clan_id === params.klan);
  if (params.klan && !selectedMembership) notFound();
  const clanId = selectedMembership?.clan_id ?? null;

  let entries: LeaderboardEntry[] = [];
  if (category) {
    const { data, error } = await supabase.rpc("get_leaderboard", {
      category: category.id,
      clan: clanId,
    });
    if (error) throw new Error("Ranglisten kunne ikke hentes.");
    entries = (data ?? []) as LeaderboardEntry[];
  }

  const currentEntry = entries.find((entry) => entry.user_id === profile.id);
  const hrefFor = (categoryId: string, selectedClan = clanId) => {
    const query = new URLSearchParams({ kategori: categoryId });
    if (selectedClan) query.set("klan", selectedClan);
    return `/rangliste?${query.toString()}`;
  };

  return (
    <div className="page page--leaderboard">
      <PageHeader
        eyebrow="De hurtigste hænder"
        title="Toppen"
        description="Kun den bedste godkendte tid fra hver spiller på den valgte tavle tæller."
        action={<span className="header-trophy"><Trophy aria-hidden="true" /></span>}
      />

      {params.ny === "1" && (
        <div className="success-banner"><Sparkles aria-hidden="true" /> Tiden er godkendt og med på tavlen.</div>
      )}

      <div className="scope-tabs" aria-label="Vælg rangliste">
        <Link href={hrefFor(category?.id ?? "", null)} className={clsx(!clanId && "is-active")} aria-current={!clanId ? "page" : undefined}>
          <Globe2 aria-hidden="true" /> Global
        </Link>
        {memberships.map((membership) => (
          <Link
            key={membership.clan_id}
            href={hrefFor(category?.id ?? "", membership.clan_id)}
            className={clsx(clanId === membership.clan_id && "is-active")}
            aria-current={clanId === membership.clan_id ? "page" : undefined}
          >
            <UsersRound aria-hidden="true" /> {membership.clans.name}
          </Link>
        ))}
      </div>

      <div className="category-tabs" aria-label="Vælg kategori">
        {categories.map((item) => (
          <Link
            key={item.id}
            href={hrefFor(item.id)}
            className={clsx(category?.id === item.id && "is-active")}
            aria-current={category?.id === item.id ? "page" : undefined}
            style={{ "--category-color": item.accent_color } as React.CSSProperties}
          >
            <CategoryIcon iconKey={item.icon_key} /> {item.name}
          </Link>
        ))}
      </div>

      {!category || entries.length === 0 ? (
        <section className="empty-state empty-state--board">
          <span className="empty-state__mark"><Trophy aria-hidden="true" /></span>
          <h2>Tavlen venter</h2>
          <p>Den første godkendte tid tager automatisk førstepladsen.</p>
          <Link href={clanId ? `/timer?klan=${clanId}` : "/timer"} className="button button--primary">Sæt den første tid</Link>
        </section>
      ) : (
        <>
          <section className="podium" aria-label="Top tre">
            {[entries[1], entries[0], entries[2]].map((entry, visualIndex) => {
              if (!entry) return <div key={`empty-${visualIndex}`} className="podium__empty" />;
              const place = entry.rank;
              return (
                <article key={entry.user_id} className={clsx("podium__place", `podium__place--${place}`)}>
                  {place === 1 && <Crown className="podium__crown" aria-hidden="true" />}
                  <Avatar username={entry.username} path={entry.avatar_path} size={place === 1 ? "hero" : "large"} rank={place} />
                  <span className="podium__rank">{place}</span>
                  <strong>@{entry.username}</strong>
                  <b>{formatTime(entry.elapsed_ms)}<small>s</small></b>
                  <div className="podium__block"><span>{place}</span></div>
                </article>
              );
            })}
          </section>

          <section className="leaderboard-section">
            <div className="section-heading">
              <div><p className="eyebrow">Hele feltet</p><h2>Placeringer</h2></div>
              <span>{entries.length} spillere</span>
            </div>
            <div className="leaderboard-list">
              {entries.map((entry) => (
                <article
                  key={entry.user_id}
                  className={clsx("leaderboard-row", entry.user_id === profile.id && "is-current")}
                >
                  <span className="leaderboard-row__rank">
                    {entry.rank <= 3 ? <Medal aria-hidden="true" /> : entry.rank}
                  </span>
                  <Avatar username={entry.username} path={entry.avatar_path} size="medium" />
                  <div className="leaderboard-row__person">
                    <strong>@{entry.username}</strong>
                    <small>{entry.user_id === profile.id ? "Det er dig" : clanId ? "Klanmedlem" : "Global spiller"}</small>
                  </div>
                  <b>{formatTime(entry.elapsed_ms)}<small>s</small></b>
                </article>
              ))}
            </div>
          </section>
        </>
      )}

      {currentEntry && (
        <div className="own-rank">
          <span>Din placering</span>
          <strong>#{currentEntry.rank}</strong>
          <b>{formatTime(currentEntry.elapsed_ms)}s</b>
        </div>
      )}
    </div>
  );
}
