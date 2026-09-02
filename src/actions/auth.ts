"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import {
  authenticateCredentials,
  clearCredentialAttempts,
  consumeCredentialAttempt,
  internalEmail,
  InvalidCredentialsError,
  normalizeUsername,
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

export async function loginAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!isSupabaseConfigured()) return { error: "Tilslut først projektet til Supabase." };

  try {
    const username = normalizeUsername(formString(formData, "username"));
    const throttle = await consumeCredentialAttempt(username);
    const credentials = await authenticateCredentials(username, formString(formData, "password"));
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: credentials.email,
      password: credentials.password,
    });

    if (error) return { error: "Forkert brugernavn eller adgangskode." };
    await clearCredentialAttempts(throttle);
  } catch (error) {
    if (error instanceof InvalidCredentialsError) {
      return { error: "Forkert brugernavn eller adgangskode." };
    }
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
    await consumeCredentialAttempt(username);
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

export async function logoutAction(formData?: FormData) {
  const supabase = await createSupabaseServerClient();
  const pushEndpoint = formData?.get("push_endpoint");
  if (typeof pushEndpoint === "string" && pushEndpoint) {
    await supabase.rpc("remove_push_subscription", { subscription_endpoint: pushEndpoint });
  }
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
