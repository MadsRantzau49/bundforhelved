"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { otpSchema, usernameSchema, uuidSchema } from "@/lib/validation";
import type {
  ActionResult,
  GuestAccess,
  GuestRequestStart,
  TimerPlayer,
} from "@/types/app";

function firstRow<T>(data: unknown) {
  return (Array.isArray(data) ? data[0] : data) as T | undefined;
}

export async function requestGuestAccess(usernameValue: string): Promise<ActionResult<GuestRequestStart>> {
  try {
    const target_username = usernameSchema.parse(usernameValue);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("request_guest_access", { target_username });
    if (error) throw error;
    const request = firstRow<GuestRequestStart>(data);
    if (!request) throw new Error("Guest request was not returned");
    revalidatePath("/profil");
    return { ok: true, data: request };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Gæsteanmodningen kunne ikke sendes.") };
  }
}

export async function issueGuestOtp(requestId: string): Promise<ActionResult<string>> {
  try {
    const request = uuidSchema.parse(requestId);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("issue_guest_otp", { request });
    if (error) throw error;
    revalidatePath("/profil");
    return { ok: true, data: data as string };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Gæstekoden kunne ikke oprettes.") };
  }
}

export async function redeemGuestAccess(
  requestId: string,
  otpValue: string,
): Promise<ActionResult<TimerPlayer>> {
  try {
    const request = uuidSchema.parse(requestId);
    const otp = otpSchema.parse(otpValue);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("redeem_guest_access", { request, otp });
    if (error) throw error;
    const redemption = firstRow<{
      success: boolean;
      error_message: string | null;
      player_id: string | null;
      username: string | null;
      avatar_path: string | null;
    }>(data);
    if (!redemption?.success || !redemption.player_id) {
      return { ok: false, error: redemption?.error_message ?? "Koden kunne ikke godkendes." };
    }

    revalidatePath("/timer");
    revalidatePath("/profil");
    const { data: playersData, error: playersError } = await supabase.rpc("get_timer_players");
    if (playersError) {
      return {
        ok: true,
        data: {
          player_id: redemption.player_id,
          username: redemption.username ?? "gæst",
          avatar_path: redemption.avatar_path,
          is_host: false,
          clans: [],
          needs_refresh: true,
        },
      };
    }
    const player = ((playersData ?? []) as TimerPlayer[]).find(
      (item) => item.player_id === redemption.player_id,
    );
    const resolvedPlayer = player ?? {
      player_id: redemption.player_id,
      username: redemption.username ?? "gæst",
      avatar_path: redemption.avatar_path,
      is_host: false,
      clans: [],
    };

    return { ok: true, data: resolvedPlayer };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Gæstekoden kunne ikke godkendes.") };
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
