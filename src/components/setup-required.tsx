import { Cable, Database, KeyRound } from "lucide-react";
import { Brand } from "@/components/brand";

export function SetupRequired() {
  return (
    <main className="setup-page">
      <Brand link={false} />
      <section className="setup-card">
        <span className="setup-card__icon"><Cable aria-hidden="true" /></span>
        <p className="eyebrow">Et sidste stik</p>
        <h1>Forbind Supabase</h1>
        <p>Appen er bygget. Tilføj projektets nøgler, og kør migrationen for at åbne hanen.</p>
        <div className="setup-step"><Database aria-hidden="true" /><span>Kør SQL-filen i <code>supabase/migrations</code>.</span></div>
        <div className="setup-step"><KeyRound aria-hidden="true" /><span>Udfyld værdierne fra <code>.env.example</code>.</span></div>
      </section>
    </main>
  );
}
