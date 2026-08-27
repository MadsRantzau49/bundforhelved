"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/session";
import { getErrorText } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { usernameSchema, uuidSchema } from "@/lib/validation";
import type { ActionResult } from "@/types/app";

function refreshFriendPages() {
  revalidatePath("/venner");
  revalidatePath("/rangliste");
  revalidatePath("/peer-review");
}

function friendError(error: unknown, fallback: string) {
  const message = getErrorText(error).toLowerCase();
  if (message.includes("friend user not found")) return "Brugeren findes ikke.";
  if (message.includes("cannot add yourself")) return "Du kan ikke tilføje dig selv.";
  if (message.includes("already friends")) return "I er allerede venner.";
  if (message.includes("incoming friend request")) return "Brugeren har allerede sendt dig en anmodning. Du kan svare nedenfor.";
  if (message.includes("friend request already exists")) return "Anmodningen er allerede sendt.";
  if (message.includes("friend request rate limit")) return "Du har for mange åbne anmodninger. Annuller nogle og prøv igen.";
  if (message.includes("friend request not found") || message.includes("friendship not found")) {
    return "Anmodningen findes ikke længere.";
  }
  return fallback;
}

export async function sendFriendRequestAction(usernameValue: string): Promise<ActionResult> {
  await requireProfile();
  try {
    const target_username = usernameSchema.parse(usernameValue);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("request_friend", { target_username });
    if (error) throw error;
    refreshFriendPages();
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: friendError(error, "Venneanmodningen kunne ikke sendes.") };
  }
}

export async function respondFriendRequestAction(
  friendshipId: string,
  accept: boolean,
): Promise<ActionResult> {
  await requireProfile();
  try {
    const friendship = uuidSchema.parse(friendshipId);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("respond_friend_request", { friendship, accept });
    if (error) throw error;
    refreshFriendPages();
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: friendError(error, "Venneanmodningen kunne ikke besvares.") };
  }
}

export async function removeFriendAction(friendshipId: string): Promise<ActionResult> {
  await requireProfile();
  try {
    const friendship = uuidSchema.parse(friendshipId);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("remove_friend", { friendship });
    if (error) throw error;
    refreshFriendPages();
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: friendError(error, "Vennen kunne ikke fjernes.") };
  }
}
