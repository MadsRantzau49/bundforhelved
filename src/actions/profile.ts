"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/session";
import { getErrorText } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formString, usernameSchema } from "@/lib/validation";
import type { FormState } from "@/types/app";

export async function changeUsernameAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireProfile();

  try {
    const requestedUsername = usernameSchema.parse(formString(formData, "username"));
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("set_own_username", {
      requested_username: requestedUsername,
    });
    if (error) {
      if (error.code === "23505") return { error: "Brugernavnet er allerede taget." };
      throw error;
    }

    revalidatePath("/", "layout");
    return { success: "Brugernavnet er opdateret." };
  } catch (error) {
    const message = getErrorText(error);
    return { error: message.startsWith("[") ? "Brugernavnet er ugyldigt." : message };
  }
}

export async function uploadAvatarAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const profile = await requireProfile();
  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) return { error: "Vælg et billede." };
  if (!file.type.startsWith("image/")) return { error: "Filen skal være et billede." };

  const supabase = await createSupabaseServerClient();
  const path = `${profile.id}/avatar-${Date.now()}`;
  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) return { error: "Billedet kunne ikke uploades." };

  const { error: profileError } = await supabase.rpc("set_own_avatar", { path });
  if (profileError) {
    await supabase.storage.from("avatars").remove([path]);
    return { error: "Profilbilledet kunne ikke gemmes." };
  }

  if (profile.avatar_path) {
    await supabase.storage.from("avatars").remove([profile.avatar_path]);
  }

    revalidatePath("/profil");
    revalidatePath("/indstillinger");
  revalidatePath("/rangliste");
  return { success: "Profilbilledet er opdateret." };
}
