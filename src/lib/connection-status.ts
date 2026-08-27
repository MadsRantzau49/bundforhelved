"use client";

import { useSyncExternalStore } from "react";

let online = true;
let monitoring = false;
let interval: number | undefined;
let controller: AbortController | undefined;
let checkRevision = 0;
const listeners = new Set<() => void>();

function publish(nextOnline: boolean) {
  if (online === nextOnline) return;
  online = nextOnline;
  listeners.forEach((listener) => listener());
}

async function checkConnection() {
  const revision = ++checkRevision;
  if (!navigator.onLine) {
    controller?.abort();
    publish(false);
    return;
  }

  controller?.abort();
  const activeController = new AbortController();
  controller = activeController;
  const timeout = window.setTimeout(() => activeController.abort(), 4_000);
  try {
    const response = await fetch("/api/health", {
      method: "HEAD",
      cache: "no-store",
      signal: activeController.signal,
    });
    if (revision === checkRevision) publish(response.ok);
  } catch {
    if (revision === checkRevision) publish(false);
  } finally {
    window.clearTimeout(timeout);
    if (controller === activeController) controller = undefined;
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
    checkRevision += 1;
    controller?.abort();
    controller = undefined;
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
