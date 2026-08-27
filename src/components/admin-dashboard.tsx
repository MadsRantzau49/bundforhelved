"use client";

import { useActionState, useState, useTransition } from "react";
import {
  Award,
  ChevronDown,
  FileVideo,
  ImagePlus,
  KeyRound,
  Pencil,
  Plus,
  Power,
  Save,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  adminUpdateAttemptAction,
  createCategoryAction,
  deleteUserAction,
  resetUserPasswordAction,
  setUserAdminAction,
  toggleCategoryAction,
  updateAchievementImageAction,
  updateCategoryAction,
} from "@/actions/admin";
import { Avatar } from "@/components/avatar";
import { CategoryVisual } from "@/components/category-visual";
import { FormMessage, SubmitButton } from "@/components/form-controls";
import { achievementMediaUrl } from "@/lib/achievement-media";
import { achievementDefinitions } from "@/lib/achievements";
import { formatDate, formatTime } from "@/lib/format";
import type { AchievementAsset, AttemptStatus, Category, Profile } from "@/types/app";

export type AdminAttempt = {
  id: string;
  user_id: string;
  recorded_by: string | null;
  category_id: string;
  clan_id: string | null;
  elapsed_ms: number;
  stopped_at: string;
  confirmed_at: string | null;
  submitted_for_review_at: string | null;
  reviewed_at: string | null;
  status: Exclude<AttemptStatus, "running">;
  invalidated_reason: string | null;
  profiles: Pick<Profile, "id" | "username" | "avatar_path">;
  recorder: Pick<Profile, "id" | "username"> | null;
  categories: Pick<Category, "id" | "name" | "icon_key" | "accent_color">;
  clans: { id: string; name: string } | null;
};

export type AdminClan = {
  id: string;
  name: string;
  clan_members: { user_id: string }[];
};

const statusText: Record<AdminAttempt["status"], string> = {
  awaiting_confirmation: "Ikke indsendt",
  pending_review: "Afventer review",
  approved: "Bekræftet",
  declined: "Afvist",
  invalidated: "Ugyldig",
};

function CategoryEditor({
  category,
  pending,
  run,
}: {
  category: Category;
  pending: boolean;
  run: (action: () => Promise<{ ok: boolean; error?: string }>, success: string) => void;
}) {
  return (
    <details className="admin-category-editor">
      <summary>
        <CategoryVisual iconKey={category.icon_key} imagePath={category.image_path} name={category.name} />
        <div><strong>{category.name}</strong><small>{category.is_active ? "Synlig for spillere" : "Arkiveret"}</small></div>
        <Pencil aria-label="Rediger kategori" />
      </summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          run(() => updateCategoryAction(formData), `${category.name} er gemt.`);
        }}
        className="admin-edit-form"
      >
        <input type="hidden" name="id" value={category.id} />
        <div className="field"><label htmlFor={`name-${category.id}`}>Navn</label><input id={`name-${category.id}`} name="name" defaultValue={category.name} maxLength={80} required /></div>
        <div className="field"><label htmlFor={`icon-${category.id}`}>Ikon</label><select id={`icon-${category.id}`} name="iconKey" defaultValue={category.icon_key}><option value="bottle">Flaske</option><option value="can">Dåse</option><option value="cup">Krus</option><option value="glass">Glas</option><option value="pint">Pint</option><option value="soda">Kop med sugerør</option></select></div>
        <div className="field"><label htmlFor={`color-${category.id}`}>Farve</label><input id={`color-${category.id}`} name="accentColor" type="color" defaultValue={category.accent_color} /></div>
        <div className="field admin-edit-form__wide"><label htmlFor={`description-${category.id}`}>Kort beskrivelse</label><input id={`description-${category.id}`} name="description" defaultValue={category.description} maxLength={160} /></div>
        <div className="field admin-edit-form__wide"><label htmlFor={`guide-${category.id}`}>Guidetekst</label><textarea id={`guide-${category.id}`} name="guideText" defaultValue={category.guide_text} maxLength={50_000} rows={5} placeholder="Fx: Brug kun én hånd, og start uret med samme hånd som du drikker med." /></div>
        <label className="admin-media-picker"><ImagePlus aria-hidden="true" /><span><strong>Kategoribillede</strong><small>JPG, PNG, WebP eller GIF</small></span><input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></label>
        {category.image_path && <label className="admin-remove-media"><input type="checkbox" name="removeImage" /> Fjern nuværende billede</label>}
        <label className="admin-media-picker"><FileVideo aria-hidden="true" /><span><strong>Instruktionsvideo</strong><small>MP4, WebM eller MOV · maks. 45 MB</small></span><input name="guideVideo" type="file" accept="video/mp4,video/webm,video/quicktime" /></label>
        {category.guide_video_path && <label className="admin-remove-media"><input type="checkbox" name="removeGuideVideo" /> Fjern instruktionsvideo</label>}
        <label className="admin-media-picker"><FileVideo aria-hidden="true" /><span><strong>Demonstrationsvideo</strong><small>Ekstra eksempel til Guide</small></span><input name="demoVideo" type="file" accept="video/mp4,video/webm,video/quicktime" /></label>
        {category.demo_video_path && <label className="admin-remove-media"><input type="checkbox" name="removeDemoVideo" /> Fjern demonstrationsvideo</label>}
        <div className="admin-edit-form__actions">
          <button type="button" className={category.is_active ? "status-toggle is-active" : "status-toggle"} disabled={pending} onClick={() => run(() => toggleCategoryAction(category.id, !category.is_active), "Synligheden er opdateret.")}><Power aria-hidden="true" /> {category.is_active ? "Arkivér" : "Aktivér"}</button>
          <button className="button button--primary" disabled={pending}><Save aria-hidden="true" /> Gem kategori</button>
        </div>
      </form>
    </details>
  );
}

