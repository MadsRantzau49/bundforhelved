import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, TimerReset, Trophy, UsersRound } from "lucide-react";
import { ClanControls } from "@/components/clan-controls";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Clan, ClanRole, Profile } from "@/types/app";

export const metadata: Metadata = { title: "Klan" };

type Member = {
  user_id: string;
  role: ClanRole;
  joined_at: string;
  profiles: Pick<Profile, "id" | "username" | "avatar_path">;
};

export default async function ClanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createSupabaseServerClient();
  const [clanResult, membersResult] = await Promise.all([
    supabase.from("clans").select("id, name, invite_code, created_by, created_at").eq("id", id).maybeSingle(),
    supabase
      .from("clan_members")
      .select("user_id, role, joined_at, profiles!inner(id, username, avatar_path)")
      .eq("clan_id", id)
      .order("role", { ascending: true })
      .order("joined_at"),
  ]);

  if (clanResult.error || membersResult.error) throw new Error("Klanen kunne ikke hentes.");
  if (!clanResult.data) notFound();
  const clan = clanResult.data as Clan;
  const members = (membersResult.data ?? []) as unknown as Member[];

  return (
    <div className="page page--clan-detail">
      <Link href="/klaner" className="back-link"><ArrowLeft aria-hidden="true" /> Alle klaner</Link>
      <PageHeader
        eyebrow="Privat hjemmebane"
        title={clan.name}
        description="Kun forsøg, der startes for denne klan, tæller på klanens tavle."
        action={<span className="header-clan"><UsersRound aria-hidden="true" /></span>}
      />
      <div className="clan-quick-actions">
        <Link href={`/timer?klan=${clan.id}`} className="button button--primary"><TimerReset aria-hidden="true" /> Tag en klantid</Link>
        <Link href={`/rangliste?klan=${clan.id}`} className="button button--ghost"><Trophy aria-hidden="true" /> Se tavlen</Link>
      </div>
      <ClanControls clan={clan} members={members} currentUserId={profile.id} />
    </div>
  );
}
