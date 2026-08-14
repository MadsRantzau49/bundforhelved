"use client";

import { RotateCw, TriangleAlert } from "lucide-react";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="empty-state app-error">
      <span className="empty-state__mark"><TriangleAlert aria-hidden="true" /></span>
      <h2>Hanen driller</h2>
      <p>Data kunne ikke hentes lige nu. Tjek forbindelsen, og prøv igen.</p>
      <button className="button button--primary" onClick={reset}><RotateCw aria-hidden="true" /> Prøv igen</button>
    </section>
  );
}
