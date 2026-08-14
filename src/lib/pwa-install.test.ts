import { describe, expect, it, vi } from "vitest";
import manifest from "@/app/manifest";
import {
  capturePwaInstallPrompt,
  clearPwaInstallPrompt,
  getPwaInstallSnapshot,
  markPwaInstalled,
  subscribeToPwaInstall,
  type PwaInstallPromptEvent,
} from "@/lib/pwa-install";

describe("PWA configuration", () => {
  it("publishes an installable standalone manifest", () => {
    const value = manifest();
    expect(value).toMatchObject({ id: "/", scope: "/", start_url: "/timer", display: "standalone" });
    expect(value.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ sizes: "192x192" }),
      expect.objectContaining({ sizes: "512x512" }),
      expect.objectContaining({ purpose: "maskable" }),
    ]));
  });

  it("retains an early install prompt for the profile install button", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToPwaInstall(listener);
    const prompt = Object.assign(new Event("beforeinstallprompt"), {
      prompt: vi.fn(async () => undefined),
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    }) as PwaInstallPromptEvent;

    capturePwaInstallPrompt(prompt);
    expect(getPwaInstallSnapshot().prompt).toBe(prompt);
    clearPwaInstallPrompt();
    expect(getPwaInstallSnapshot().prompt).toBeNull();
    markPwaInstalled();
    expect(getPwaInstallSnapshot().installed).toBe(true);
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
  });
});
