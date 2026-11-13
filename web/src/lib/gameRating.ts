/**
 * "Game Rating": the rating a player performed at in one game, estimated from how much they lost
 * per move against the engine (average centipawn loss, ACPL).
 *
 * chess.com's formula is private. This uses the widely quoted fit Elo ≈ 3100 · e^(−ACPL/100)
 * (ACPL 20 → ~2540, 50 → ~1880, 100 → ~1140), then leans on the player's real rating in short games,
 * where a handful of moves says little.
 */
import type { Color, MoveReview } from "./types.ts";

const CLAMP = 1000; // evals are capped at ±10 pawns (and mates count as 10), as lichess does
const PRIOR_MOVES = 12; // how many moves of evidence count as much as the player's real rating

function whiteCp(cp: number, mate: number | null): number {
  if (mate !== null) return mate > 0 || (mate === 0 && cp > 0) ? CLAMP : -CLAMP;
  return Math.max(-CLAMP, Math.min(CLAMP, cp));
}

/** Average centipawn loss over a player's moves, skipping book and forced moves. Null if none count. */
export function acpl(moves: MoveReview[], color: Color, start: { cp: number; mate: number | null }): { acpl: number; moves: number } | null {
  let before = whiteCp(start.cp, start.mate);
  let total = 0;
  let n = 0;
  for (const m of moves) {
    const after = whiteCp(m.eval_cp, m.eval_mate);
    if (m.color === color && m.classification !== "book" && m.classification !== "forced") {
      const sign = color === "white" ? 1 : -1;
      total += Math.max(0, sign * (before - after));
      n++;
    }
    before = after;
  }
  return n ? { acpl: total / n, moves: n } : null;
}

export function ratingFromAcpl(loss: number): number {
  return Math.max(100, Math.min(3200, 3100 * Math.exp(-loss / 100)));
}

/** The estimated rating `color` played at, or null if they made no moves of their own (all book). */
export function gameRating(
  moves: MoveReview[],
  color: Color,
  start: { cp: number; mate: number | null },
  actual?: number | null,
): number | null {
  const a = acpl(moves, color, start);
  if (!a) return null;
  const perf = ratingFromAcpl(a.acpl);
  if (!actual) return Math.round(perf);
  const w = a.moves / (a.moves + PRIOR_MOVES);
  return Math.round(w * perf + (1 - w) * actual);
}
