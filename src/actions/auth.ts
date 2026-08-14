"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { ZodError } from "zod";
import {
  internalEmail,
  normalizeUsername,
  privateRateLimitHash,
  providerPassword,
} from "@/lib/auth/credentials";
import { isSupabaseConfigured } from "@/lib/env";
import { getErrorText } from "@/lib/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formString, passwordSchema } from "@/lib/validation";
import type { FormState } from "@/types/app";

function validationError(error: unknown) {
  if (error instanceof ZodError) return error.issues[0]?.message ?? "Tjek dine oplysninger.";
  if (error instanceof Error && error.message.includes("PEPPER")) return "Serverens login er ikke færdigopsat.";
  return "Noget gik galt. Prøv igen.";
}

async function consumeLoginAttempt(username: string) {
  const requestHeaders = await headers();
  const clientIp =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    requestHeaders.get("x-real-ip") ||
    "unknown";
  const identityHash = privateRateLimitHash("identity", username);
  const ipHash = privateRateLimitHash("ip", clientIp);
  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("consume_login_attempt", {
    identity_hash: identityHash,
    ip_hash: ipHash,
  });
  if (error) throw error;
  return { admin, identityHash, ipHash };
}

export async function loginAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!isSupabaseConfigured()) return { error: "Tilslut først projektet til Supabase." };

  try {
    const username = normalizeUsername(formString(formData, "username"));
    const password = providerPassword(formString(formData, "password"));
    const throttle = await consumeLoginAttempt(username);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: internalEmail(username),
      password,
    });

    if (error) return { error: "Forkert brugernavn eller adgangskode." };
    await throttle.admin.rpc("clear_login_attempts", {
      identity_hash: throttle.identityHash,
      ip_hash: throttle.ipHash,
    });
  } catch (error) {
    if (getErrorText(error).toLowerCase().includes("rate limit")) {
      return { error: "For mange forsøg. Vent 15 minutter og prøv igen." };
    }
    return { error: validationError(error) };
  }

  redirect("/timer");
}

export async function signupAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!isSupabaseConfigured()) return { error: "Tilslut først projektet til Supabase." };

  try {
    const username = normalizeUsername(formString(formData, "username"));
    const rawPassword = formString(formData, "password");
    passwordSchema.parse(rawPassword);
    await consumeLoginAttempt(username);
    const email = internalEmail(username);
    const password = providerPassword(rawPassword);
    const admin = createSupabaseAdminClient();
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username },
      app_metadata: { managed_account: true },
    });

    if (createError || !created.user) {
      if (createError?.message.toLowerCase().includes("registered")) {
        return { error: "Brugernavnet er allerede taget." };
      }
      return { error: "Kunne ikke oprette brugeren. Prøv et andet brugernavn." };
    }

    const supabase = await createSupabaseServerClient();
    const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    if (loginError) {
      await admin.auth.admin.deleteUser(created.user.id);
      return { error: "Brugeren blev ikke logget ind. Prøv at oprette den igen." };
    }
  } catch (error) {
    if (getErrorText(error).toLowerCase().includes("rate limit")) {
      return { error: "For mange oprettelser. Vent 15 minutter og prøv igen." };
    }
    return { error: validationError(error) };
  }

  redirect("/timer");
}

export async function logoutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function changePasswordAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const password = providerPassword(formString(formData, "password"));
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { error: "Adgangskoden kunne ikke ændres." };
    revalidatePath("/profil");
    return { success: "Adgangskoden er ændret." };
  } catch (error) {
    return { error: validationError(error) };
  }
}
