import "server-only";

import webpush, { type PushSubscription as WebPushSubscription } from "web-push";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type PendingNotification = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  url: string;
};

type StoredSubscription = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

export async function deliverPendingPushNotifications(userIds?: string[]) {
  try {
    if (!configureWebPush() || userIds?.length === 0) return;
    const admin = createSupabaseAdminClient();
    let notificationQuery = admin
      .from("notifications")
      .select("id, user_id, type, title, body, url")
      .is("push_sent_at", null)
      .order("created_at", { ascending: false })
      .limit(100);
    if (userIds) notificationQuery = notificationQuery.in("user_id", [...new Set(userIds)]);

    const { data: notificationData, error: notificationError } = await notificationQuery;
    if (notificationError || !notificationData?.length) return;
    const notifications = notificationData as PendingNotification[];
    const recipientIds = [...new Set(notifications.map((notification) => notification.user_id))];
    const { data: subscriptionData, error: subscriptionError } = await admin
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", recipientIds);
    if (subscriptionError) return;
    const subscriptionsByUser = new Map<string, StoredSubscription[]>();
    for (const subscription of (subscriptionData ?? []) as StoredSubscription[]) {
      const subscriptions = subscriptionsByUser.get(subscription.user_id) ?? [];
      subscriptions.push(subscription);
      subscriptionsByUser.set(subscription.user_id, subscriptions);
    }
    const deliveredIds: string[] = [];
    const staleSubscriptionIds = new Set<string>();

    for (let from = 0; from < notifications.length; from += 10) {
      const batch = notifications.slice(from, from + 10);
      await Promise.all(batch.map(async (notification) => {
      const recipientSubscriptions = subscriptionsByUser.get(notification.user_id) ?? [];
      let delivered = recipientSubscriptions.length === 0;
      let retryNeeded = false;

      await Promise.all(recipientSubscriptions.map(async (subscription) => {
        const pushSubscription: WebPushSubscription = {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        };
        try {
          await webpush.sendNotification(pushSubscription, JSON.stringify({
            title: notification.title,
            body: notification.body,
            url: notification.type === "peer_review_ping" ? "/peer-review" : notification.url,
            tag: notification.id,
          }), { TTL: 60 * 60 * 24, timeout: 10_000 });
          delivered = true;
        } catch (error) {
          const statusCode = typeof error === "object" && error && "statusCode" in error
            ? Number(error.statusCode)
            : 0;
          if (statusCode === 404 || statusCode === 410) {
            staleSubscriptionIds.add(subscription.id);
          } else {
            retryNeeded = true;
          }
        }
      }));

      if (delivered || !retryNeeded) {
        deliveredIds.push(notification.id);
      }
      }));
    }

    if (staleSubscriptionIds.size) {
      await admin.from("push_subscriptions").delete().in("id", [...staleSubscriptionIds]);
    }
    if (deliveredIds.length) {
      await admin
        .from("notifications")
        .update({ push_sent_at: new Date().toISOString() })
        .in("id", deliveredIds)
        .is("push_sent_at", null);
    }
  } catch {
    // Push delivery is best-effort; the persistent in-app notification remains available.
  }
}
