/** Board editor: build a position piece by piece, then check it's one an engine can analyse. */
import { Chess } from "chess.js";

export type PieceCode = "wK" | "wQ" | "wR" | "wB" | "wN" | "wP" | "bK" | "bQ" | "bR" | "bB" | "bN" | "bP";
export type Placement = Partial<Record<string, PieceCode>>;
export type Castling = { K: boolean; Q: boolean; k: boolean; q: boolean };

export interface Setup {
  placement: Placement;
  turn: "w" | "b";
  castling: Castling;
}

const FILES = "abcdefgh";
export const START_PLACEMENT_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";

/** Square -> piece from the first field of a FEN. */
export function placementFromFen(fen: string): Placement {
  const out: Placement = {};
  fen
    .split(" ")[0]
    .split("/")
    .forEach((row, r) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) f += Number(ch);
        else {
          const color = ch === ch.toUpperCase() ? "w" : "b";
          out[`${FILES[f]}${8 - r}`] = `${color}${ch.toUpperCase()}` as PieceCode;
          f++;
        }
      }
    });
  return out;
}

export function placementToFen(p: Placement): string {
  const rows: string[] = [];
  for (let r = 8; r >= 1; r--) {
    let row = "";
    let empty = 0;
    for (const f of FILES) {
      const piece = p[`${f}${r}`];
      if (!piece) {
        empty++;
        continue;
      }
      if (empty) row += empty;
      empty = 0;
      row += piece[0] === "w" ? piece[1] : piece[1].toLowerCase();
    }
    rows.push(row + (empty || ""));
  }
  return rows.join("/");
}

/** Castling is only possible with the king and that rook on their starting squares. */
export function possibleCastling(p: Placement): Castling {
  return {
    K: p.e1 === "wK" && p.h1 === "wR",
    Q: p.e1 === "wK" && p.a1 === "wR",
    k: p.e8 === "bK" && p.h8 === "bR",
    q: p.e8 === "bK" && p.a8 === "bR",
  };
}

export function setupToFen(s: Setup): string {
  const ok = possibleCastling(s.placement);
  const rights = (["K", "Q", "k", "q"] as const).filter((k) => s.castling[k] && ok[k]).join("") || "-";
  return `${placementToFen(s.placement)} ${s.turn} ${rights} - 0 1`;
}

export function setupFromFen(fen: string): Setup {
  const [, turn = "w", rights = "-"] = fen.trim().split(/\s+/);
  return {
    placement: placementFromFen(fen),
    turn: turn === "b" ? "b" : "w",
    castling: { K: rights.includes("K"), Q: rights.includes("Q"), k: rights.includes("k"), q: rights.includes("q") },
  };
}

export const START_SETUP: Setup = setupFromFen(`${START_PLACEMENT_FEN} w KQkq - 0 1`);
export const EMPTY_SETUP: Setup = { placement: {}, turn: "w", castling: { K: false, Q: false, k: false, q: false } };

/** Reasons the engine can't analyse this position; empty when it's fine. */
export function validateSetup(s: Setup): string[] {
  const errors: string[] = [];
  const pieces = Object.entries(s.placement) as [string, PieceCode][];
  const count = (code: PieceCode) => pieces.filter(([, p]) => p === code).length;
  for (const [color, name] of [["w", "White"], ["b", "Black"]] as const) {
    const kings = count(`${color}K`);
    if (kings !== 1) errors.push(`${name} needs exactly one king (has ${kings}).`);
    if (count(`${color}P`) > 8) errors.push(`${name} has more than 8 pawns.`);
    if (pieces.filter(([, p]) => p[0] === color).length > 16) errors.push(`${name} has more than 16 pieces.`);
  }
  if (pieces.some(([sq, p]) => p[1] === "P" && (sq[1] === "1" || sq[1] === "8"))) errors.push("Pawns can't stand on the first or last rank.");
  if (errors.length) return errors;
  // The side that just moved can't be left in check.
  const [placement, turn] = setupToFen(s).split(" ");
  try {
    const other = new Chess(`${placement} ${turn === "w" ? "b" : "w"} - - 0 1`, { skipValidation: true });
    if (other.inCheck()) errors.push(`${turn === "w" ? "Black" : "White"} is in check but it's ${turn === "w" ? "White" : "Black"}'s move.`);
    new Chess(setupToFen(s));
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  return errors;
}
