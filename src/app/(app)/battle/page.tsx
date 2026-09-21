import type { Metadata } from "next";
import { BattleStage } from "@/components/battle-stage";
import { requireProfile } from "@/lib/auth/session";
import { loadBattleHub } from "@/lib/battles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { BattleClan, BattleRank, Category, Friendship } from "@/types/app";

export const metadata: Metadata = { title: "1v1" };
export const dynamic = "force-dynamic";

type MembershipRow = {
  clans: {
    id: string;
    name: string;
    image_path: string | null;
    clan_members: { user_id: string }[];
  };
};

export default async function BattlePage() {
  const profile = await requireProfile();
  const supabase = await createSupabaseServerClient();
  const [categoriesResult, friendshipsResult, membershipsResult, ranksResult, hub] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name, icon_key, accent_color, description, image_path, guide_text, guide_video_path, demo_video_path, battle_elo_factor, sort_order, is_active")
      .eq("is_active", true)
      .order("sort_order"),
    supabase.rpc("list_friendships"),
    supabase
      .from("clan_members")
      .select("clans!clan_members_clan_id_fkey!inner(id, name, image_path, clan_members!clan_members_clan_id_fkey(user_id))")
      .eq("user_id", profile.id),
    supabase.from("battle_ranks").select("id, name, image_path, min_elo, max_elo, sort_order").order("min_elo"),
    loadBattleHub(profile.id),
  ]);
  if (categoriesResult.error || friendshipsResult.error || membershipsResult.error || ranksResult.error) {
    throw new Error("1v1-data kunne ikke hentes.");
  }

  const friends = ((friendshipsResult.data ?? []) as Friendship[]).filter((friend) => friend.direction === "friend");
  const clans = ((membershipsResult.data ?? []) as unknown as MembershipRow[]).map(({ clans: clan }): BattleClan => ({
    id: clan.id,
    name: clan.name,
    image_path: clan.image_path,
    member_ids: clan.clan_members.map((member) => member.user_id),
  }));

  return (
    <div className="page page--battle">
      <BattleStage
        userId={profile.id}
        categories={(categoriesResult.data ?? []) as Category[]}
        friends={friends}
        clans={clans}
        battleRanks={(ranksResult.data ?? []) as BattleRank[]}
        initialHub={hub}
      />
    </div>
  );
}
