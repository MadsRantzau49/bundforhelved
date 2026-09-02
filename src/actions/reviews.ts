"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/session";
import { getErrorText } from "@/lib/errors";
import { deliverPendingPushNotifications } from "@/lib/notifications/push";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation";
import type { ActionResult } from "@/types/app";

export async function reviewAttemptAction(
  attemptId: string,
  approve: boolean,
): Promise<ActionResult> {
  await requireProfile();

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("review_attempt", {
      attempt: uuidSchema.parse(attemptId),
      approve,
    });
    if (error) throw error;
    revalidatePath("/venner");
    revalidatePath("/rangliste");
    revalidatePath("/profil");
    revalidatePath("/admin");
    if (approve) await deliverPendingPushNotifications();
    return { ok: true, data: undefined };
  } catch (error) {
    const message = getErrorText(error).toLowerCase();
    if (message.includes("accepted friendship")) return { ok: false, error: "I skal være venner, før du kan bedømme tiden." };
    if (message.includes("different account")) return { ok: false, error: "En anden bruger skal bedømme tiden." };
    if (message.includes("not pending")) return { ok: false, error: "Tiden er allerede blevet bedømt." };
    return { ok: false, error: "Tiden kunne ikke bedømmes. Prøv igen." };
  }
}
