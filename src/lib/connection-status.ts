"use client";

import { useSyncExternalStore } from "react";

let online = true;
let monitoring = false;
let interval: number | undefined;
let controller: AbortController | undefined;
const listeners = new Set<() => void>();

function publish(nextOnline: boolean) {
  if (online === nextOnline) return;
  online = nextOnline;
  listeners.forEach((listener) => listener());
}

async function checkConnection() {
  if (!navigator.onLine) {
    publish(false);
    return;
  }

  controller?.abort();
  controller = new AbortController();
  const timeout = window.setTimeout(() => controller?.abort(), 4_000);
  try {
    const response = await fetch("/api/health", {
      method: "HEAD",
      cache: "no-store",
      signal: controller.signal,
    });
    publish(response.ok);
  } catch {
    publish(false);
  } finally {
    window.clearTimeout(timeout);
  }
}

function startMonitoring() {
  if (monitoring) return;
  monitoring = true;
  const checkWhenVisible = () => {
    if (document.visibilityState === "visible") void checkConnection();
  };
  const markOffline = () => publish(false);

  window.addEventListener("online", checkWhenVisible);
  window.addEventListener("offline", markOffline);
  window.addEventListener("pageshow", checkWhenVisible);
  document.addEventListener("visibilitychange", checkWhenVisible);
  interval = window.setInterval(checkWhenVisible, 30_000);
  void checkConnection();

  stopMonitoring = () => {
    monitoring = false;
    controller?.abort();
    window.removeEventListener("online", checkWhenVisible);
    window.removeEventListener("offline", markOffline);
    window.removeEventListener("pageshow", checkWhenVisible);
    document.removeEventListener("visibilitychange", checkWhenVisible);
    if (interval !== undefined) window.clearInterval(interval);
    interval = undefined;
  };
}

let stopMonitoring = () => undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  startMonitoring();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopMonitoring();
  };
}

export function useConnectionStatus() {
  return useSyncExternalStore(subscribe, () => online, () => true);
}