function AttemptEditor({
  attempt,
  users,
  categories,
  clans,
  pending,
  run,
}: {
  attempt: AdminAttempt;
  users: Profile[];
  categories: Category[];
  clans: AdminClan[];
  pending: boolean;
  run: (action: () => Promise<{ ok: boolean; error?: string }>, success: string) => void;
}) {
  const [playerId, setPlayerId] = useState(attempt.user_id);
  const [clanId, setClanId] = useState(attempt.clan_id ?? "");
  const [categoryId, setCategoryId] = useState(attempt.category_id);
  const [seconds, setSeconds] = useState((attempt.elapsed_ms / 1000).toFixed(2));
  const [decision, setDecision] = useState<"keep" | "valid" | "invalid">("keep");
  const [reason, setReason] = useState(attempt.invalidated_reason ?? "");
  const selectedClanAllowed = (id: string) => clans.find((clan) => clan.id === id)?.clan_members.some((member) => member.user_id === playerId) ?? false;

  return (
    <details className="admin-attempt">
      <summary className="admin-time-row">
        <Avatar username={attempt.profiles.username} path={attempt.profiles.avatar_path} size="small" />
        <div className="admin-time-row__user"><strong>@{attempt.profiles.username}</strong><small>{attempt.categories.name} · {attempt.clans?.name ?? "Global"}</small></div>
        <b>{formatTime(attempt.elapsed_ms)}s</b>
        <span className={`status-badge ${attempt.status === "approved" ? "status-badge--ok" : "status-badge--bad"}`}>{statusText[attempt.status]}</span>
        <ChevronDown aria-hidden="true" />
      </summary>
      <div className="admin-attempt__form">
        <div className="field"><label htmlFor={`player-${attempt.id}`}>Hvem drak?</label><select id={`player-${attempt.id}`} value={playerId} onChange={(event) => { const next = event.target.value; setPlayerId(next); if (clanId && !(clans.find((clan) => clan.id === clanId)?.clan_members.some((member) => member.user_id === next))) setClanId(""); }}>{users.map((user) => <option key={user.id} value={user.id}>@{user.username}</option>)}</select></div>
        <div className="field"><label htmlFor={`category-${attempt.id}`}>Kategori</label><select id={`category-${attempt.id}`} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.is_active ? "" : " (arkiveret)"}</option>)}</select></div>
        <div className="field"><label htmlFor={`scope-${attempt.id}`}>Rangliste</label><select id={`scope-${attempt.id}`} value={clanId} onChange={(event) => setClanId(event.target.value)}><option value="">Global</option>{clans.map((clan) => <option key={clan.id} value={clan.id} disabled={!selectedClanAllowed(clan.id)}>{clan.name}{selectedClanAllowed(clan.id) ? "" : " (ikke medlem)"}</option>)}</select></div>
        <div className="field"><label htmlFor={`elapsed-${attempt.id}`}>Tid i sekunder</label><input id={`elapsed-${attempt.id}`} type="number" min="0" step="0.01" value={seconds} onChange={(event) => setSeconds(event.target.value)} /></div>
        <div className="field"><label htmlFor={`valid-${attempt.id}`}>Status</label><select id={`valid-${attempt.id}`} value={decision} onChange={(event) => setDecision(event.target.value as "keep" | "valid" | "invalid")}><option value="keep">Behold: {statusText[attempt.status]}</option><option value="valid">Gyldig / bekræftet</option><option value="invalid">Ugyldig / fjernet</option></select></div>
        <div className="field admin-attempt__wide"><label htmlFor={`reason-${attempt.id}`}>Adminnote</label><input id={`reason-${attempt.id}`} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} placeholder={decision === "valid" ? "Hvorfor godkendes tiden?" : decision === "invalid" ? "Hvorfor fjernes tiden?" : "Valgfri note (bruges ved statusskift)"} /></div>
        <p className="admin-attempt__meta">Sat {formatDate(attempt.stopped_at)}{attempt.recorder ? ` på @${attempt.recorder.username}s telefon` : ""} · ID {attempt.id}</p>
        <button
          className={decision === "invalid" ? "button button--danger admin-attempt__save" : "button button--primary admin-attempt__save"}
          disabled={pending || !Number.isFinite(Number(seconds)) || Number(seconds) < 0}
          onClick={() => run(() => adminUpdateAttemptAction({ attemptId: attempt.id, playerId, categoryId, clanId: clanId || null, elapsedMs: Math.round(Number(seconds) * 1000), valid: decision === "keep" ? null : decision === "valid", reason }), decision === "keep" ? "Tiden er rettet uden statusskift." : decision === "valid" ? "Tiden er rettet og bekræftet." : "Tiden er rettet og markeret ugyldig.")}
        ><Save aria-hidden="true" /> Gem hele tiden</button>
      </div>
    </details>
  );
}

