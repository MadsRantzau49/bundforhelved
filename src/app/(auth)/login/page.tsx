import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Log ind" };

export default function LoginPage() {
  const configured = isSupabaseConfigured();
  return (
    <div className="auth-content">
      <p className="eyebrow">Godt at se dig igen</p>
      <h1>Klar til en ny tid?</h1>
      <p className="auth-lead">Log ind. Vælg kategorien. Resten sidder i håndleddet.</p>
      {!configured && (
        <p className="form-message form-message--setup">
          Demoen mangler Supabase-nøgler. Se <code>.env.example</code>.
        </p>
      )}
      <AuthForm mode="login" />
    </div>
  );
}
