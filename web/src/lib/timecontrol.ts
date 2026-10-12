/** Time controls and rating changes, from chess.com game data. */

export type TimeClass = "bullet" | "blitz" | "rapid" | "daily";

/** "180+2" -> "3 | 2", "600" -> "10 min", "30" -> "30 sec", "1/86400" -> "1 day". */
export function timeControlLabel(tc: string | null | undefined): string {
  if (!tc) return "";
  if (tc.includes("/")) {
    const days = Math.round(Number(tc.split("/")[1]) / 86400);
    return Number.isFinite(days) ? `${days} day${days === 1 ? "" : "s"}` : tc;
  }
  const [base, inc] = tc.split("+").map(Number);
  if (!Number.isFinite(base)) return tc;
  const main = base < 60 ? `${base} sec` : `${+(base / 60).toFixed(1)}`;
  if (inc) return `${main.replace(" sec", "s")} | ${inc}`;
  return base < 60 ? main : `${main} min`;
}

export interface RatedGame {
  id: string;
  end_time: number;
  time_class: string;
  rated: boolean;
  player_color: "white" | "black" | null;
  white_rating: number | null;
  black_rating: number | null;
}

export function myRating(g: RatedGame): number | null {
  if (!g.player_color) return null;
  return (g.player_color === "white" ? g.white_rating : g.black_rating) ?? null;
}

/**
 * Rating change from each rated game: this game's rating minus the rating after the previous rated
 * game in the same time class. Pass earlier games too, or the first game of each class has no change.
 */
export function ratingChanges(games: RatedGame[]): Record<string, number | null> {
  const last: Record<string, number> = {};
  const out: Record<string, number | null> = {};
  for (const g of [...games].sort((a, b) => a.end_time - b.end_time)) {
    const r = myRating(g);
    if (!g.rated || r == null) {
      out[g.id] = null;
      continue;
    }
    out[g.id] = g.time_class in last ? r - last[g.time_class] : null;
    last[g.time_class] = r;
  }
  return out;
}

export interface ClassRating {
  timeClass: string;
  games: number;
  end: number;
  /** Net change over these games; null when the rating before the first of them is unknown. */
  change: number | null;
}

/** Rating per time class at the end of `games`, and the net change across them. */
export function ratingSummary(games: RatedGame[], changes: Record<string, number | null>): ClassRating[] {
  const by = new Map<string, ClassRating & { known: boolean; first: number }>();
  for (const g of [...games].sort((a, b) => a.end_time - b.end_time)) {
    const r = myRating(g);
    if (!g.rated || r == null) continue;
    const c = changes[g.id];
    const s = by.get(g.time_class);
    if (!s) {
      // The rating before these games is known only if the first one's change is.
      by.set(g.time_class, { timeClass: g.time_class, games: 1, end: r, change: null, known: c != null, first: c != null ? r - c : r });
    } else {
      s.games += 1;
      s.end = r;
    }
  }
  const order = ["bullet", "blitz", "rapid", "daily"];
  return [...by.values()]
    .map(({ known, first, ...s }) => ({ ...s, change: known ? s.end - first : null }))
    .sort((a, b) => order.indexOf(a.timeClass) - order.indexOf(b.timeClass));
}
