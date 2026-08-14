"use client";

import { useActionState, useSyncExternalStore } from "react";
import { Download, ImagePlus, KeyRound, Share, Smartphone } from "lucide-react";
import { changePasswordAction } from "@/actions/auth";
import { uploadAvatarAction } from "@/actions/profile";
import { FormMessage, SubmitButton } from "@/components/form-controls";
import {
  clearPwaInstallPrompt,
  getPwaInstallServerSnapshot,
  getPwaInstallSnapshot,
  markPwaInstalled,
  subscribeToPwaInstall,
} from "@/lib/pwa-install";

export function AvatarForm() {
  const [state, action] = useActionState(uploadAvatarAction, {});
  return (
    <form action={action} className="profile-form">
      <div>
        <p className="eyebrow">Nyt look</p>
        <h2>Profilbillede</h2>
        <p>JPG, PNG eller WebP. Maks. 2 MB.</p>
      </div>
      <label className="file-picker">
        <ImagePlus aria-hidden="true" />
        <span>Vælg billede</span>
        <input name="avatar" type="file" accept="image/jpeg,image/png,image/webp" required />
      </label>
      <FormMessage {...state} />
      <SubmitButton className="button--secondary" pendingLabel="Uploader...">Gem billede</SubmitButton>
    </form>
  );
}

export function PasswordForm() {
  const [state, action] = useActionState(changePasswordAction, {});
  return (
    <form action={action} className="profile-form">
      <div>
        <p className="eyebrow">Hold den hemmelig</p>
        <h2>Skift adgangskode</h2>
        <p>Der er stadig ingen styrkekrav.</p>
      </div>
      <div className="field">
        <label htmlFor="new-password">Ny adgangskode</label>
        <div className="input-wrap">
          <KeyRound aria-hidden="true" />
          <input id="new-password" name="password" type="password" maxLength={64} required />
        </div>
      </div>
      <FormMessage {...state} />
      <SubmitButton className="button--secondary" pendingLabel="Gemmer...">Skift kode</SubmitButton>
    </form>
  );
}

export function InstallApp() {
  const installState = useSyncExternalStore(
    subscribeToPwaInstall,
    getPwaInstallSnapshot,
    getPwaInstallServerSnapshot,
  );
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  const installed = installState.installed || (mounted && (
    window.matchMedia("(display-mode: standalone)").matches
    || ("standalone" in navigator && navigator.standalone === true)
  ));
  const isIos = mounted && (
    /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
  const secureContext = !mounted || window.isSecureContext;

  if (installed) {
    return <div className="install-card install-card--installed"><Smartphone aria-hidden="true" /><div><strong>Appen er installeret</strong><span>Klar direkte fra hjemmeskærmen.</span></div></div>;
  }

  if (!secureContext) {
    return (
      <div className="install-card install-card--blocked">
        <span className="install-card__icon"><Smartphone aria-hidden="true" /></span>
        <div><strong>Installation kræver HTTPS</strong><span>Åbn appen via en sikker HTTPS-adresse på telefonen.</span></div>
      </div>
    );
  }

  return (
    <div className="install-card">
      <span className="install-card__icon"><Download aria-hidden="true" /></span>
      <div><strong>Få den på hjemmeskærmen</strong><span>Hurtigere adgang og ægte app-følelse.</span></div>
      {installState.prompt ? (
        <button
          className="button button--small button--primary"
          onClick={async () => {
            const prompt = installState.prompt;
            if (!prompt) return;
            await prompt.prompt();
            const choice = await prompt.userChoice;
            if (choice.outcome === "accepted") markPwaInstalled();
            else clearPwaInstallPrompt();
          }}
        >
          Installer
        </button>
      ) : isIos ? (
        <small><Share aria-hidden="true" /> Tryk Del, derefter “Føj til hjemmeskærm”.</small>
      ) : (
        <small>Brug browserens menu og vælg “Installer app”.</small>
      )}
    </div>
  );
}
