import Link from "next/link";
import { Settings, ShieldCheck } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { BottomNav } from "@/components/bottom-nav";
import { Brand } from "@/components/brand";
import { ConnectionStatus } from "@/components/connection-status";
import { NotificationCenter } from "@/components/notification-center";
import type { Profile, SocialBadges, SocialNotification } from "@/types/app";

export function AppShell({
  profile,
  badges,
  notifications,
  children,
}: {
  profile: Profile;
  badges: SocialBadges;
  notifications: SocialNotification[];
  children: React.ReactNode;
}) {
  return (
    <div className="app-shell">
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />
      <header className="top-bar">
        <Brand compact />
        <div className="top-bar__actions">
          <ConnectionStatus />
          <NotificationCenter
            key={`${badges.notifications}:${notifications[0]?.notification_id ?? "empty"}`}
            initialNotifications={notifications}
            initialUnread={badges.notifications}
          />
          <Link href="/indstillinger" className="icon-button" aria-label="Åbn indstillinger">
            <Settings aria-hidden="true" />
          </Link>
          {profile.role === "admin" && (
            <Link href="/admin" className="icon-button" aria-label="Åbn administration">
              <ShieldCheck aria-hidden="true" />
            </Link>
          )}
          <Link href="/profil" aria-label="Åbn profil">
            <Avatar username={profile.username} path={profile.avatar_path} size="small" />
          </Link>
        </div>
      </header>
      <main className="app-main">{children}</main>
      <BottomNav reviewCount={badges.peer_reviews} />
    </div>
  );
}
