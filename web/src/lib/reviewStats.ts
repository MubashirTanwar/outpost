/**
 * A small summary of one review, stored next to it in the database so the admin pages can
 * rank and search thousands of games without reading every move.
 */
import { gameRating, ratingClass } from "./gameRating.ts";
import type { Color, Review } from "./types.ts";

export interface SideStats {
  name: string;
  rating: number | null;
  accuracy: number | null;
  game_rating: number | null;
  brilliant: number;
  great: number;
  best: number;
  mistakes: number; // mistake + miss
  blunders: number;
  result: string;
}

export interface ReviewStats {
  player: string; // whose review this is (lowercase)
  player_color: Color;
  time_class: string;
  opening: string | null;
  eco: string | null;
  plies: number;
  white: SideStats;
  black: SideStats;
  /** The biggest single drop in winning chances, by either side. */
  worst: { color: Color; san: string; ply: number; win_loss: number } | null;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function reviewStats(review: Review): ReviewStats | null {
  const g = review.game;
  if (!g) return null;
  const color: Color = g.player_color ?? review.player_color ?? "white";
  const cls = ratingClass(g.time_class, g.time_control);
  const side = (c: Color): SideStats => {
    const s = review.summary?.[c];
    const counts = s?.counts ?? ({} as Record<string, number>);
    const rating = num(c === "white" ? g.white_rating : g.black_rating);
    return {
      name: c === "white" ? g.white : g.black,
      rating,
      accuracy: s?.accuracy ?? null,
      game_rating: review.moves?.length ? gameRating(review.moves, c, review.start_eval, rating, cls) : null,
      brilliant: counts.brilliant ?? 0,
      great: counts.great ?? 0,
      best: counts.best ?? 0,
      mistakes: (counts.mistake ?? 0) + (counts.miss ?? 0),
      blunders: counts.blunder ?? 0,
      result: (c === "white" ? g.white_result : g.black_result) ?? "",
    };
  };
  let worst: ReviewStats["worst"] = null;
  for (const m of review.moves ?? []) {
    if (!worst || m.win_loss > worst.win_loss) worst = { color: m.color, san: m.san, ply: m.ply, win_loss: Math.round(m.win_loss * 10) / 10 };
  }
  return {
    player: (color === "white" ? g.white : g.black).toLowerCase(),
    player_color: color,
    time_class: g.time_class || cls,
    opening: g.opening ?? null,
    eco: g.eco ?? review.eco ?? null,
    plies: review.moves?.length ?? 0,
    white: side("white"),
    black: side("black"),
    worst: worst && worst.win_loss > 0 ? worst : null,
  };
}
