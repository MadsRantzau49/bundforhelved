"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/session";
import { errorMessage } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { clanNameSchema, formString, uuidSchema } from "@/lib/validation";
import type { ActionResult, Clan, FormState } from "@/types/app";

export async function createClanAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireProfile();
  try {
    const name = clanNameSchema.parse(formString(formData, "name"));
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("create_clan", { name });
    if (error) throw error;
    revalidatePath("/klaner");
    revalidatePath("/rangliste");
    revalidatePath("/timer");
    return { success: `Klanen ${name} er oprettet.` };
  } catch (error) {
    return { error: errorMessage(error, "Klanen kunne ikke oprettes.") };
  }
}

export async function joinClanAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireProfile();
  try {
    const inviteCode = formString(formData, "inviteCode").trim();
    if (!/^\d{6}$/.test(inviteCode)) return { error: "Koden skal være seks cifre." };
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("join_clan", { invite_code: inviteCode });
    if (error) throw error;
    revalidatePath("/klaner");
    revalidatePath("/rangliste");
    revalidatePath("/timer");
    return { success: `Du er nu med i ${(data as Clan).name}.` };
  } catch (error) {
    return { error: errorMessage(error, "Du kunne ikke tilmelde dig klanen.") };
  }
}

async function clanRpc<T = unknown>(
  functionName: string,
  args: Record<string, string>,
): Promise<ActionResult<T>> {
  await requireProfile();
  try {
    Object.values(args).forEach((value) => {
      if (value.includes("-")) uuidSchema.parse(value);
    });
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc(functionName, args);
    if (error) throw error;
    revalidatePath("/klaner");
    revalidatePath("/rangliste");
    revalidatePath("/timer");
    if (args.clan) revalidatePath(`/klaner/${args.clan}`);
    return { ok: true, data: data as T };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Handlingen kunne ikke gennemføres.") };
  }
}

export async function leaveClanAction(clanId: string) {
  return clanRpc("leave_clan", { clan: clanId });
}

export async function regenerateCodeAction(clanId: string): Promise<ActionResult<string>> {
  return clanRpc<string>("regenerate_clan_code", { clan: clanId });
}

export async function removeClanMemberAction(clanId: string, userId: string) {
  return clanRpc("remove_clan_member", { clan: clanId, user: userId });
}

export async function transferClanAction(clanId: string, userId: string) {
  return clanRpc("transfer_clan", { clan: clanId, new_owner: userId });
}

export async function addFriendToClanAction(clanId: string, friendId: string) {
  return clanRpc("add_friend_to_clan", { clan: clanId, friend: friendId });
}

export async function updateClanAction(
  clanId: string,
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireProfile();
  const file = formData.get("image");
  let uploadedPath: string | undefined;

  try {
    const id = uuidSchema.parse(clanId);
    const name = clanNameSchema.parse(formString(formData, "name"));
    const currentImagePath = formString(formData, "currentImagePath") || null;
    if (file instanceof File && file.size > 0 && !file.type.startsWith("image/")) {
      return { error: "Filen skal være et billede." };
    }

    const supabase = await createSupabaseServerClient();
    let imagePath = currentImagePath;
    if (file instanceof File && file.size > 0) {
      uploadedPath = `${id}/image-${Date.now()}`;
      const { error: uploadError } = await supabase.storage
        .from("clan-images")
        .upload(uploadedPath, file, { contentType: file.type, upsert: false });
      if (uploadError) return { error: "Billedet kunne ikke uploades." };
      imagePath = uploadedPath;
    }

    const { error } = await supabase.rpc("update_clan_details", {
      clan: id,
      name,
      image_path: imagePath,
    });
    if (error) throw error;

    if (uploadedPath && currentImagePath) {
      await supabase.storage.from("clan-images").remove([currentImagePath]);
    }

    revalidatePath("/klaner");
    revalidatePath(`/klaner/${id}`);
    revalidatePath("/rangliste");
    revalidatePath("/timer");
    return { success: "Klanen er opdateret." };
  } catch (error) {
    if (uploadedPath) {
      const supabase = await createSupabaseServerClient();
      await supabase.storage.from("clan-images").remove([uploadedPath]);
    }
    return { error: errorMessage(error, "Klanen kunne ikke opdateres.") };
  }
}

export async function deleteClanAction(clanId: string): Promise<ActionResult> {
  const profile = await requireProfile();
  try {
    const id = uuidSchema.parse(clanId);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("clans")
      .delete()
      .eq("id", id)
      .eq("created_by", profile.id)
      .select("id")
      .single();
    if (error) throw error;
    revalidatePath("/klaner");
    revalidatePath("/rangliste");
    revalidatePath("/timer");
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Klanen kunne ikke slettes.") };
  }
}
