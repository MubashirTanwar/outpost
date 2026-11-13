import "server-only";
import postgres from "postgres";

/**
 * Postgres for everything the app saves (reviews, pasted games, puzzles, progress, day overviews).
 * Set DATABASE_URL on the server; without it the app stays browser-only.
 */
import { SCHEMA } from "./schema";

export { SCHEMA };

let client: postgres.Sql | null = null;
let ready: Promise<void> | null = null;

export function dbEnabled(): boolean {
  return !!process.env.DATABASE_URL;
}

/** The shared client, with the schema in place. Throws if DATABASE_URL isn't set. */
export async function db(): Promise<postgres.Sql> {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    client = postgres(url, {
      max: 3,
      idle_timeout: 20,
      // Transaction poolers (Supabase :6543, PgBouncer, Neon's pooled URL) can't keep prepared statements.
      prepare: false,
      onnotice: () => {},
    });
  }
  if (!ready) {
    ready = client.unsafe(SCHEMA).then(() => undefined);
    ready.catch(() => (ready = null)); // try again on the next request
  }
  await ready;
  return client;
}
