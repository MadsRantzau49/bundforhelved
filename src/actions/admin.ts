"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { providerPassword } from "@/lib/auth/credentials";
import { errorMessage } from "@/lib/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formString, uuidSchema } from "@/lib/validation";
import type { ActionResult, FormState } from "@/types/app";

const colorPattern = /^#[0-9A-Fa-f]{6}$/;
const iconPattern = /^[a-z0-9][a-z0-9_-]{0,49}$/;

export async function createCategoryAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  const name = formString(formData, "name").trim();
  const iconKey = formString(formData, "iconKey").trim();
  const accentColor = formString(formData, "accentColor").trim();
  const description = formString(formData, "description").trim();

  if (!name || name.length > 80) return { error: "Skriv et kategorinavn." };
  if (!iconPattern.test(iconKey)) return { error: "Vælg et gyldigt ikon." };
  if (!colorPattern.test(accentColor)) return { error: "Vælg en gyldig farve." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("categories").insert({
    name,
    icon_key: iconKey,
    accent_color: accentColor,
    description,
    created_by: admin.id,
    sort_order: Date.now() % 2_000_000_000,
  });

  if (error) return { error: "Navn og ikon skal være unikke." };
  revalidatePath("/admin");
  revalidatePath("/timer");
  return { success: `${name} er oprettet.` };
}

export async function toggleCategoryAction(id: string, active: boolean): Promise<ActionResult> {
  await requireAdmin();
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("categories")
      .update({ is_active: active })
      .eq("id", uuidSchema.parse(id))
      .select("id")
      .single();
    if (error) throw error;
    revalidatePath("/admin");
    revalidatePath("/timer");
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Kategorien kunne ikke opdateres.") };
  }
}

export async function invalidateAttemptAction(id: string, reason: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("invalidate_attempt", {
      attempt: uuidSchema.parse(id),
      reason,
    });
    if (error) throw error;
    revalidatePath("/admin");
    revalidatePath("/rangliste");
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Tiden kunne ikke fjernes.") };
  }
}

export async function deleteUserAction(userId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (userId === admin.id) return { ok: false, error: "Du kan ikke slette din egen adminbruger." };

  try {
    const id = uuidSchema.parse(userId);
    const service = createSupabaseAdminClient();

    async function removeFolder(folder: string): Promise<void> {
      while (true) {
        const { data: objects, error: listError } = await service.storage
          .from("avatars")
          .list(folder, { limit: 100, offset: 0 });
        if (listError) throw listError;
        if (!objects?.length) return;

        const files = objects.filter((object) => object.id).map((object) => `${folder}/${object.name}`);
        const folders = objects.filter((object) => !object.id);
        for (const child of folders) await removeFolder(`${folder}/${child.name}`);
        if (files.length) {
          const { error: removeError } = await service.storage.from("avatars").remove(files);
          if (removeError) throw removeError;
        }
        if (objects.length < 100) return;
      }
    }

    await removeFolder(id);
    const { error } = await service.auth.admin.deleteUser(id);
    if (error) throw error;

    revalidatePath("/admin");
    revalidatePath("/rangliste");
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Brugeren kunne ikke slettes.") };
  }
}

export async function resetUserPasswordAction(
  userId: string,
  rawPassword: string,
): Promise<ActionResult> {
  await requireAdmin();
  try {
    const id = uuidSchema.parse(userId);
    const password = providerPassword(rawPassword);
    const service = createSupabaseAdminClient();
    const { error } = await service.auth.admin.updateUserById(id, { password });
    if (error) throw error;
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Adgangskoden kunne ikke nulstilles.") };
  }
}
