/**
 * Which database to use, from the server's environment: DATABASE_URL, else POSTGRES_URL (what the
 * Supabase and Neon Vercel integrations set). Query parameters Postgres itself would reject (the
 * integrations add things like `supa=base-pooler.x`) are dropped; `sslmode` becomes the driver's
 * `ssl` option, and Supabase hosts always use TLS.
 */
export function databaseConfig(env: Record<string, string | undefined>): { url: string; ssl: "require" | false | undefined } | null {
  const raw = env.DATABASE_URL || env.POSTGRES_URL;
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { url: raw, ssl: undefined };
  }
  const mode = u.searchParams.get("sslmode");
  u.search = "";
  const local = ["localhost", "127.0.0.1", "::1"].includes(u.hostname);
  const ssl = mode === "disable" ? false : mode || /supabase\.(co|com)$/.test(u.hostname) ? "require" : local ? false : undefined;
  return { url: u.toString(), ssl };
}
