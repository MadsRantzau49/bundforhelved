"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { deliverPendingPushNotifications } from "@/lib/notifications/push";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation";
import type { ActionResult, Attempt, StartedAttempt } from "@/types/app";

async function attemptRpc(
  functionName: "start_attempt" | "stop_attempt" | "confirm_attempt" | "decline_attempt",
  key: "category" | "attempt",
  value: string,
): Promise<ActionResult<Attempt>> {
  try {
    const id = uuidSchema.parse(value);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc(functionName, { [key]: id });
    if (error) throw error;
    if (functionName === "confirm_attempt") {
      revalidatePath("/rangliste");
      revalidatePath("/profil");
      revalidatePath("/peer-review");
      revalidatePath("/venner");
      revalidatePath("/admin");
      await deliverPendingPushNotifications();
    }
    return { ok: true, data: data as Attempt };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Forsøget kunne ikke gemmes.") };
  }
}

export async function startAttempt(
  categoryId: string,
  clanId: string | null,
  playerId: string,
): Promise<ActionResult<StartedAttempt>> {
  try {
    const category = uuidSchema.parse(categoryId);
    const clan = clanId ? uuidSchema.parse(clanId) : null;
    const player = uuidSchema.parse(playerId);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("start_attempt", { category, clan, player });
    if (error) throw error;
    const attempt = data as Attempt;
    const elapsedResult = await supabase.rpc("get_attempt_live_elapsed", { attempt: attempt.id });
    return {
      ok: true,
      data: {
        attempt,
        live_elapsed_ms: elapsedResult.error ? 0 : Number(elapsedResult.data ?? 0),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: errorMessage(error, "Forsøget kunne ikke startes."),
    };
  }
}

export async function syncAttemptElapsed(attemptId: string): Promise<ActionResult<number>> {
  try {
    const attempt = uuidSchema.parse(attemptId);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_attempt_live_elapsed", { attempt });
    if (error) throw error;
    return { ok: true, data: Number(data ?? 0) };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Timeren kunne ikke synkroniseres.") };
  }
}

export async function stopAttempt(attemptId: string) {
  return attemptRpc("stop_attempt", "attempt", attemptId);
}

export async function confirmAttempt(attemptId: string) {
  return attemptRpc("confirm_attempt", "attempt", attemptId);
}

export async function declineAttempt(attemptId: string) {
  return attemptRpc("decline_attempt", "attempt", attemptId);
}

export async function reassignAttempt(attemptId: string, playerId: string): Promise<ActionResult<Attempt>> {
  try {
    const attempt = uuidSchema.parse(attemptId);
    const new_player = uuidSchema.parse(playerId);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("reassign_attempt", { attempt, new_player });
    if (error) throw error;
    revalidatePath("/timer");
    revalidatePath("/profil");
    return { ok: true, data: data as Attempt };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Spilleren kunne ikke ændres.") };
  }
}

export async function changeAttemptScope(
  attemptId: string,
  clanId: string | null,
): Promise<ActionResult<Attempt>> {
  try {
    const attempt = uuidSchema.parse(attemptId);
    const clan = clanId ? uuidSchema.parse(clanId) : null;
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("change_attempt_scope", { attempt, clan });
    if (error) throw error;
    revalidatePath("/timer");
    return { ok: true, data: data as Attempt };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Ranglisten kunne ikke ændres.") };
  }
}

export async function changeAttemptCategory(
  attemptId: string,
  categoryId: string,
): Promise<ActionResult<Attempt>> {
  try {
    const attempt = uuidSchema.parse(attemptId);
    const category = uuidSchema.parse(categoryId);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("change_attempt_category", { attempt, category });
    if (error) throw error;
    revalidatePath("/timer");
    return { ok: true, data: data as Attempt };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Kategorien kunne ikke ændres.") };
  }
}

const evidenceExtensions: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

export async function uploadAttemptEvidence(
  attemptId: string,
  formData: FormData,
): Promise<ActionResult<Attempt>> {
  const file = formData.get("video");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Videoen er tom." };
  if (file.size > 45 * 1024 * 1024) return { ok: false, error: "Videoen må højst fylde 45 MB." };
  const extension = evidenceExtensions[file.type];
  if (!extension) return { ok: false, error: "Videoformatet understøttes ikke." };

  try {
    const attempt = uuidSchema.parse(attemptId);
    const path = `${attempt}/evidence-${Date.now()}.${extension}`;
    const supabase = await createSupabaseServerClient();
    const { error: uploadError } = await supabase.storage.from("attempt-videos").upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (uploadError) throw uploadError;
    const { data, error } = await supabase.rpc("set_attempt_evidence", { attempt, path });
    if (error) {
      await supabase.storage.from("attempt-videos").remove([path]);
      throw error;
    }
    return { ok: true, data: data as Attempt };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Videoen kunne ikke gemmes.") };
  }
}
