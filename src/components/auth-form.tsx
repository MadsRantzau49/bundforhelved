"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Eye, EyeOff, LockKeyhole, UserRound } from "lucide-react";
import { loginAction, signupAction } from "@/actions/auth";
import { FormMessage, SubmitButton } from "@/components/form-controls";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const action = mode === "login" ? loginAction : signupAction;
  const [state, formAction] = useActionState(action, {});
  const [showPassword, setShowPassword] = useState(false);
  const signup = mode === "signup";

  return (
    <form action={formAction} className="auth-form">
      <div className="field">
        <label htmlFor="username">Brugernavn</label>
        <div className="input-wrap">
          <UserRound aria-hidden="true" />
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            minLength={3}
            maxLength={24}
            pattern="[a-z0-9_]{3,24}"
            placeholder="f.eks. ol_kongen"
            required
          />
        </div>
        {signup && <small>3-24 små bogstaver, tal eller underscore.</small>}
      </div>

      <div className="field">
        <label htmlFor="password">Adgangskode</label>
        <div className="input-wrap">
          <LockKeyhole aria-hidden="true" />
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete={signup ? "new-password" : "current-password"}
            maxLength={64}
            placeholder={signup ? "Ja, 123 er tilladt" : "Din adgangskode"}
            required
          />
          <button
            type="button"
            className="input-action"
            onClick={() => setShowPassword((current) => !current)}
            aria-label={showPassword ? "Skjul adgangskode" : "Vis adgangskode"}
          >
            {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </button>
        </div>
        {signup && <small>Ingen styrkekrav. Vælg noget, du kan huske.</small>}
      </div>

      <FormMessage error={state.error} />
      <SubmitButton className="button--primary button--wide" pendingLabel={signup ? "Opretter..." : "Åbner..."}>
        {signup ? "Opret bruger" : "Log ind"}
      </SubmitButton>

      <p className="auth-switch">
        {signup ? "Har du allerede en bruger?" : "Ny i baren?"}{" "}
        <Link href={signup ? "/login" : "/opret"}>{signup ? "Log ind" : "Opret bruger"}</Link>
      </p>
    </form>
  );
}
