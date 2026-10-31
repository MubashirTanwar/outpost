/**
 * Endgames from your own games: which kinds come up, how they go, and positions to practise.
 * Pure functions over reviewed games (the same sources the Insights section uses).
 */
import { Chess } from "chess.js";
import type { Goal } from "./endgame-rules.ts";
import type { Color } from "./types.ts";

export interface EndgameMove {
  ply: number;
  move_number: number;
  color: Color;
  san: string;
  classification: string;
  win_before: number; // best achievable, mover's view
  win_after: number;
  phase: string;
  best_san: string | null;
  fen_before?: string | null;
}

export interface EndgameGame {
  id: string;
  t: number; // ms
  color: Color; // the player's side
  result: "win" | "loss" | "draw";
  opponent: string;
  moves: EndgameMove[];
}

export type EndgameType = "Pawn endings" | "Rook endings" | "Queen endings" | "Minor piece endings" | "Rook vs minor piece" | "Other endings";
export const TYPE_ORDER: EndgameType[] = ["Pawn endings", "Rook endings", "Minor piece endings", "Rook vs minor piece", "Queen endings", "Other endings"];

const ERRORS = new Set(["mistake", "blunder", "miss"]);

export interface Material {
  q: number;
  r: number;
  b: number;
  n: number;
  p: number;
  lightB: number; // bishops on light squares
}

function material(chess: Chess, color: "w" | "b"): Material {
  const m: Material = { q: 0, r: 0, b: 0, n: 0, p: 0, lightB: 0 };
  chess.board().forEach((row, r) =>
    row.forEach((piece, f) => {
      if (!piece || piece.color !== color || piece.type === "k") return;
      m[piece.type as "q" | "r" | "b" | "n" | "p"]++;
      if (piece.type === "b" && (r + f) % 2 === 0) m.lightB++;
    }),
  );
  return m;
}

function letters(m: Material): string {
  return "K" + "Q".repeat(m.q) + "R".repeat(m.r) + "B".repeat(m.b) + "N".repeat(m.n) + "P".repeat(m.p);
}

/** What kind of ending this is, seen from `me`: its family, a finer label, and the material ("KRP vs KR"). */
export function endgameType(fen: string, me: Color): { type: EndgameType; detail: string; signature: string } {
  const chess = new Chess(fen);
  const mine = material(chess, me === "white" ? "w" : "b");
  const theirs = material(chess, me === "white" ? "b" : "w");
  const signature = `${letters(mine)} vs ${letters(theirs)}`;
  const minors = (m: Material) => m.b + m.n;
  const both = { q: mine.q + theirs.q, r: mine.r + theirs.r, b: mine.b + theirs.b, n: mine.n + theirs.n };
  let type: EndgameType = "Other endings";
  let detail = signature;
  if (both.q + both.r + both.b + both.n === 0) {
    type = "Pawn endings";
    detail = "King and pawns";
  } else if (both.q > 0) {
    type = "Queen endings";
    detail = both.r + both.b + both.n === 0 ? "Queens only" : "Queen with pieces";
  } else if (both.r > 0 && both.b + both.n === 0) {
    type = "Rook endings";
    detail = mine.r === theirs.r ? (mine.r === 1 ? "Rook vs rook" : "Two rooks each") : "Unequal rooks";
  } else if (both.r === 0) {
    type = "Minor piece endings";
    if (mine.b === 1 && theirs.b === 1 && mine.n + theirs.n === 0)
      detail = mine.lightB === theirs.lightB ? "Same-colour bishops" : "Opposite-colour bishops";
    else if (both.b === 0) detail = "Knight endings";
    else if (both.n === 0) detail = "Bishop endings";
    else if (minors(mine) === 1 && minors(theirs) === 1) detail = "Bishop vs knight";
    else detail = "Minor pieces";
  } else if (mine.r !== theirs.r && minors(mine) + minors(theirs) > 0) {
    type = "Rook vs minor piece";
    detail = mine.r > theirs.r ? "Your rook vs their minor piece" : "Your minor piece vs their rook";
  }
  return { type, detail, signature };
}

export interface PracticePosition {
  id: string; // stable: game + ply
  gameId: string;
  ply: number;
  moveNumber: number;
  fen: string;
  side: Color;
  goal: Extract<Goal, "win" | "draw">;
  type: EndgameType;
  detail: string;
  signature: string;
  /** Where you went wrong in that game (null if this is just where the endgame started). */
  mistake: { san: string; best: string | null; classification: string; winBefore: number; winAfter: number } | null;
  result: EndgameGame["result"];
  opponent: string;
  t: number;
}

/** Your winning chances (best achievable) decide the goal: win from 70%, hold from 35%, skip if lost. */
export function goalFor(winBefore: number): PracticePosition["goal"] | null {
  if (winBefore >= 70) return "win";
  if (winBefore >= 35) return "draw";
  return null;
}

/**
 * One practice position per game that reached an endgame: the position before your first endgame
 * mistake if you made one, else where the endgame began. Skipped when you were already lost there.
 */
export function practicePositions(games: EndgameGame[]): PracticePosition[] {
  const out: PracticePosition[] = [];
  for (const g of games) {
    const mine = g.moves.filter((m) => m.color === g.color && m.phase === "endgame" && m.fen_before);
    if (!mine.length) continue;
    const slip = mine.find((m) => ERRORS.has(m.classification));
    const at = slip ?? mine[0];
    const goal = goalFor(at.win_before);
    if (!goal) continue;
    const kind = endgameType(at.fen_before!, g.color);
    out.push({
      id: `game-${g.id}-${at.ply}`,
      gameId: g.id,
      ply: at.ply,
      moveNumber: at.move_number,
      fen: at.fen_before!,
      side: g.color,
      goal,
      ...kind,
      mistake: slip ? { san: slip.san, best: slip.best_san, classification: slip.classification, winBefore: slip.win_before, winAfter: slip.win_after } : null,
      result: g.result,
      opponent: g.opponent,
      t: g.t,
    });
  }
  // Mistakes first (most to learn), then the newest.
  return out.sort((a, b) => Number(!!b.mistake) - Number(!!a.mistake) || b.t - a.t);
}

export interface EndgameSummary {
  type: EndgameType;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  mistakes: number; // your endgame mistakes and blunders in those games
  details: { detail: string; games: number }[];
  positions: PracticePosition[];
}

/** Your endgames by family, most common first. A game counts once, by the ending it reached first. */
export function summarizeEndgames(games: EndgameGame[]): EndgameSummary[] {
  const positions = practicePositions(games);
  const by = new Map<EndgameType, EndgameSummary>();
  for (const g of games) {
    const first = g.moves.find((m) => m.phase === "endgame" && m.fen_before);
    if (!first) continue;
    const { type, detail } = endgameType(first.fen_before!, g.color);
    const s = by.get(type) ?? { type, games: 0, wins: 0, draws: 0, losses: 0, mistakes: 0, details: [], positions: [] };
    s.games++;
    s[g.result === "win" ? "wins" : g.result === "draw" ? "draws" : "losses"]++;
    s.mistakes += g.moves.filter((m) => m.color === g.color && m.phase === "endgame" && ERRORS.has(m.classification)).length;
    const d = s.details.find((x) => x.detail === detail);
    if (d) d.games++;
    else s.details.push({ detail, games: 1 });
    by.set(type, s);
  }
  for (const p of positions) by.get(p.type)?.positions.push(p);
  return [...by.values()]
    .map((s) => ({ ...s, details: s.details.sort((a, b) => b.games - a.games) }))
    .sort((a, b) => b.games - a.games || TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
}
