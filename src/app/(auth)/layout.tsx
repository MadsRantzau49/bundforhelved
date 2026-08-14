import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { getSessionProfile } from "@/lib/auth/session";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const profile = await getSessionProfile();
  if (profile) redirect("/timer");

  return (
    <main className="auth-page">
      <div className="auth-page__bubbles" aria-hidden="true">
        <i /><i /><i /><i /><i />
      </div>
      <section className="auth-panel">
        <Brand link={false} />
        {children}
        <p className="responsible-note">Kun for 18+. Drik med omtanke.</p>
      </section>
      <aside className="auth-art" aria-hidden="true">
        <div className="auth-art__copy">
          <span>01</span>
          <p>Vælg dit våben</p>
          <span>02</span>
          <p>Start uret</p>
          <span>03</span>
          <p>Tag toppen</p>
        </div>
        <div className="hero-can"><span>BUND</span><small>0.0 sek</small></div>
      </aside>
    </main>
  );
}
