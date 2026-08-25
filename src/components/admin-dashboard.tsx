"use client";

import { useActionState, useState, useTransition } from "react";
import {
  Ban,
  CheckCircle2,
  KeyRound,
  Plus,
  Power,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  createCategoryAction,
  deleteUserAction,
  invalidateAttemptAction,
  resetUserPasswordAction,
  setUserAdminAction,
  toggleCategoryAction,
} from "@/actions/admin";
import { Avatar } from "@/components/avatar";
import { CategoryIcon } from "@/components/category-icon";
import { FormMessage, SubmitButton } from "@/components/form-controls";
import { formatDate, formatTime } from "@/lib/format";
import type { Category, Profile } from "@/types/app";

type AdminAttempt = {
  id: string;
  elapsed_ms: number;
  confirmed_at: string;
  status: "approved" | "invalidated";
  invalidated_reason: string | null;
  profiles: Pick<Profile, "id" | "username" | "avatar_path">;
  categories: Pick<Category, "id" | "name" | "icon_key" | "accent_color">;
};

export function AdminDashboard({
  categories,
  users,
  attempts,
  currentUserId,
}: {
  categories: Category[];
  users: Profile[];
  attempts: AdminAttempt[];
  currentUserId: string;
}) {
  const [createState, createAction] = useActionState(createCategoryAction, {});
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setMessage(undefined);
    startTransition(async () => {
      const result = await action();
      setMessage(result.ok ? success : result.error ?? "Handlingen mislykkedes.");
    });
  }

  return (
    <div className="admin-dashboard">
      {message && <p className="admin-toast" role="status">{message}</p>}

      <section className="admin-section" id="kategorier">
        <div className="admin-section__header">
          <div><p className="eyebrow">Banerne</p><h2>Kategorier</h2><p>Opret nye beholdere, eller luk midlertidigt for en eksisterende.</p></div>
          <span>{categories.filter((category) => category.is_active).length} aktive</span>
        </div>

        <div className="admin-category-grid">
          {categories.map((category) => (
            <article className="admin-category" key={category.id} style={{ "--category-color": category.accent_color } as React.CSSProperties}>
              <CategoryIcon iconKey={category.icon_key} />
              <div><strong>{category.name}</strong><small>{category.is_active ? "Synlig for spillere" : "Arkiveret"}</small></div>
              <button
                className={category.is_active ? "status-toggle is-active" : "status-toggle"}
                disabled={pending}
                onClick={() => run(() => toggleCategoryAction(category.id, !category.is_active), "Kategorien er opdateret.")}
                aria-label={category.is_active ? `Arkiver ${category.name}` : `Aktivér ${category.name}`}
              >
                <Power aria-hidden="true" />
              </button>
            </article>
          ))}
        </div>

        <form action={createAction} className="admin-create-form">
          <div className="admin-create-form__title"><Plus aria-hidden="true" /><div><strong>Ny kategori</strong><span>Den bliver aktiv med det samme.</span></div></div>
          <div className="field"><label htmlFor="category-name">Navn</label><input id="category-name" name="name" maxLength={80} placeholder="Fadøl" required /></div>
          <div className="field">
            <label htmlFor="category-icon">Ikon</label>
            <select id="category-icon" name="iconKey" defaultValue="glass">
              <option value="bottle">Flaske</option><option value="can">Dåse</option><option value="cup">Krus</option>
              <option value="glass">Glas</option><option value="pint">Pint</option><option value="soda">Kop med sugerør</option>
            </select>
          </div>
          <div className="field"><label htmlFor="category-color">Farve</label><input id="category-color" name="accentColor" type="color" defaultValue="#F6A800" /></div>
          <div className="field admin-create-form__description"><label htmlFor="category-description">Beskrivelse</label><input id="category-description" name="description" maxLength={160} placeholder="50 cl fra fad" /></div>
          <FormMessage {...createState} />
          <SubmitButton className="button--primary" pendingLabel="Opretter...">Opret kategori</SubmitButton>
        </form>
      </section>

      <section className="admin-section" id="tider">
        <div className="admin-section__header">
          <div><p className="eyebrow">Dommerbordet</p><h2>Seneste tider</h2><p>Fjern selv-godkendte tider, der tydeligt er falske.</p></div>
          <span>{attempts.filter((attempt) => attempt.status === "approved").length} gyldige vist</span>
        </div>
        <div className="admin-table">
          {attempts.length ? attempts.map((attempt) => (
            <article className="admin-time-row" key={attempt.id}>
              <Avatar username={attempt.profiles.username} path={attempt.profiles.avatar_path} size="small" />
              <div className="admin-time-row__user"><strong>@{attempt.profiles.username}</strong><small>{attempt.categories.name}</small></div>
              <b>{formatTime(attempt.elapsed_ms)}s</b>
              <span className={attempt.status === "approved" ? "status-badge status-badge--ok" : "status-badge status-badge--bad"}>
                {attempt.status === "approved" ? <><CheckCircle2 aria-hidden="true" /> Gyldig</> : <><Ban aria-hidden="true" /> Fjernet</>}
              </span>
              {attempt.status === "approved" && (
                <button
                  className="icon-button icon-button--danger"
                  disabled={pending}
                  title="Fjern fra ranglister"
                  onClick={() => {
                    const reason = window.prompt("Hvorfor fjernes tiden?", "Mistænkelig eller falsk tid");
                    if (reason !== null) run(() => invalidateAttemptAction(attempt.id, reason), "Tiden er fjernet fra alle ranglister.");
                  }}
                ><ShieldAlert aria-hidden="true" /></button>
              )}
            </article>
          )) : <div className="inline-empty">Der er ingen godkendte tider endnu.</div>}
        </div>
      </section>

      <section className="admin-section" id="brugere">
        <div className="admin-section__header">
          <div><p className="eyebrow">Spillerlisten</p><h2>Brugere</h2><p>Nulstil en glemt kode, eller slet en falsk bruger permanent.</p></div>
          <span>{users.length} brugere</span>
        </div>
        <div className="admin-user-grid">
          {users.map((user) => (
            <article className="admin-user" key={user.id}>
              <Avatar username={user.username} path={user.avatar_path} size="medium" />
              <div><strong>@{user.username}</strong><small>{user.role === "admin" ? "Administrator" : `Oprettet ${formatDate(user.created_at)}`}</small></div>
              <div className="admin-user__actions">
                <button
                  className={user.role === "admin" ? "icon-button icon-button--admin" : "icon-button"}
                  title={user.role === "admin" ? "Fjern administrator" : "Gør til administrator"}
                  disabled={pending || user.id === currentUserId}
                  onClick={() => run(
                    () => setUserAdminAction(user.id, user.role !== "admin"),
                    user.role === "admin" ? "Adminrollen er fjernet." : "Brugeren er nu administrator.",
                  )}
                ><ShieldCheck aria-hidden="true" /></button>
                <button
                  className="icon-button"
                  title="Nulstil adgangskode"
                  disabled={pending}
                  onClick={() => {
                    const password = window.prompt(`Ny adgangskode til @${user.username}:`);
                    if (password) run(() => resetUserPasswordAction(user.id, password), "Adgangskoden er nulstillet.");
                  }}
                ><KeyRound aria-hidden="true" /></button>
                <button
                  className="icon-button icon-button--danger"
                  title="Slet bruger"
                  disabled={pending || user.id === currentUserId}
                  onClick={() => {
                    if (window.confirm(`Slet @${user.username} og alle brugerens tider permanent?`)) {
                      run(() => deleteUserAction(user.id), "Brugeren er slettet.");
                    }
                  }}
                ><Trash2 aria-hidden="true" /></button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
