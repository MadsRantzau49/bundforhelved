import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, TimerReset, Trophy } from "lucide-react";
import { ClanImage } from "@/components/clan-image";
import { ClanControls } from "@/components/clan-controls";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Clan, ClanRole, Friendship, Profile } from "@/types/app";

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
  const [clanResult, membersResult, friendsResult] = await Promise.all([
    supabase.from("clans").select("id, name, image_path, invite_code, created_by, created_at").eq("id", id).maybeSingle(),
    supabase
      .from("clan_members")
      .select("user_id, role, joined_at, profiles!inner(id, username, avatar_path)")
      .eq("clan_id", id)
      .order("role", { ascending: true })
      .order("joined_at"),
    supabase.rpc("list_friendships"),
  ]);

  if (clanResult.error || membersResult.error || friendsResult.error) throw new Error("Klanen kunne ikke hentes.");
  if (!clanResult.data) notFound();
  const clan = clanResult.data as Clan;
  const members = (membersResult.data ?? []) as unknown as Member[];
  const friends = ((friendsResult.data ?? []) as Friendship[]).filter((friend) => friend.direction === "friend");

  return (
    <div className="page page--clan-detail">
      <Link href="/klaner" className="back-link"><ArrowLeft aria-hidden="true" /> Alle klaner</Link>
      <PageHeader
        eyebrow="Privat hjemmebane"
        title={clan.name}
        description="Kun forsøg, der startes for denne klan, tæller på klanens tavle."
        action={<ClanImage name={clan.name} path={clan.image_path} className="header-clan clan-image--header" />}
      />
      <div className="clan-quick-actions">
        <Link href={`/timer?klan=${clan.id}`} className="button button--primary"><TimerReset aria-hidden="true" /> Tag en klantid</Link>
        <Link href={`/rangliste?klan=${clan.id}`} className="button button--ghost"><Trophy aria-hidden="true" /> Se tavlen</Link>
      </div>
      <ClanControls clan={clan} members={members} friends={friends} currentUserId={profile.id} />
    </div>
  );
}
