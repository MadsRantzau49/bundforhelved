import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Crown, UsersRound } from "lucide-react";
import { ClanForms } from "@/components/clan-forms";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ClanMembership } from "@/types/app";

export const metadata: Metadata = { title: "Klaner" };

export default async function ClansPage() {
  const profile = await requireProfile();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("clan_members")
    .select("clan_id, user_id, role, joined_at, clans!clan_members_clan_id_fkey!inner(id, name, created_by, created_at)")
    .eq("user_id", profile.id)
    .order("joined_at");
  if (error) throw new Error("Klanerne kunne ikke hentes.");
  const memberships = (data ?? []) as unknown as ClanMembership[];

  return (
    <div className="page page--clans">
      <PageHeader
        eyebrow="Venner, rivaler, familie"
        title="Dine klaner"
        description="Globale tider og klantider holdes adskilt, så hvert arrangement får sin egen tavle."
        action={<span className="header-clan"><UsersRound aria-hidden="true" /></span>}
      />

      {memberships.length > 0 && (
        <section className="clan-list-section">
          <div className="section-heading">
            <div><p className="eyebrow">Dine hjemmebaner</p><h2>{memberships.length} klaner</h2></div>
          </div>
          <div className="clan-list">
            {memberships.map((membership, index) => (
              <Link href={`/klaner/${membership.clan_id}`} className="clan-card" key={membership.clan_id}>
                <span className="clan-card__crest">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{membership.clans.name}</strong>
                  <small>{membership.role === "owner" ? <><Crown aria-hidden="true" /> Du er ejer</> : "Privat rangliste"}</small>
                </div>
                <ChevronRight aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {memberships.length === 0 && (
        <section className="empty-state empty-state--compact">
          <span className="empty-state__mark"><UsersRound aria-hidden="true" /></span>
          <h2>Ingen klan endnu</h2>
          <p>Opret en til vennerne, eller brug en kode for at hoppe ind.</p>
        </section>
      )}

      <ClanForms />
    </div>
  );
}
