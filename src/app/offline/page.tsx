import { WifiOff } from "lucide-react";
import { Brand } from "@/components/brand";

export default function OfflinePage() {
  return (
    <main className="setup-page">
      <Brand link={false} />
      <section className="setup-card">
        <span className="setup-card__icon"><WifiOff aria-hidden="true" /></span>
        <p className="eyebrow">Forbindelsen røg</p>
        <h1>Uret venter</h1>
        <p>Timer og ranglister kræver internet, fordi alle tider bliver målt på serveren.</p>
        <a href="/timer" className="button button--primary button--wide">Prøv igen</a>
      </section>
    </main>
  );
}
