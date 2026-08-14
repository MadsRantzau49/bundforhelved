import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseServerEnv } from "@/lib/env";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 400;

function shouldUseSecureCookies() {
  return process.env.NODE_ENV === "production" && process.env.AUTH_COOKIE_SECURE !== "false";
}

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseServerEnv();

  return createServerClient(url, anonKey, {
    cookieOptions: {
      maxAge: COOKIE_MAX_AGE,
      sameSite: "lax",
      secure: shouldUseSecureCookies(),
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, {
              ...options,
              maxAge: options.maxAge ?? COOKIE_MAX_AGE,
              sameSite: "lax",
              secure: shouldUseSecureCookies(),
            });
          });
        } catch {
          // Server Components cannot set cookies; src/proxy.ts refreshes them.
        }
      },
    },
  });
}
