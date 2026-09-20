"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireProfile } from "@/lib/auth/session";
import { getErrorText } from "@/lib/errors";
import { deliverPendingPushNotifications } from "@/lib/notifications/push";
import { getPeerReviewPage } from "@/lib/peer-reviews";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation";
import type { ActionResult, PeerReviewPage } from "@/types/app";

export async function listPeerReviewAttemptsAction(
  cursor: PeerReviewPage["nextCursor"],
): Promise<ActionResult<PeerReviewPage>> {
  await requireProfile();
  if (cursor && (!uuidSchema.safeParse(cursor.id).success || !Number.isFinite(Date.parse(cursor.submittedAt)))) {
    return { ok: false, error: "Siden er ugyldig." };
  }
  try {
    return { ok: true, data: await getPeerReviewPage(cursor) };
  } catch {
    return { ok: false, error: "Flere tider kunne ikke hentes." };
  }
}

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
    revalidatePath("/peer-review");
    revalidatePath("/rangliste");
    revalidatePath("/profil");
    revalidatePath("/admin");
    if (approve) after(() => deliverPendingPushNotifications());
    return { ok: true, data: undefined };
  } catch (error) {
    const message = getErrorText(error).toLowerCase();
    if (message.includes("accepted friendship")) return { ok: false, error: "I skal være venner, før du kan bedømme tiden." };
    if (message.includes("different account")) return { ok: false, error: "En anden bruger skal bedømme tiden." };
    if (message.includes("not pending")) return { ok: false, error: "Tiden er allerede blevet bedømt." };
    return { ok: false, error: "Tiden kunne ikke bedømmes. Prøv igen." };
  }
}
