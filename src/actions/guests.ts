"use server";

import { revalidatePath } from "next/cache";
import {
  authenticateCredentials,
  clearCredentialAttempts,
  consumeCredentialAttempt,
  InvalidCredentialsError,
} from "@/lib/auth/credentials";
import { requireProfile } from "@/lib/auth/session";
import { errorMessage, getErrorText } from "@/lib/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { usernameSchema, uuidSchema } from "@/lib/validation";
import type { ActionResult, GuestAccess, TimerPlayer } from "@/types/app";

export async function connectGuestAccess(
  usernameValue: string,
  passwordValue: string,
): Promise<ActionResult<TimerPlayer>> {
  const profile = await requireProfile();

  try {
    const username = usernameSchema.parse(usernameValue);
    const throttle = await consumeCredentialAttempt(username);
    const guest = await authenticateCredentials(username, passwordValue);
    await clearCredentialAttempts(throttle);
    if (guest.id === profile.id) return { ok: false, error: "Du kan ikke tilføje dig selv som gæst." };

    const service = createSupabaseAdminClient();
    const { error: accessError } = await service.from("guest_access").upsert({
      operator_id: profile.id,
      guest_id: guest.id,
      request_id: null,
      granted_at: new Date().toISOString(),
      revoked_at: null,
    }, { onConflict: "operator_id,guest_id" });
    if (accessError) throw accessError;
    const supabase = await createSupabaseServerClient();
    revalidatePath("/timer");
    revalidatePath("/profil");
    const { data: playersData, error: playersError } = await supabase.rpc("get_timer_players");
    if (playersError) {
      return {
        ok: true,
        data: {
          player_id: guest.id,
          username: guest.username,
          avatar_path: null,
          is_host: false,
          clans: [],
          needs_refresh: true,
        },
      };
    }
    const player = ((playersData ?? []) as TimerPlayer[]).find(
      (item) => item.player_id === guest.id,
    );
    const resolvedPlayer = player ?? {
      player_id: guest.id,
      username: guest.username,
      avatar_path: null,
      is_host: false,
      clans: [],
    };

    return { ok: true, data: resolvedPlayer };
  } catch (error) {
    if (error instanceof InvalidCredentialsError) {
      return { ok: false, error: "Forkert brugernavn eller adgangskode." };
    }
    if (getErrorText(error).toLowerCase().includes("rate limit")) {
      return { ok: false, error: "For mange forsøg. Vent 15 minutter og prøv igen." };
    }
    return { ok: false, error: errorMessage(error, "Gæsten kunne ikke tilføjes.") };
  }
}

export async function revokeGuestAccess(
  otherUserId: string,
  direction: GuestAccess["direction"],
): Promise<ActionResult> {
  try {
    const other_user = uuidSchema.parse(otherUserId);
    const access_direction = direction === "guest" ? "guest" : "operator";
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("revoke_guest_access", { other_user, access_direction });
    if (error) throw error;
    revalidatePath("/timer");
    revalidatePath("/profil");
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Gæsteadgangen kunne ikke fjernes.") };
  }
}
