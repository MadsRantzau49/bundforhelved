"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { BellOff, BellRing } from "lucide-react";
import {
  disablePushNotificationsAction,
  enablePushNotificationsAction,
  updateNotificationPreferencesAction,
} from "@/actions/notifications";
import { FormMessage, SubmitButton } from "@/components/form-controls";
import type { NotificationPreferences } from "@/types/app";

type PushState = "checking" | "available" | "enabled" | "blocked" | "unavailable";

function applicationServerKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const decoded = window.atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export function NotificationSettings({
  initialPreferences,
  vapidPublicKey,
}: {
  initialPreferences: NotificationPreferences;
  vapidPublicKey: string | null;
}) {
  const [formState, formAction] = useActionState(updateNotificationPreferencesAction, {});
  const [pushState, setPushState] = useState<PushState>("checking");
  const [pushMessage, setPushMessage] = useState<string>();
  const [pushPending, startPushTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (!vapidPublicKey || !("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        if (!cancelled) setPushState("unavailable");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setPushState("blocked");
        return;
      }
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (!subscription) {
          if (!cancelled) setPushState("available");
          return;
        }
        const result = await enablePushNotificationsAction(subscription.toJSON());
        if (!cancelled) {
          setPushState(result.ok ? "enabled" : "available");
          if (!result.ok) setPushMessage(result.error);
        }
      } catch {
        if (!cancelled) setPushState("available");
      }
    });
    return () => { cancelled = true; };
  }, [vapidPublicKey]);

  function enablePush() {
    if (!vapidPublicKey || pushState === "blocked" || pushState === "unavailable") return;
    setPushMessage(undefined);
    startPushTransition(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setPushState(permission === "denied" ? "blocked" : "available");
          return;
        }
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        const subscription = existing ?? await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(vapidPublicKey),
        });
        const result = await enablePushNotificationsAction(subscription.toJSON());
        if (!result.ok) throw new Error(result.error);
        setPushState("enabled");
        setPushMessage("Push-notifikationer er aktive på denne enhed.");
      } catch (error) {
        setPushState("available");
        setPushMessage(error instanceof Error ? error.message : "Notifikationer kunne ikke aktiveres.");
      }
    });
  }

  function disablePush() {
    setPushMessage(undefined);
    startPushTransition(async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          const result = await disablePushNotificationsAction(subscription.endpoint);
          if (!result.ok) throw new Error(result.error);
          await subscription.unsubscribe();
        }
        setPushState("available");
        setPushMessage("Push-notifikationer er slået fra på denne enhed.");
      } catch (error) {
        setPushMessage(error instanceof Error ? error.message : "Notifikationer kunne ikke deaktiveres.");
      }
    });
  }

  return (
    <section className="notification-settings">
      <div>
        <p className="eyebrow">Beskeder</p>
        <h2>Notifikationer</h2>
        <p>Vælg hvilke hændelser der skal vises i indbakken og sendes som push.</p>
      </div>

      {pushState !== "unavailable" && (
        <button
          type="button"
          className={`notification-push${pushState === "enabled" ? " is-enabled" : ""}`}
          disabled={pushPending || pushState === "checking" || pushState === "blocked"}
          onClick={pushState === "enabled" ? disablePush : enablePush}
        >
          {pushState === "blocked" ? <BellOff aria-hidden="true" /> : <BellRing aria-hidden="true" />}
          <span>
            <strong>{pushState === "enabled" ? "Push er aktiv" : pushState === "blocked" ? "Push er blokeret" : "Aktivér push"}</strong>
            <small>{pushState === "enabled" ? "Tryk for at slå push fra på denne enhed" : pushState === "blocked" ? "Tillad notifikationer i enhedens indstillinger" : "Få besked, selv når appen ikke er åben"}</small>
          </span>
        </button>
      )}
      {pushState === "unavailable" && <p className="settings-note">Push understøttes ikke i denne browser eller er ikke konfigureret.</p>}
      {pushMessage && <p className="notification-panel__message" role="status">{pushMessage}</p>}

      <form action={formAction} className="notification-preferences">
        <label>
          <span><strong>Venner i top 3</strong><small>Når en ven rammer top 3 på vennelisten.</small></span>
          <input name="friends_top_three" type="checkbox" defaultChecked={initialPreferences.friends_top_three} />
        </label>
        <label>
          <span><strong>Peer review-pings</strong><small>Når en ven beder dig gennemgå en tid.</small></span>
          <input name="peer_review_pings" type="checkbox" defaultChecked={initialPreferences.peer_review_pings} />
        </label>
        <label>
          <span><strong>Venneanmodninger</strong><small>Når nogen sender dig en venneanmodning.</small></span>
          <input name="friend_requests" type="checkbox" defaultChecked={initialPreferences.friend_requests} />
        </label>
        <FormMessage {...formState} />
        <SubmitButton className="button--secondary" pendingLabel="Gemmer...">Gem notifikationer</SubmitButton>
      </form>
    </section>
  );
}
