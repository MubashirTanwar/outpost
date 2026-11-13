"use client";

/**
 * Copies what this browser saved before the database existed (reviews, pasted games, puzzles with
 * their attempts, day overviews, course and endgame progress) up to the database. Each item goes up
 * once: what's been sent is remembered, so later runs only send what's new.
 */
import { store, storeEnabled } from "./store";
import type { DayOverview, GameMeta, Puzzle, Review } from "./types";
import { syncProgressNow } from "./useProgress";

const SENT_KEY = "cc-synced";

export interface SyncResult {
  reviews: number;
  pasted: number;
  puzzles: number;
  days: number;
}

function sentSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SENT_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveSent(sent: Set<string>) {
  try {
    localStorage.setItem(SENT_KEY, JSON.stringify([...sent]));
  } catch {}
}

function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

/** A signature of an item, so an item changed since it was sent (a new puzzle attempt) goes up again. */
function stamp(key: string, raw: string | null): string {
  let h = 0;
  for (let i = 0; raw && i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
  return `${key}#${raw?.length ?? 0}:${h}`;
}

let running: Promise<SyncResult | null> | null = null;

/** Send everything this browser has that the database doesn't yet. Null when there's no database. */
export function syncBrowserData(): Promise<SyncResult | null> {
  if (!running) running = doSync().finally(() => (running = null));
  return running;
}

async function doSync(): Promise<SyncResult | null> {
  if (typeof window === "undefined" || !(await storeEnabled())) return null;
  const sent = sentSet();
  const out: SyncResult = { reviews: 0, pasted: 0, puzzles: 0, days: 0 };
  let keys: string[] = [];
  try {
    keys = Object.keys(localStorage);
  } catch {
    return out;
  }
  for (const key of keys) {
    const raw = localStorage.getItem(key);
    const sig = stamp(key, raw);
    if (sent.has(sig) || !raw) continue;
    let ok: unknown = null;
    if (key.startsWith("cc-review:")) {
      const review = read<Review>(key);
      if (review?.game) ok = await store.putReview(review);
      if (ok) out.reviews++;
    } else if (key.startsWith("cc-pasted:")) {
      const meta = read<GameMeta & { pgn: string }>(key);
      if (meta?.id && meta.pgn) ok = await store.putPasted(meta);
      if (ok) out.pasted++;
    } else if (key.startsWith("cc-puzzles:")) {
      const puzzles = read<Puzzle[]>(key) ?? [];
      const user = key.slice("cc-puzzles:".length);
      for (let i = 0; i < puzzles.length; i += 200) ok = await store.addPuzzles(user, puzzles.slice(i, i + 200));
      if (ok) out.puzzles += puzzles.length;
    } else if (key.startsWith("cc-day:")) {
      const [, user, day] = key.split(":");
      const overview = read<DayOverview>(key);
      if (user && day && overview) ok = await store.putDay(user, day, overview);
      if (ok) out.days++;
    } else continue;
    if (ok) {
      sent.add(sig);
      saveSent(sent);
    }
  }
  await syncProgressNow();
  return out;
}
