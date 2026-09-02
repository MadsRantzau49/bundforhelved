import type { Metadata } from "next";
import Link from "next/link";
import { Settings, ShieldCheck } from "lucide-react";
import { NotificationSettings } from "@/components/notification-settings";
import { PageHeader } from "@/components/page-header";
import { ProfileGuestAccess } from "@/components/profile-guest-access";
import { AvatarForm, InstallApp, PasswordForm, UsernameForm } from "@/components/profile-forms";
import { PushAwareLogout } from "@/components/push-aware-logout";
import { requireProfile } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { GuestAccess, NotificationPreferences } from "@/types/app";

export const metadata: Metadata = { title: "Indstillinger" };

const defaultPreferences: NotificationPreferences = {
  friends_top_three: true,
  peer_review_pings: true,
  friend_requests: true,
};

export default async function SettingsPage() {
  const profile = await requireProfile();
  const supabase = await createSupabaseServerClient();
  const [accessResult, preferencesResult] = await Promise.all([
    supabase.rpc("list_guest_access"),
    supabase.rpc("get_notification_preferences"),
  ]);

  if (accessResult.error || preferencesResult.error) {
    throw new Error("Indstillingerne kunne ikke hentes.");
  }

  return (
    <div className="page page--settings">
      <PageHeader
        eyebrow="Din konto"
        title="Indstillinger"
        description="Styr notifikationer, enheder og kontooplysninger. Din profilside viser kun dine statistikker."
        action={<span className="header-clan"><Settings aria-hidden="true" /></span>}
      />

      <NotificationSettings
        initialPreferences={(preferencesResult.data as NotificationPreferences | null) ?? defaultPreferences}
        vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null}
      />
      <InstallApp />
      <ProfileGuestAccess initialAccess={(accessResult.data ?? []) as GuestAccess[]} />

      <section className="profile-settings">
        <UsernameForm username={profile.username} />
        <AvatarForm />
        <PasswordForm />
      </section>

      {profile.role === "admin" && (
        <Link href="/admin" className="admin-link-card">
          <ShieldCheck aria-hidden="true" />
          <div><strong>Administration</strong><span>Kategorier, brugere og mistænkelige tider</span></div>
        </Link>
      )}

      <PushAwareLogout />
      <p className="responsible-note">Kun for 18+. Drik med omtanke.</p>
    </div>
  );
}
