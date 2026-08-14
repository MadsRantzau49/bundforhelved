import Link from "next/link";
import { BeerOff } from "lucide-react";
import { Brand } from "@/components/brand";

export default function NotFound() {
  return (
    <main className="setup-page">
      <Brand link={false} />
      <section className="setup-card">
        <span className="setup-card__icon"><BeerOff aria-hidden="true" /></span>
        <p className="eyebrow">404</p>
        <h1>Glasset er væk</h1>
        <p>Siden findes ikke længere, eller også har du ikke adgang til den.</p>
        <Link href="/timer" className="button button--primary button--wide">Tilbage til timeren</Link>
      </section>
    </main>
  );
}
