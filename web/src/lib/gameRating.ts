/**
 * "Game Rating": the rating a player performed at in one game, estimated from how much they lost
 * per move against the engine (average centipawn loss, ACPL).
 *
 * chess.com's formula is private. Ours is fitted on real games: `gameRatingTable.ts` holds, per
 * time control, the median ACPL of Lichess players at each rating and how much one game strays from it
 * (built by scripts/game_rating from the open Lichess database). One game says little: even a long
 * one strays by about ±50% in ACPL, worth hundreds of rating points. So the estimate starts from the
 * player's real rating and moves as far as this game's ACPL justifies, more for long and extreme
 * games. Lichess numbers are then put on chess.com's scale.
 */
import { ACPL_FLOOR, GAME_RATING_NOISE, GAME_RATING_TABLE } from "./gameRatingTable.ts";
import type { Color, MoveReview } from "./types.ts";

export type RatingClass = "bullet" | "blitz" | "rapid" | "classical";

const CLAMP = 1000; // evals are capped at ±10 pawns (and mates count as 10), as lichess does
const MIN = 100;
const MAX = 3200;

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

/** chess.com's time classes (and a PGN's "180+2") onto the fitted ones. Unknown means blitz. */
export function ratingClass(timeClass?: string | null, timeControl?: string | null): RatingClass {
  const tc = (timeClass ?? "").toLowerCase();
  if (tc === "bullet" || tc === "blitz" || tc === "rapid") return tc;
  if (tc === "daily" || tc === "classical" || tc === "correspondence") return "classical";
  if (timeControl && !timeControl.includes("/")) {
    const [base, inc] = timeControl.split("+").map(Number);
    if (Number.isFinite(base)) {
      const est = base + 40 * (inc || 0); // Lichess's own split
      return est < 180 ? "bullet" : est < 480 ? "blitz" : est < 1500 ? "rapid" : "classical";
    }
  }
  if (timeControl?.includes("/")) return "classical";
  return "blitz";
}

/**
 * Lichess ratings run higher than chess.com's, most of all low down. A straight-line fit to
 * published rating-comparison surveys (ChessGoals): about +400 at chess.com 1000, level by 2500.
 * Approximate; the biggest source of error in this estimate.
 */
export function lichessToChesscom(r: number): number {
  return r >= 2500 ? r : (r - 680) / 0.73;
}

export function chesscomToLichess(r: number): number {
  return r >= 2500 ? r : 0.73 * r + 680;
}

/** Median log(ACPL) of Lichess players rated `r`; off the table's ends, carried on along its outer slope. */
function typicalLogAcpl(r: number, cls: RatingClass): number {
  const pts = GAME_RATING_TABLE[cls];
  const at = (i: number) => ({ r: pts[i][0], x: Math.log(pts[i][1]) });
  const line = (a: { r: number; x: number }, b: { r: number; x: number }) => a.x + ((r - a.r) * (b.x - a.x)) / (b.r - a.r);
  const last = pts.length - 1;
  if (r <= pts[0][0]) return line(at(0), at(Math.min(4, last)));
  if (r >= pts[last][0]) return line(at(Math.max(0, last - 4)), at(last));
  for (let i = 0; i < last; i++) if (r <= pts[i + 1][0]) return line(at(i), at(i + 1));
  return at(last).x;
}

/** How one game's log(ACPL) strays from its rating's median, for a game of `moves` moves. */
function noise(moves: number, cls: RatingClass): { offset: number; sigma: number } {
  const rows = GAME_RATING_NOISE[cls];
  const bucket = Math.min(Math.max(moves, 5) - (Math.max(moves, 5) % 5), 60);
  const row = rows.find((r) => r[0] === bucket) ?? (bucket < rows[0][0] ? rows[0] : rows[rows.length - 1]);
  return { offset: row[1], sigma: row[2] };
}

/**
 * How far one game's performance usually strays from a player's real rating (Lichess points).
 * This is the one hand-set number: higher lets single games swing further.
 */
const SPREAD = 350;
/** With no real rating to start from: roughly the Lichess player pool. */
const POOL = { mean: 1650, sd: 450 };

/**
 * The rating someone most likely performed at, given their ACPL over `moves` moves: start from their
 * real rating (or the player pool), and weigh how typical this ACPL is at each rating.
 */
export function performance(loss: number, moves: number, cls: RatingClass = "blitz", actual?: number | null): number {
  const prior = actual ? { mean: chesscomToLichess(actual), sd: SPREAD } : POOL;
  const { offset, sigma } = noise(moves, cls);
  const x = Math.log(Math.max(loss, ACPL_FLOOR));
  let sum = 0;
  let weight = 0;
  for (let r = 0; r <= 3600; r += 10) {
    const z = (x - typicalLogAcpl(r, cls) - offset) / sigma;
    const p = (r - prior.mean) / prior.sd;
    const w = Math.exp(-0.5 * (z * z + p * p));
    sum += w * r;
    weight += w;
  }
  const lichess = weight > 0 ? sum / weight : prior.mean;
  return Math.max(MIN, Math.min(MAX, lichessToChesscom(lichess)));
}

/** The estimated rating `color` played at, or null if they made no moves of their own (all book). */
export function gameRating(
  moves: MoveReview[],
  color: Color,
  start: { cp: number; mate: number | null },
  actual?: number | null,
  cls: RatingClass = "blitz",
): number | null {
  const a = acpl(moves, color, start);
  if (!a) return null;
  return Math.round(performance(a.acpl, a.moves, cls, actual));
}
