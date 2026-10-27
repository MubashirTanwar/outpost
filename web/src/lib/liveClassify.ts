/** Live move classification on the analysis board, from engine evaluations cached per position. */
import { Chess } from "chess.js";
import { START_FEN, type Line } from "./analysisLine.ts";
import type { Classification, EngineLine } from "./types.ts";

/** How deep a position must have been searched before a move from or to it is judged. */
export const CLASSIFY_DEPTH = 12;

export interface CachedEval {
  depth: number;
  lines: EngineLine[]; // side to move's view, best first
}

/** Same signature as review.ts judgeMove (injected so this stays testable without the opening book). */
export type Judge = (m: {
  before: string;
  uci: string;
  san: string;
  ply: number;
  sans: string[];
  inBook: boolean;
  prev: Classification | null;
  isRecapture: boolean;
  best: EngineLine;
  second?: EngineLine;
  afterBest: EngineLine;
}) => { classification: Classification; winBefore: number; winAfter: number; loss: number; inBook: boolean };

export interface MoveVerdict {
  classification: Classification;
  loss: number; // win% lost
  bestSan: string | null; // what the engine preferred, if you didn't play it
}

/** A position's evaluation once it's good enough to judge with: deep enough, or the game is over there. */
export function usableEval(fen: string, cached: CachedEval | undefined): EngineLine[] | null {
  const c = new Chess(fen);
  if (c.isCheckmate()) return [{ cp: -100000, mate: 0, pv: [] }];
  if (c.isGameOver()) return [{ cp: 0, mate: null, pv: [] }];
  return cached && cached.depth >= CLASSIFY_DEPTH && cached.lines[0]?.pv.length ? cached.lines : null;
}

/** Positions that still need a search before every move up to `cursor` can be judged. */
export function positionsToAnalyse(line: Line, cache: (fen: string) => CachedEval | undefined, cursor = line.cursor): string[] {
  const out: string[] = [];
  const fens = [line.start, ...line.moves.map((m) => m.fen)];
  // The move leading to the current position needs both ends; look at that one first.
  for (const i of [cursor - 1, cursor]) {
    const fen = fens[i];
    if (i >= 0 && fen && !usableEval(fen, cache(fen)) && !out.includes(fen)) out.push(fen);
  }
  return out;
}

/**
 * A verdict for every move in the line, or null while its positions haven't been searched deeply
 * enough. Book moves only count from the standard starting position.
 */
export function classifyLine(line: Line, cache: (fen: string) => CachedEval | undefined, judge: Judge): (MoveVerdict | null)[] {
  const fens = [line.start, ...line.moves.map((m) => m.fen)];
  const fromStart = line.start === START_FEN;
  const sans: string[] = [];
  let inBook = fromStart;
  let prev: Classification | null = null;
  return line.moves.map((m, i) => {
    sans.push(m.san);
    const before = usableEval(fens[i], cache(fens[i]));
    const after = usableEval(fens[i + 1], cache(fens[i + 1]));
    if (!before || !after) {
      prev = null;
      return null;
    }
    const chess = new Chess(fens[i]);
    const mv = chess.move(m.san);
    const prevMove = i > 0 ? line.moves[i - 1] : null;
    const prevCapture = prevMove ? !!new Chess(fens[i - 1]).move(prevMove.san).captured : false;
    const uci = mv.from + mv.to + (mv.promotion ?? "");
    const j = judge({
      before: fens[i],
      uci,
      san: m.san,
      ply: i,
      sans: fromStart ? [...sans] : [],
      inBook,
      prev,
      isRecapture: !!(prevCapture && mv.captured && prevMove!.to === mv.to),
      best: before[0],
      second: before[1],
      afterBest: after[0],
    });
    inBook = j.inBook;
    prev = j.classification;
    const bestUci = before[0].pv[0];
    let bestSan: string | null = null;
    if (bestUci && bestUci !== uci) {
      try {
        bestSan = new Chess(fens[i]).move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci[4] }).san;
      } catch {}
    }
    return { classification: j.classification, loss: j.loss, bestSan };
  });
}
