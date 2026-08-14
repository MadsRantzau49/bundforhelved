"use client";

export type PwaInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type InstallSnapshot = {
  prompt: PwaInstallPromptEvent | null;
  installed: boolean;
};

const serverSnapshot: InstallSnapshot = { prompt: null, installed: false };
let snapshot: InstallSnapshot = serverSnapshot;
const listeners = new Set<() => void>();

function update(next: InstallSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function capturePwaInstallPrompt(prompt: PwaInstallPromptEvent) {
  update({ prompt, installed: false });
}

export function clearPwaInstallPrompt() {
  update({ ...snapshot, prompt: null });
}

export function markPwaInstalled() {
  update({ prompt: null, installed: true });
}

export function subscribeToPwaInstall(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPwaInstallSnapshot() {
  return snapshot;
}

export function getPwaInstallServerSnapshot() {
  return serverSnapshot;
}
