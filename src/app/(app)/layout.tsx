import { AppShell } from "@/components/app-shell";
import { SetupRequired } from "@/components/setup-required";
import { requireProfile } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/env";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) return <SetupRequired />;
  const profile = await requireProfile();
  return <AppShell profile={profile}>{children}</AppShell>;
}
