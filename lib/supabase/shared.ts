function readEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function requireEnv(name: string, fallbackName?: string) {
  const value = readEnv(name) ?? (fallbackName ? readEnv(fallbackName) : undefined);

  if (!value) {
    throw new Error(
      fallbackName
        ? `Missing required environment variable: ${name} (or legacy ${fallbackName})`
        : `Missing required environment variable: ${name}`
    );
  }

  return value;
}

export function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? requireEnv("SUPABASE_URL");
}

export function getSupabasePublishableKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? requireEnv("SUPABASE_ANON_KEY");
}
