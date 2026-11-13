"use client";

/**
 * The app's Postgres storage (via /api/store on the same site). Every call is best effort: when the
 * database isn't configured or can't be reached, these resolve to null/false and the app carries on
 * with this browser's localStorage, as it always has.
 */
import type { DayOverview, GameMeta, Puzzle, Review } from "./types";

let health: Promise<boolean> | null = null;

/** Is server storage configured? Asked once per page load. */
export function storeEnabled(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (!health) {
    health = fetch("/api/store/health", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((b: { enabled?: boolean }) => !!b.enabled)
      .catch(() => false);
  }
  return health;
}

async function call<T>(path: string, init?: RequestInit): Promise<T | null> {
  if (!(await storeEnabled())) return null;
  try {
    const res = await fetch(`/api/store/${path}`, {
      cache: "no-store",
      ...init,
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

const enc = encodeURIComponent;
const put = (body: unknown): RequestInit => ({ method: "PUT", body: JSON.stringify(body) });
const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const store = {
  getReview: async (id: string) => (await call<{ review: Review | null }>(`reviews/${enc(id)}`))?.review ?? null,
  putReview: (review: Review) => (review.game ? call(`reviews/${enc(review.game.id)}`, put(review)) : Promise.resolve(null)),

  getPasted: async (id: string) => (await call<{ meta: (GameMeta & { pgn: string }) | null }>(`pasted/${enc(id)}`))?.meta ?? null,
  putPasted: (meta: GameMeta & { pgn: string }) => call(`pasted/${enc(meta.id)}`, put(meta)),

  /** A player's reviews: summaries only (game + summary), or whole reviews with `full`. */
  playerReviews: async (user: string, days: number, full = false) =>
    (await call<{ reviews: Review[] }>(`players/${enc(user)}/reviews?days=${days}${full ? "&full=1" : ""}`))?.reviews ?? null,

  getPuzzles: async (user: string) => (await call<{ puzzles: Puzzle[] }>(`players/${enc(user)}/puzzles`))?.puzzles ?? null,
  addPuzzles: (user: string, puzzles: Puzzle[]) => (puzzles.length ? call(`players/${enc(user)}/puzzles`, post({ puzzles })) : Promise.resolve(null)),
  attempt: (user: string, id: string, solved: boolean) => call(`players/${enc(user)}/puzzles/${enc(id)}/attempt`, post({ solved })),

  getProgress: async <P>(user: string) => (await call<{ progress: P | null }>(`players/${enc(user)}/progress`))?.progress ?? null,
  putProgress: (user: string, progress: unknown) => call(`players/${enc(user)}/progress`, put(progress)),

  getDay: async (user: string, day: string) => (await call<{ overview: DayOverview | null }>(`players/${enc(user)}/days/${day}`))?.overview ?? null,
  putDay: (user: string, day: string, overview: DayOverview) => call(`players/${enc(user)}/days/${day}`, put(overview)),
};
