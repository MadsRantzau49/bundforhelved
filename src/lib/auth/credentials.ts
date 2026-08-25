import "server-only";

import { createHash, createHmac } from "node:crypto";
import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseServerEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { passwordSchema, usernameSchema } from "@/lib/validation";

export class InvalidCredentialsError extends Error {}

export function normalizeUsername(value: string) {
  return usernameSchema.parse(value);
}

export function internalEmail(username: string) {
  const normalized = normalizeUsername(username);
  const identity = createHash("sha256").update(normalized).digest("hex");
  return `${identity}@users.bundforhelved.invalid`;
}

export function providerPassword(password: string) {
  const parsed = passwordSchema.parse(password).toLowerCase();
  return hashProviderPassword(parsed);
}

function legacyProviderPassword(password: string) {
  return hashProviderPassword(passwordSchema.parse(password));
}

function hashProviderPassword(password: string) {
  const pepper = process.env.AUTH_PASSWORD_PEPPER;

  if (!pepper || pepper.length < 24) {
    throw new Error("AUTH_PASSWORD_PEPPER skal sættes til en lang hemmelig værdi.");
  }

  return createHmac("sha256", pepper).update(password).digest("base64url");
}

export async function authenticateCredentials(usernameValue: string, passwordValue: string) {
  const username = normalizeUsername(usernameValue);
  const rawPassword = passwordSchema.parse(passwordValue);
  const admin = createSupabaseAdminClient();
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, username")
    .eq("username", username)
    .maybeSingle();

  if (profileError || !profile) throw new InvalidCredentialsError();

  const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(profile.id);
  const email = authUser.user?.email;
  if (authUserError || !email) throw new InvalidCredentialsError();

  const { url, anonKey } = getSupabaseServerEnv();
  const verifier = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const password = providerPassword(rawPassword);
  let { error } = await verifier.auth.signInWithPassword({ email, password });

  // Accounts created before passwords became case-insensitive are migrated
  // after one successful login with their original password casing.
  if (error && rawPassword !== rawPassword.toLowerCase()) {
    const legacyPassword = legacyProviderPassword(rawPassword);
    const legacyResult = await verifier.auth.signInWithPassword({ email, password: legacyPassword });
    error = legacyResult.error;
    if (!error) {
      const { error: migrationError } = await admin.auth.admin.updateUserById(profile.id, { password });
      if (migrationError) throw migrationError;
    }
  }

  if (error) throw new InvalidCredentialsError();
  return { id: profile.id as string, username: profile.username as string, email, password };
}

export async function consumeCredentialAttempt(username: string) {
  const requestHeaders = await headers();
  const clientIp =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    requestHeaders.get("x-real-ip") ||
    "unknown";
  const identityHash = privateRateLimitHash("identity", username.toLowerCase());
  const ipHash = privateRateLimitHash("ip", clientIp);
  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("consume_login_attempt", {
    identity_hash: identityHash,
    ip_hash: ipHash,
  });
  if (error) throw error;
  return { admin, identityHash, ipHash };
}

export async function clearCredentialAttempts(
  throttle: Awaited<ReturnType<typeof consumeCredentialAttempt>>,
) {
  await throttle.admin.rpc("clear_login_attempts", {
    identity_hash: throttle.identityHash,
    ip_hash: throttle.ipHash,
  });
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
