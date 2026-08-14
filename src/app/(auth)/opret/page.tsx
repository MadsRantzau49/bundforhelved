import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Opret bruger" };

export default function SignupPage() {
  return (
    <div className="auth-content">
      <p className="eyebrow">Få dit navn på tavlen</p>
      <h1>Opret din spiller</h1>
      <p className="auth-lead">Ingen mail. Intet bøvl. Bare et navn og en kode, du kan huske.</p>
      <AuthForm mode="signup" />
    </div>
  );
}