function AchievementImageEditor({
  achievement,
  imagePath,
  pending,
  run,
}: {
  achievement: (typeof achievementDefinitions)[number];
  imagePath: string | null;
  pending: boolean;
  run: (action: () => Promise<{ ok: boolean; error?: string }>, success: string) => void;
}) {
  const imageUrl = achievementMediaUrl(imagePath);
  return (
    <form
      className="admin-achievement"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        run(() => updateAchievementImageAction(formData), `${achievement.title} har fået nyt billede.`);
      }}
    >
      <input type="hidden" name="key" value={achievement.key} />
      <span className="admin-achievement__preview" style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}>{!imageUrl && <Award aria-hidden="true" />}</span>
      <div><strong>{achievement.title}</strong><small>{achievement.description}</small><em>{achievement.rarity}</em></div>
      <label className="admin-achievement__upload"><ImagePlus aria-hidden="true" /><span>Vælg billede</span><input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></label>
      {imagePath && <label className="admin-remove-media"><input type="checkbox" name="removeImage" /> Fjern nuværende</label>}
      <button className="button button--primary" disabled={pending}><Save aria-hidden="true" /> Gem</button>
    </form>
  );
}

export function AdminDashboard({
  categories,
  users,
  attempts,
  clans,
  achievementAssets,
  currentUserId,
}: {
  categories: Category[];
  users: Profile[];
  attempts: AdminAttempt[];
  clans: AdminClan[];
  achievementAssets: AchievementAsset[];
  currentUserId: string;
}) {
  const [createState, createAction] = useActionState(createCategoryAction, {});
  const [message, setMessage] = useState<string>();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setMessage(undefined);
    startTransition(async () => {
      try {
        const result = await action();
        setMessage(result.ok ? success : result.error ?? "Handlingen mislykkedes.");
      } catch {
        setMessage("Forbindelsen til serveren røg. Prøv igen.");
      }
    });
  }

  const normalizedQuery = query.trim().toLowerCase();
  const filteredAttempts = attempts.filter((attempt) => {
    const matchesStatus = status === "all" || attempt.status === status;
    const haystack = `${attempt.profiles.username} ${attempt.categories.name} ${attempt.clans?.name ?? "global"} ${attempt.id}`.toLowerCase();
    return matchesStatus && (!normalizedQuery || haystack.includes(normalizedQuery));
  });
  const achievementArtwork = new Map(achievementAssets.map((asset) => [asset.achievement_key, asset.image_path]));

  return (
    <div className="admin-dashboard">
      {message && <p className="admin-toast" role="status">{message}</p>}
      <section className="admin-section" id="kategorier">
        <div className="admin-section__header"><div><p className="eyebrow">Banerne</p><h2>Kategorier og guide</h2><p>Ret ikon, billede, beskrivelse, guidetekst og begge videoer.</p></div><span>{categories.filter((category) => category.is_active).length} aktive</span></div>
        <div className="admin-category-grid">{categories.map((category) => <CategoryEditor key={category.id} category={category} pending={pending} run={run} />)}</div>
        <form action={createAction} className="admin-create-form">
          <div className="admin-create-form__title"><Plus aria-hidden="true" /><div><strong>Ny kategori</strong><span>Opret den først, og tilføj derefter billede og guide ovenfor.</span></div></div>
          <div className="field"><label htmlFor="category-name">Navn</label><input id="category-name" name="name" maxLength={80} placeholder="Fadøl" required /></div>
          <div className="field"><label htmlFor="category-icon">Ikon</label><select id="category-icon" name="iconKey" defaultValue="glass"><option value="bottle">Flaske</option><option value="can">Dåse</option><option value="cup">Krus</option><option value="glass">Glas</option><option value="pint">Pint</option><option value="soda">Kop med sugerør</option></select></div>
          <div className="field"><label htmlFor="category-color">Farve</label><input id="category-color" name="accentColor" type="color" defaultValue="#F6A800" /></div>
          <div className="field admin-create-form__description"><label htmlFor="category-description">Beskrivelse</label><input id="category-description" name="description" maxLength={160} placeholder="50 cl fra fad" /></div>
          <FormMessage {...createState} /><SubmitButton className="button--primary" pendingLabel="Opretter...">Opret kategori</SubmitButton>
        </form>
      </section>

      <section className="admin-section" id="bedrifter">
        <div className="admin-section__header"><div><p className="eyebrow">Medaljeværkstedet</p><h2>Billeder til bedrifter</h2><p>Upload et unikt billede til hver bedrift. JPG, PNG, WebP eller GIF, maks. 5 MB.</p></div><span>{achievementAssets.filter((asset) => asset.image_path).length} med billeder</span></div>
        <div className="admin-achievement-grid">
          {achievementDefinitions.map((achievement) => <AchievementImageEditor key={achievement.key} achievement={achievement} imagePath={achievementArtwork.get(achievement.key) ?? null} pending={pending} run={run} />)}
        </div>
      </section>

      <section className="admin-section" id="tider">
        <div className="admin-section__header"><div><p className="eyebrow">Dommerbordet</p><h2>Alle registrerede tider</h2><p>Søg og ret spiller, kategori, klan, varighed og gyldighed.</p></div><span>{filteredAttempts.length} af {attempts.length}</span></div>
        <div className="admin-filters"><label><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Søg bruger, kategori, klan eller ID" /></label><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Alle statusser</option><option value="awaiting_confirmation">Ikke indsendt</option><option value="pending_review">Afventer review</option><option value="approved">Bekræftet</option><option value="declined">Afvist</option><option value="invalidated">Ugyldig</option></select></div>
        <div className="admin-table">{filteredAttempts.length ? filteredAttempts.map((attempt) => <AttemptEditor key={attempt.id} attempt={attempt} users={users} categories={categories} clans={clans} pending={pending} run={run} />) : <div className="inline-empty">Ingen tider matcher filtrene.</div>}</div>
      </section>

      <section className="admin-section" id="brugere">
        <div className="admin-section__header"><div><p className="eyebrow">Spillerlisten</p><h2>Brugere</h2><p>Nulstil en glemt kode, skift adminrolle eller slet en falsk bruger.</p></div><span>{users.length} brugere</span></div>
        <div className="admin-user-grid">{users.map((user) => (
          <article className="admin-user" key={user.id}><Avatar username={user.username} path={user.avatar_path} size="medium" /><div><strong>@{user.username}</strong><small>{user.role === "admin" ? "Administrator" : `Oprettet ${formatDate(user.created_at)}`}</small></div><div className="admin-user__actions">
            <button className={user.role === "admin" ? "icon-button icon-button--admin" : "icon-button"} title={user.role === "admin" ? "Fjern administrator" : "Gør til administrator"} disabled={pending || user.id === currentUserId} onClick={() => run(() => setUserAdminAction(user.id, user.role !== "admin"), user.role === "admin" ? "Adminrollen er fjernet." : "Brugeren er nu administrator.")}><ShieldCheck aria-hidden="true" /></button>
            <button className="icon-button" title="Nulstil adgangskode" disabled={pending} onClick={() => { const password = window.prompt(`Ny adgangskode til @${user.username}:`); if (password) run(() => resetUserPasswordAction(user.id, password), "Adgangskoden er nulstillet."); }}><KeyRound aria-hidden="true" /></button>
            <button className="icon-button icon-button--danger" title="Slet bruger" disabled={pending || user.id === currentUserId} onClick={() => { if (window.confirm(`Slet @${user.username} og alle brugerens tider permanent?`)) run(() => deleteUserAction(user.id), "Brugeren er slettet."); }}><Trash2 aria-hidden="true" /></button>
          </div></article>
        ))}</div>
      </section>
    </div>
  );
}
