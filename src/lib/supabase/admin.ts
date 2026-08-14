import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getSupabaseServerEnv } from "@/lib/env";

export function createSupabaseAdminClient() {
  const { url } = getSupabaseServerEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY mangler.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
