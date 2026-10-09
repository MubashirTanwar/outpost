/** Captured pieces and material balance from a FEN, for chess.com-style player bars. */

export type PieceType = "q" | "r" | "b" | "n" | "p";

const START: Record<PieceType, number> = { q: 1, r: 2, b: 2, n: 2, p: 8 };
export const VALUES: Record<PieceType, number> = { q: 9, r: 5, b: 3, n: 3, p: 1 };
const ORDER: PieceType[] = ["q", "r", "b", "n", "p"];

export interface Material {
  /** Pieces each side has captured (i.e. the opponent's missing pieces), most valuable first. */
  captured: { white: PieceType[]; black: PieceType[] };
  /** Material points White is ahead by (negative: Black is ahead). */
  diff: number;
}

export function material(fen: string): Material {
  const count = { w: { q: 0, r: 0, b: 0, n: 0, p: 0 }, b: { q: 0, r: 0, b: 0, n: 0, p: 0 } };
  for (const ch of fen.split(" ")[0]) {
    const t = ch.toLowerCase() as PieceType;
    if (t in START) count[ch === t ? "b" : "w"][t]++;
  }
  // A promoted piece shows up as an extra queen (etc.) and a missing pawn: count it as the pawn
  // being back, so the captured list never shows a piece that was never taken.
  const missing = (side: "w" | "b") => {
    const c = { ...count[side] };
    for (const t of ["q", "r", "b", "n"] as const) {
      const extra = Math.max(0, c[t] - START[t]);
      c[t] -= extra;
      c.p += extra;
    }
    return ORDER.flatMap((t) => Array<PieceType>(Math.max(0, START[t] - c[t])).fill(t));
  };
  const points = (side: "w" | "b") => ORDER.reduce((s, t) => s + count[side][t] * VALUES[t], 0);
  return { captured: { white: missing("b"), black: missing("w") }, diff: points("w") - points("b") };
}
