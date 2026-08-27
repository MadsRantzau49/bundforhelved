import { AppShell } from "@/components/app-shell";
import { SetupRequired } from "@/components/setup-required";
import { requireProfile } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SocialBadges, SocialNotification } from "@/types/app";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) return <SetupRequired />;
  const profile = await requireProfile();
  const supabase = await createSupabaseServerClient();
  const [badgesResult, notificationsResult] = await Promise.all([
    supabase.rpc("get_social_badges"),
    supabase.rpc("list_notifications", { max_items: 50 }),
  ]);
  const badges = (badgesResult.error ? null : badgesResult.data) as SocialBadges | null;
  const notifications = (notificationsResult.error ? [] : notificationsResult.data ?? []) as SocialNotification[];
  return (
    <AppShell
      profile={profile}
      badges={badges ?? { friend_requests: 0, peer_reviews: 0, notifications: 0 }}
      notifications={notifications}
    >
      {children}
    </AppShell>
  );
}
