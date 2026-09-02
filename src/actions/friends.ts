"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/session";
import { getErrorText } from "@/lib/errors";
import { deliverPendingPushNotifications } from "@/lib/notifications/push";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { usernameSchema, uuidSchema } from "@/lib/validation";
import type { ActionResult, FriendSearchResult } from "@/types/app";

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

export async function sendFriendRequestAction(usernameValue: string, expectedUserId?: string): Promise<ActionResult> {
  await requireProfile();
  try {
    const target_username = usernameSchema.parse(usernameValue);
    const supabase = await createSupabaseServerClient();
    const targetResult = await supabase
      .from("profiles")
      .select("id")
      .eq("username", target_username)
      .maybeSingle();
    if (expectedUserId && targetResult.data?.id !== uuidSchema.parse(expectedUserId)) {
      return { ok: false, error: "Brugernavnet er ændret. Søg efter personen igen." };
    }
    const { error } = await supabase.rpc("request_friend", { target_username });
    if (error) throw error;
    refreshFriendPages();
    if (targetResult.data?.id) await deliverPendingPushNotifications([targetResult.data.id]);
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: friendError(error, "Venneanmodningen kunne ikke sendes.") };
  }
}

export async function searchFriendProfilesAction(prefixValue: string): Promise<ActionResult<FriendSearchResult[]>> {
  await requireProfile();
  try {
    const prefix = usernameSchema.parse(prefixValue);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("search_friend_profiles", { prefix });
    if (error) throw error;
    return { ok: true, data: (data ?? []) as FriendSearchResult[] };
  } catch {
    return { ok: false, error: "Søgningen kunne ikke gennemføres." };
  }
}

export async function pingFriendForReviewAction(friendId: string): Promise<ActionResult<boolean>> {
  await requireProfile();
  try {
    const friend = uuidSchema.parse(friendId);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("ping_friend_for_review", { friend });
    if (error) throw error;
    if (!data) return { ok: false, error: "Du har allerede pinget denne ven om tiden." };
    await deliverPendingPushNotifications([friend]);
    return { ok: true, data: true };
  } catch (error) {
    const message = getErrorText(error).toLowerCase();
    if (message.includes("no reviewable attempt")) {
      return { ok: false, error: "Du har ingen tid, som denne ven kan peer reviewe." };
    }
    if (message.includes("accepted friendship")) {
      return { ok: false, error: "I skal stadig være venner for at sende et ping." };
    }
    if (message.includes("recipient disabled review pings")) {
      return { ok: false, error: "Denne ven modtager ikke peer review-pings." };
    }
    return { ok: false, error: "Pinget kunne ikke sendes." };
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
