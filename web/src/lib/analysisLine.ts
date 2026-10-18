/** The analysis board's move line: a start position, the moves played from it, and where you are. */
import { Chess } from "chess.js";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export interface LineMove {
  san: string;
  from: string;
  to: string;
  fen: string; // position after the move
}

export interface Line {
  start: string;
  moves: LineMove[];
  cursor: number; // moves played so far: 0 = the start position
}

export function newLine(start = START_FEN): Line {
  return { start, moves: [], cursor: 0 };
}

export function fenAt(line: Line, cursor = line.cursor): string {
  return cursor === 0 ? line.start : line.moves[cursor - 1].fen;
}

export function lastMove(line: Line): { from: string; to: string } | null {
  const m = line.cursor > 0 ? line.moves[line.cursor - 1] : null;
  return m ? { from: m.from, to: m.to } : null;
}

/**
 * Play a move at the cursor (SAN, or {from, to, promotion}). Playing the move that already comes
 * next just steps forward, keeping the rest of the line; any other move replaces what followed.
 * Returns null for an illegal move.
 */
export function play(line: Line, move: string | { from: string; to: string; promotion?: string }): Line | null {
  const c = new Chess(fenAt(line));
  let mv;
  try {
    mv = c.move(move);
  } catch {
    return null;
  }
  const next = line.moves[line.cursor];
  if (next && next.san === mv.san) return { ...line, cursor: line.cursor + 1 };
  const played: LineMove = { san: mv.san, from: mv.from, to: mv.to, fen: c.fen() };
  return { ...line, moves: [...line.moves.slice(0, line.cursor), played], cursor: line.cursor + 1 };
}

/** Play a UCI move ("e2e4", "e7e8q"), as engines give them. */
export function playUci(line: Line, uci: string): Line | null {
  return play(line, { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
}

export function goTo(line: Line, cursor: number): Line {
  return { ...line, cursor: Math.max(0, Math.min(line.moves.length, cursor)) };
}

/**
 * A FEN or a PGN (with or without headers, from any start position given by its FEN header).
 * PGNs open at their last move so you can step back through them. Throws on anything else.
 */
export function lineFromText(text: string): Line {
  const s = text.trim();
  if (!s) throw new Error("Paste a FEN or a PGN.");
  if (s.split("/").length === 8 && !s.includes("[")) {
    const c = new Chess();
    try {
      c.load(s);
    } catch (e) {
      throw new Error(`Invalid FEN: ${e instanceof Error ? e.message : e}`);
    }
    return newLine(c.fen());
  }
  const c = new Chess();
  try {
    c.loadPgn(s);
  } catch (e) {
    throw new Error(`That's neither a valid FEN nor PGN (${e instanceof Error ? e.message : e}).`);
  }
  const history = c.history({ verbose: true });
  const start = history.length ? history[0].before : c.fen();
  const moves = history.map((m) => ({ san: m.san, from: m.from, to: m.to, fen: m.after }));
  return { start, moves, cursor: moves.length };
}

/** The line as PGN (with a FEN header when it doesn't start from the usual position). */
export function toPgn(line: Line): string {
  const c = new Chess(line.start);
  for (const m of line.moves) c.move(m.san);
  if (line.start !== START_FEN) {
    c.setHeader("SetUp", "1");
    c.setHeader("FEN", line.start);
  }
  return c.pgn();
}

/** Rows for a two-column move list: move number, White's move and Black's (by index into moves). */
export function moveRows(line: Line): { number: number; white: number | null; black: number | null }[] {
  const [, turn, , , , full] = line.start.split(" ");
  const rows: { number: number; white: number | null; black: number | null }[] = [];
  let number = parseInt(full, 10) || 1;
  let i = 0;
  if (turn === "b" && line.moves.length) {
    rows.push({ number, white: null, black: 0 });
    number++;
    i = 1;
  }
  for (; i < line.moves.length; i += 2) {
    rows.push({ number, white: i, black: i + 1 < line.moves.length ? i + 1 : null });
    number++;
  }
  return rows;
}
