"use client";

import { useEffect } from "react";
import {
  capturePwaInstallPrompt,
  clearPwaInstallPrompt,
  markPwaInstalled,
  type PwaInstallPromptEvent,
} from "@/lib/pwa-install";

export function PwaRegister({ revision }: { revision: string }) {
  useEffect(() => {
    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      capturePwaInstallPrompt(event as PwaInstallPromptEvent);
    };
    const onInstalled = () => markPwaInstalled();

    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    if (window.matchMedia("(display-mode: standalone)").matches) {
      markPwaInstalled();
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;

    let registration: ServiceWorkerRegistration | undefined;
    let updateInterval: number | undefined;
    let cancelled = false;

    const checkForUpdate = () => {
      if (document.visibilityState === "visible") void registration?.update().catch(() => undefined);
    };
    const register = async () => {
      try {
        registration = await navigator.serviceWorker.register(
          `/sw.js?v=${encodeURIComponent(revision)}`,
          { scope: "/", updateViaCache: "none" },
        );
        if (cancelled) return;
        void registration.update().catch(() => undefined);
        updateInterval = window.setInterval(checkForUpdate, 60 * 60 * 1_000);
      } catch {
        clearPwaInstallPrompt();
      }
    };

    if (document.readyState === "complete") {
      void register();
    } else {
      window.addEventListener("load", register, { once: true });
    }
    window.addEventListener("online", checkForUpdate);
    document.addEventListener("visibilitychange", checkForUpdate);

    return () => {
      cancelled = true;
      window.removeEventListener("load", register);
      window.removeEventListener("online", checkForUpdate);
      document.removeEventListener("visibilitychange", checkForUpdate);
      if (updateInterval !== undefined) window.clearInterval(updateInterval);
    };
  }, [revision]);

  return null;
}
