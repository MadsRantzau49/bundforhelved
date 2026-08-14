"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FormState } from "@/types/app";

const ALLOWED_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export async function uploadAvatarAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const profile = await requireProfile();
  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) return { error: "Vælg et billede." };
  if (file.size > 2 * 1024 * 1024) return { error: "Billedet må højst fylde 2 MB." };

  const extension = ALLOWED_TYPES.get(file.type);
  if (!extension) return { error: "Brug JPG, PNG eller WebP." };

  const supabase = await createSupabaseServerClient();
  const path = `${profile.id}/avatar-${Date.now()}.${extension}`;
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
  revalidatePath("/rangliste");
  return { success: "Profilbilledet er opdateret." };
}
