const requiredPublicEnv = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

export function isSupabaseConfigured() {
  return requiredPublicEnv.every((key) => {
    const value = process.env[key];
    return value && !value.includes("your-");
  });
}

export function getSupabasePublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Supabase mangler opsætning. Se .env.example.");
  }

  return { url, anonKey };
}

export function getSupabaseServerEnv() {
  const { url: publicUrl, anonKey } = getSupabasePublicEnv();
  return {
    url: process.env.SUPABASE_INTERNAL_URL || publicUrl,
    anonKey,
  };
}
