/** Pure scoring helpers shared by the browser review (mirrors backend/app/review.py). */
import { Chess, type Move, type Square } from "chess.js";
import type { Classification, MoveReview } from "./types.ts";

export const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const BRILLIANT_MAX_WIN = 90; // win % (about +6 pawns) above which a sacrifice is no longer brilliant
export const ERRORS = new Set<Classification>(["inaccuracy", "mistake", "miss", "blunder"]);

export function winPercent(cp: number): number {
  const c = Math.max(-1000, Math.min(1000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

export function moveAccuracy(loss: number): number {
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669 + 1));
}

export function gameAccuracy(accs: number[]): number | null {
  if (!accs.length) return null;
  const mean = accs.reduce((a, b) => a + b, 0) / accs.length;
  const harmonic = accs.length / accs.reduce((a, b) => a + 1 / Math.max(b, 1), 0);
  return Math.round(((mean + harmonic) / 2) * 10) / 10;
}

export interface ClassifyInput {
  winBefore: number;
  winAfter: number;
  playedBest: boolean;
  secondBestWin: number | null;
  sacrifice: boolean;
  isBook: boolean;
  onlyMove: boolean;
  isRecapture: boolean;
  givesMate?: boolean;
  prevOpponentClass: Classification | null;
}

export function classify(i: ClassifyInput): Classification {
  const loss = Math.max(0, i.winBefore - i.winAfter);
  if (i.onlyMove) return "forced";
  if (i.isBook) return "book";
  // Like chess.com: a sound sacrifice that leaves you at least equal, but not when already completely winning.
  if (loss < 2 && i.sacrifice && i.winAfter >= 50 && i.winBefore < BRILLIANT_MAX_WIN) return "brilliant";
  if (i.playedBest) {
    if (
      !i.givesMate &&
      i.winBefore < 97 &&
      i.secondBestWin !== null &&
      i.winBefore - i.secondBestWin >= 15 &&
      i.secondBestWin < 70 &&
      !i.isRecapture
    )
      return "great";
    return "best";
  }
  if (loss < 2) return "excellent";
  if (loss < 5) return "good";
  if (loss < 10) return "inaccuracy";
  const cls: Classification = loss < 20 ? "mistake" : "blunder";
  if ((i.prevOpponentClass === "mistake" || i.prevOpponentClass === "blunder") && i.winBefore >= 60 && i.winAfter >= 35)
    return "miss";
  return cls;
}

export const sideOf = (c: "w" | "b"): "white" | "black" => (c === "w" ? "white" : "black");

export function materialDiff(chess: Chess, color: "w" | "b"): number {
  let d = 0;
  for (const row of chess.board()) for (const p of row) if (p) d += (p.color === color ? 1 : -1) * VALUES[p.type];
  return d;
}

export function playUci(chess: Chess, uci: string): Move | null {
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
  } catch {
    return null;
  }
}

function isHanging(chess: Chess, sq: Square): boolean {
  const p = chess.get(sq);
  if (!p || p.type === "p" || p.type === "k") return false;
  const enemy = p.color === "w" ? "b" : "w";
  const attackers = chess.attackers(sq, enemy);
  if (!attackers.length) return false;
  const defenders = chess.attackers(sq, p.color);
  const cheapest = Math.min(...attackers.map((s) => VALUES[chess.get(s)!.type] || 100));
  return !defenders.length || cheapest < VALUES[p.type];
}

export function isSacrifice(fen: string, uci: string, replyPv: string[]): boolean {
  const chess = new Chess(fen);
  const mover = chess.turn();
  const base = materialDiff(chess, mover);
  const moved = chess.get(uci.slice(0, 2) as Square);
  if (!playUci(chess, uci) || !moved) return false;
  const afterFen = chess.fen();
  if (replyPv[0] && playUci(chess, replyPv[0])) {
    if (materialDiff(chess, mover) <= base - 2) {
      if (!replyPv[1] || !playUci(chess, replyPv[1]) || materialDiff(chess, mover) <= base - 2) return true;
    }
  }
  const after = new Chess(afterFen);
  const value = VALUES[moved.type];
  return value >= 3 && isHanging(after, uci.slice(2, 4) as Square) && materialDiff(after, mover) - value <= base - 2;
}

export function gamePhase(chess: Chess, ply: number): MoveReview["phase"] {
  let nonPawn = 0;
  for (const row of chess.board()) for (const p of row) if (p && p.type !== "p" && p.type !== "k") nonPawn += VALUES[p.type];
  if (nonPawn <= 26) return "endgame";
  if (ply < 20 && nonPawn >= 54) return "opening";
  return "middlegame";
}
