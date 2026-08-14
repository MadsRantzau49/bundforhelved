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
    const inviteCode = formString(formData, "inviteCode").trim().toLowerCase();
    if (!/^[0-9a-f]{24}$/.test(inviteCode)) return { error: "Koden skal være 24 tegn." };
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
