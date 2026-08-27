"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { providerPassword } from "@/lib/auth/credentials";
import { errorMessage } from "@/lib/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { deliverPendingPushNotifications } from "@/lib/notifications/push";
import { achievementDefinitions } from "@/lib/achievements";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formString, uuidSchema } from "@/lib/validation";
import type { ActionResult, FormState } from "@/types/app";

const colorPattern = /^#[0-9A-Fa-f]{6}$/;
const iconPattern = /^[a-z0-9][a-z0-9_-]{0,49}$/;
const maxMediaBytes = 45 * 1024 * 1024;
const mediaExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};
const achievementKeys = new Set(achievementDefinitions.map((achievement) => achievement.key));

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

export async function updateCategoryAction(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const id = uuidSchema.safeParse(formString(formData, "id"));
  const name = formString(formData, "name").trim();
  const iconKey = formString(formData, "iconKey").trim();
  const accentColor = formString(formData, "accentColor").trim();
  const description = formString(formData, "description").trim();
  const guideText = formString(formData, "guideText").trim();
  if (!id.success) return { ok: false, error: "Kategorien er ugyldig." };
  if (!name || name.length > 80) return { ok: false, error: "Skriv et kategorinavn på højst 80 tegn." };
  if (!iconPattern.test(iconKey)) return { ok: false, error: "Vælg et gyldigt ikon." };
  if (!colorPattern.test(accentColor)) return { ok: false, error: "Vælg en gyldig farve." };
  if (description.length > 160) return { ok: false, error: "Beskrivelsen må højst være 160 tegn." };
  if (guideText.length > 50_000) return { ok: false, error: "Guideteksten er for lang." };

  try {
    const supabase = await createSupabaseServerClient();
    const { data: current, error: readError } = await supabase
      .from("categories")
      .select("image_path, guide_video_path, demo_video_path")
      .eq("id", id.data)
      .single();
    if (readError || !current) throw readError ?? new Error("Category not found");

    const nextPaths = {
      image_path: formData.get("removeImage") === "on" ? null : current.image_path,
      guide_video_path: formData.get("removeGuideVideo") === "on" ? null : current.guide_video_path,
      demo_video_path: formData.get("removeDemoVideo") === "on" ? null : current.demo_video_path,
    };
    const uploaded: string[] = [];
    const uploads = [
      ["image", "image", "image_path"],
      ["guideVideo", "guide", "guide_video_path"],
      ["demoVideo", "demo", "demo_video_path"],
    ] as const;

    for (const [field, kind, column] of uploads) {
      const file = formData.get(field);
      if (!(file instanceof File) || file.size === 0) continue;
      const extension = mediaExtensions[file.type];
      const expectedKind = kind === "image" ? "image/" : "video/";
      if (!extension || !file.type.startsWith(expectedKind)) {
        await supabase.storage.from("category-media").remove(uploaded);
        return { ok: false, error: `${kind === "image" ? "Billedet" : "Videoen"} har et format, der ikke understøttes.` };
      }
      if (file.size > maxMediaBytes) {
        await supabase.storage.from("category-media").remove(uploaded);
        return { ok: false, error: "Hver mediefil må højst fylde 45 MB." };
      }
      const path = `${id.data}/${kind}-${Date.now()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from("category-media").upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (uploadError) {
        await supabase.storage.from("category-media").remove(uploaded);
        throw uploadError;
      }
      uploaded.push(path);
      nextPaths[column] = path;
    }

    const { error } = await supabase.from("categories").update({
      name,
      icon_key: iconKey,
      accent_color: accentColor,
      description,
      guide_text: guideText,
      ...nextPaths,
    }).eq("id", id.data).select("id").single();
    if (error) {
      await supabase.storage.from("category-media").remove(uploaded);
      throw error;
    }

    const replaced = [current.image_path, current.guide_video_path, current.demo_video_path]
      .filter((path): path is string => Boolean(path) && !Object.values(nextPaths).includes(path));
    if (replaced.length) await supabase.storage.from("category-media").remove(replaced);
    revalidatePath("/admin");
    revalidatePath("/timer");
    revalidatePath("/guide");
    revalidatePath("/rangliste");
    revalidatePath("/profil");
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Kategorien kunne ikke gemmes.") };
  }
}

export async function updateAchievementImageAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const key = formString(formData, "key");
  if (!achievementKeys.has(key)) return { ok: false, error: "Bedriften er ugyldig." };

  try {
    const supabase = await createSupabaseServerClient();
    const { data: current, error: readError } = await supabase
      .from("achievement_assets")
      .select("image_path")
      .eq("achievement_key", key)
      .maybeSingle();
    if (readError) throw readError;

    const file = formData.get("image");
    const remove = formData.get("removeImage") === "on";
    let nextPath = remove ? null : current?.image_path ?? null;
    let uploadedPath: string | null = null;

    if (file instanceof File && file.size > 0) {
      const extension = mediaExtensions[file.type];
      if (!extension || !file.type.startsWith("image/")) return { ok: false, error: "Billedets format understøttes ikke." };
      if (file.size > 5 * 1024 * 1024) return { ok: false, error: "Billedet må højst fylde 5 MB." };
      uploadedPath = `${key}/image-${Date.now()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from("achievement-media").upload(uploadedPath, file, {
        contentType: file.type,
        upsert: false,
      });
      if (uploadError) throw uploadError;
      nextPath = uploadedPath;
    }

    const { error } = await supabase.from("achievement_assets").upsert({
      achievement_key: key,
      image_path: nextPath,
      updated_by: admin.id,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      if (uploadedPath) await supabase.storage.from("achievement-media").remove([uploadedPath]);
      throw error;
    }

    if (current?.image_path && current.image_path !== nextPath) {
      await supabase.storage.from("achievement-media").remove([current.image_path]);
    }
    revalidatePath("/admin");
    revalidatePath("/profil");
    revalidatePath("/venner");
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Billedet kunne ikke gemmes.") };
  }
}

export type AdminAttemptUpdateInput = {
  attemptId: string;
  playerId: string;
  categoryId: string;
  clanId: string | null;
  elapsedMs: number;
  valid: boolean | null;
  reason: string;
};

export async function adminUpdateAttemptAction(input: AdminAttemptUpdateInput): Promise<ActionResult> {
  await requireAdmin();
  if (!Number.isSafeInteger(input.elapsedMs) || input.elapsedMs < 0) {
    return { ok: false, error: "Tiden skal være et positivt antal millisekunder." };
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("admin_update_attempt", {
      attempt: uuidSchema.parse(input.attemptId),
      player: uuidSchema.parse(input.playerId),
      category: uuidSchema.parse(input.categoryId),
      clan: input.clanId ? uuidSchema.parse(input.clanId) : null,
      elapsed: input.elapsedMs,
      valid: input.valid,
      reason: input.reason.trim(),
    });
    if (error) throw error;
    revalidatePath("/admin");
    revalidatePath("/timer");
    revalidatePath("/rangliste");
    revalidatePath("/profil");
    revalidatePath("/peer-review");
    revalidatePath("/venner");
    if (input.valid === true) await deliverPendingPushNotifications();
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Tiden kunne ikke opdateres.") };
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

export async function setUserAdminAction(
  userId: string,
  makeAdmin: boolean,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (userId === admin.id) return { ok: false, error: "Du kan ikke ændre din egen adminrolle." };

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("profiles")
      .update({ role: makeAdmin ? "admin" : "user" })
      .eq("id", uuidSchema.parse(userId))
      .select("id")
      .single();
    if (error) throw error;
    revalidatePath("/admin");
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Adminrollen kunne ikke ændres.") };
  }
}
