import "server-only";

import { createHash, createHmac } from "node:crypto";
import { passwordSchema, usernameSchema } from "@/lib/validation";

export function normalizeUsername(value: string) {
  return usernameSchema.parse(value);
}

export function internalEmail(username: string) {
  const normalized = normalizeUsername(username);
  const identity = createHash("sha256").update(normalized).digest("hex");
  return `${identity}@users.bundforhelved.invalid`;
}

export function providerPassword(password: string) {
  const parsed = passwordSchema.parse(password);
  const pepper = process.env.AUTH_PASSWORD_PEPPER;

  if (!pepper || pepper.length < 24) {
    throw new Error("AUTH_PASSWORD_PEPPER skal sættes til en lang hemmelig værdi.");
  }

  return createHmac("sha256", pepper).update(parsed).digest("base64url");
}

export function privateRateLimitHash(namespace: string, value: string) {
  const pepper = process.env.AUTH_PASSWORD_PEPPER;
  if (!pepper || pepper.length < 24) {
    throw new Error("AUTH_PASSWORD_PEPPER skal sættes til en lang hemmelig værdi.");
  }
  return createHmac("sha256", pepper)
    .update(`${namespace}:${value}`)
    .digest("hex");
}
