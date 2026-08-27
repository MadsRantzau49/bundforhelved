"use server";

import { z } from "zod";
import { requireProfile } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation";
import type { ActionResult, FormState } from "@/types/app";

const pushEndpointSchema = z.url().max(2048).refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && (
    [
      "fcm.googleapis.com",
      "android.googleapis.com",
      "updates.push.services.mozilla.com",
      "push.services.mozilla.com",
      "web.push.apple.com",
    ].includes(url.hostname)
    || url.hostname.endsWith(".notify.windows.com")
  );
}, "Push-tjenesten understøttes ikke.");

const subscriptionSchema = z.object({
  endpoint: pushEndpointSchema,
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(256),
  }),
});

export async function enablePushNotificationsAction(value: unknown): Promise<ActionResult> {
  await requireProfile();
  try {
    const subscription = subscriptionSchema.parse(value);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("upsert_push_subscription", {
      subscription_endpoint: subscription.endpoint,
      subscription_p256dh: subscription.keys.p256dh,
      subscription_auth: subscription.keys.auth,
      subscription_user_agent: null,
    });
    if (error) throw error;
    return { ok: true, data: undefined };
  } catch {
    return { ok: false, error: "Notifikationer kunne ikke aktiveres." };
  }
}

export async function disablePushNotificationsAction(endpointValue: string): Promise<ActionResult> {
  await requireProfile();
  try {
    const endpoint = z.url().max(2048).parse(endpointValue);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("remove_push_subscription", {
      subscription_endpoint: endpoint,
    });
    if (error) throw error;
    return { ok: true, data: undefined };
  } catch {
    return { ok: false, error: "Notifikationer kunne ikke deaktiveres." };
  }
}

export async function markNotificationsReadAction(ids?: string[]): Promise<ActionResult> {
  await requireProfile();
  try {
    const notification_ids = ids === undefined ? null : z.array(uuidSchema).max(50).parse(ids);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("mark_notifications_read", { notification_ids });
    if (error) throw error;
    return { ok: true, data: undefined };
  } catch {
    return { ok: false, error: "Notifikationerne kunne ikke markeres som læst." };
  }
}

export async function deleteAllNotificationsAction(): Promise<ActionResult> {
  await requireProfile();
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("delete_all_notifications");
    if (error) throw error;
    return { ok: true, data: undefined };
  } catch {
    return { ok: false, error: "Notifikationerne kunne ikke fjernes." };
  }
}

export async function updateNotificationPreferencesAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireProfile();
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("set_notification_preferences", {
      receive_friends_top_three: formData.get("friends_top_three") === "on",
      receive_peer_review_pings: formData.get("peer_review_pings") === "on",
      receive_friend_requests: formData.get("friend_requests") === "on",
    });
    if (error) throw error;
    return { success: "Notifikationsindstillingerne er gemt." };
  } catch {
    return { error: "Notifikationsindstillingerne kunne ikke gemmes." };
  }
}
