import type { Metadata } from "next";
import { ShieldCheck, TimerReset, UsersRound } from "lucide-react";
import { AdminDashboard } from "@/components/admin-dashboard";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Category, Profile } from "@/types/app";

export const metadata: Metadata = { title: "Administration" };

export default async function AdminPage() {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const [categoriesResult, usersResult, attemptsResult] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name, icon_key, accent_color, description, sort_order, is_active")
      .order("sort_order"),
    supabase
      .from("profiles")
      .select("id, username, avatar_path, role, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("attempts")
      .select("id, elapsed_ms, confirmed_at, status, invalidated_reason, profiles!attempts_user_id_fkey(id, username, avatar_path), categories!inner(id, name, icon_key, accent_color)")
      .in("status", ["approved", "invalidated"])
      .order("confirmed_at", { ascending: false })
      .limit(100),
  ]);

  const categories = (categoriesResult.data ?? []) as Category[];
  const users = (usersResult.data ?? []) as Profile[];
  const attempts = (attemptsResult.data ?? []) as unknown as Parameters<typeof AdminDashboard>[0]["attempts"];

  return (
    <div className="page page--admin">
      <PageHeader
        eyebrow="Kontrolrummet"
        title="Administration"
        description="Hold kategorierne åbne, tavlen ærlig og spillerlisten ren."
        action={<span className="header-admin"><ShieldCheck aria-hidden="true" /></span>}
      />
      <div className="admin-summary">
        <div><span><TimerReset aria-hidden="true" /></span><strong>{attempts.length}</strong><small>seneste tider</small></div>
        <div><span><UsersRound aria-hidden="true" /></span><strong>{users.length}</strong><small>brugere</small></div>
        <div><span><ShieldCheck aria-hidden="true" /></span><strong>{categories.filter((category) => category.is_active).length}</strong><small>aktive kategorier</small></div>
      </div>
      <AdminDashboard categories={categories} users={users} attempts={attempts} currentUserId={admin.id} />
    </div>
  );
}
