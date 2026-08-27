"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, Trash2, Trophy, UserPlus, X } from "lucide-react";
import clsx from "clsx";
import { deleteAllNotificationsAction, markNotificationsReadAction } from "@/actions/notifications";
import { Avatar } from "@/components/avatar";
import { formatDate } from "@/lib/format";
import type { SocialNotification } from "@/types/app";

export function NotificationCenter({
  initialNotifications,
  initialUnread,
}: {
  initialNotifications: SocialNotification[];
  initialUnread: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState(initialNotifications);
  const [unread, setUnread] = useState(initialUnread);
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const refresh = () => router.refresh();
    const onWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === "SOCIAL_NOTIFICATION") refresh();
    };
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 60_000);
    navigator.serviceWorker?.addEventListener("message", onWorkerMessage);
    return () => {
      window.clearInterval(interval);
      navigator.serviceWorker?.removeEventListener("message", onWorkerMessage);
    };
  }, [router]);

  function markRead(ids: string[]) {
    if (!ids.length) return;
    setNotifications((current) => current.map((notification) => (
      ids.includes(notification.notification_id)
        ? { ...notification, read_at: notification.read_at ?? new Date().toISOString() }
        : notification
    )));
    setUnread((current) => Math.max(0, current - ids.length));
    startTransition(async () => {
      const result = await markNotificationsReadAction(ids);
      if (!result.ok) setMessage(result.error);
    });
  }

  function markAllRead() {
    setNotifications((current) => current.map((notification) => ({
      ...notification,
      read_at: notification.read_at ?? new Date().toISOString(),
    })));
    setUnread(0);
    startTransition(async () => {
      const result = await markNotificationsReadAction();
      if (!result.ok) setMessage(result.error);
    });
  }

  function deleteAll() {
    const previousNotifications = notifications;
    const previousUnread = unread;
    setNotifications([]);
    setUnread(0);
    setMessage(undefined);
    startTransition(async () => {
      const result = await deleteAllNotificationsAction();
      if (!result.ok) {
        setNotifications(previousNotifications);
        setUnread(previousUnread);
        setMessage(result.error);
      }
    });
  }

  return (
    <div className="notification-center">
      <button
        type="button"
        className="icon-button notification-center__trigger"
        aria-label={unread ? `Notifikationer, ${unread} ulæste` : "Notifikationer"}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Bell aria-hidden="true" />
        {unread > 0 && <span>{unread > 9 ? "9+" : unread}</span>}
      </button>

      {open && (
        <section className="notification-panel" aria-label="Notifikationer">
          <header>
            <div><p className="eyebrow">Det seneste</p><h2>Notifikationer</h2></div>
            <button type="button" className="icon-button" aria-label="Luk notifikationer" onClick={() => setOpen(false)}><X aria-hidden="true" /></button>
          </header>

          {notifications.length > 0 && (
            <div className="notification-panel__actions">
              <button type="button" className="text-button notification-delete-all" disabled={pending} onClick={deleteAll}><Trash2 aria-hidden="true" /> Fjern alle</button>
              {unread > 0 && <button type="button" className="text-button notification-mark-read" disabled={pending} onClick={markAllRead}><CheckCheck aria-hidden="true" /> Markér alle som læst</button>}
            </div>
          )}

          {message && <p className="notification-panel__message" role="status">{message}</p>}

          {notifications.length ? (
            <div className="notification-list">
              {notifications.map((notification) => (
                <Link
                  href={notification.url}
                  className={clsx(!notification.read_at && "is-unread")}
                  key={notification.notification_id}
                  onClick={() => {
                    if (!notification.read_at) markRead([notification.notification_id]);
                    setOpen(false);
                  }}
                >
                  {notification.source_username ? (
                    <Avatar username={notification.source_username} path={notification.source_avatar_path} size="small" />
                  ) : notification.type === "leaderboard_top3" ? <Trophy aria-hidden="true" /> : <UserPlus aria-hidden="true" />}
                  <span><strong>{notification.title}</strong><small>{notification.body}</small><time>{formatDate(notification.created_at)}</time></span>
                </Link>
              ))}
            </div>
          ) : <div className="inline-empty">Ingen notifikationer endnu.</div>}
        </section>
      )}
    </div>
  );
}
