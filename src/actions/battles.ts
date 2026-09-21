"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireProfile } from "@/lib/auth/session";
import { loadBattleHistoryPage, loadBattleHub } from "@/lib/battles";
import { errorMessage } from "@/lib/errors";
import { deliverPendingPushNotifications } from "@/lib/notifications/push";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation";
import type { ActionResult, BattleHistoryPage, BattleHub } from "@/types/app";

async function refreshedHub(userId: string): Promise<ActionResult<BattleHub>> {
  try {
    return { ok: true, data: await loadBattleHub(userId) };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Kampen kunne ikke synkroniseres.") };
  }
}

export async function refreshBattleHub(): Promise<ActionResult<BattleHub>> {
  const profile = await requireProfile();
  return refreshedHub(profile.id);
}

export async function loadMoreBattleHistoryAction(before: string): Promise<ActionResult<BattleHistoryPage>> {
  const profile = await requireProfile();
  if (!Number.isFinite(Date.parse(before))) return { ok: false, error: "Kampoversigten kunne ikke indlæses." };
  try {
    return { ok: true, data: await loadBattleHistoryPage(profile.id, before) };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Flere kampe kunne ikke hentes.") };
  }
}

export async function createBattleAction(
  categoryId: string,
  clanId: string | null,
  opponentId: string,
): Promise<ActionResult<BattleHub>> {
  const profile = await requireProfile();
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("create_battle", {
      category: uuidSchema.parse(categoryId),
      clan: clanId ? uuidSchema.parse(clanId) : null,
      opponent: uuidSchema.parse(opponentId),
    });
    if (error) throw error;
    revalidatePath("/battle");
    after(() => deliverPendingPushNotifications());
    return refreshedHub(profile.id);
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Invitationen kunne ikke sendes.") };
  }
}

export async function respondBattleAction(battleId: string, accept: boolean): Promise<ActionResult<BattleHub>> {
  const profile = await requireProfile();
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("respond_battle", { battle: uuidSchema.parse(battleId), accept });
    if (error) throw error;
    revalidatePath("/battle");
    return refreshedHub(profile.id);
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Invitationen kunne ikke besvares.") };
  }
}

export async function startBattleAction(battleId: string): Promise<ActionResult<BattleHub>> {
  const profile = await requireProfile();
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("start_battle", { battle: uuidSchema.parse(battleId) });
    if (error) throw error;
    revalidatePath("/battle");
    return refreshedHub(profile.id);
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Kampen kunne ikke startes.") };
  }
}

export async function cancelBattleAction(battleId: string): Promise<ActionResult<BattleHub>> {
  const profile = await requireProfile();
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("cancel_battle", { battle: uuidSchema.parse(battleId) });
    if (error) throw error;
    revalidatePath("/battle");
    return refreshedHub(profile.id);
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Kampen kunne ikke annulleres.") };
  }
}

export async function stopBattleAction(battleId: string): Promise<ActionResult<BattleHub>> {
  const profile = await requireProfile();
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("stop_battle", { battle: uuidSchema.parse(battleId) });
    if (error) throw error;
    revalidatePath("/battle");
    revalidatePath("/profil");
    revalidatePath("/rangliste");
    revalidatePath("/admin");
    after(() => deliverPendingPushNotifications());
    return refreshedHub(profile.id);
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Kampen kunne ikke stoppes.") };
  }
}

export async function validateBattleTimeAction(battleId: string): Promise<ActionResult<BattleHub>> {
  return reviewBattleTimeAction(battleId, true);
}

export async function reviewBattleTimeAction(battleId: string, approve: boolean): Promise<ActionResult<BattleHub>> {
  const profile = await requireProfile();
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("review_battle_time", { battle: uuidSchema.parse(battleId), approve });
    if (error) throw error;
    revalidatePath("/battle");
    revalidatePath("/profil");
    revalidatePath("/rangliste");
    revalidatePath("/peer-review");
    revalidatePath("/admin");
    if (approve) after(() => deliverPendingPushNotifications());
    return refreshedHub(profile.id);
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Tiden kunne ikke bedømmes.") };
  }
}

export async function declineOwnBattleTimeAction(battleId: string): Promise<ActionResult<BattleHub>> {
  const profile = await requireProfile();
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("decline_own_battle_time", { battle: uuidSchema.parse(battleId) });
    if (error) throw error;
    revalidatePath("/battle");
    revalidatePath("/profil");
    revalidatePath("/rangliste");
    revalidatePath("/peer-review");
    revalidatePath("/admin");
    return refreshedHub(profile.id);
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Din tid kunne ikke afvises.") };
  }
}
