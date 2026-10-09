/**
 * A side line explored off a reviewed game, like chess.com's analysis: the moves are kept in
 * memory and you step through them with back/forward instead of losing them.
 */

export interface VarStep {
  uci: string;
  san: string;
  fen: string;
}

export interface Variation {
  base: number; // game ply the variation branches from
  moves: VarStep[];
  cursor: number; // how many variation moves are on the board (0 = the base position)
}

export interface Nav {
  ply: number;
  variation: Variation | null;
}

/** True when the board is showing a position inside the variation. */
export function inVariation(n: Nav): boolean {
  return !!n.variation && n.ply === n.variation.base && n.variation.cursor > 0;
}

/** You played `step` on the board. `gameNext` is the game's own next move from the shown position. */
export function play(n: Nav, step: VarStep, gameNext?: string): Nav {
  const v = n.variation;
  if (v && inVariation(n)) {
    if (v.moves[v.cursor]?.uci === step.uci) return { ...n, variation: { ...v, cursor: v.cursor + 1 } };
    // A different move from inside the line replaces everything after this point.
    return { ...n, variation: { ...v, moves: [...v.moves.slice(0, v.cursor), step], cursor: v.cursor + 1 } };
  }
  // On the game line: the game's own move just steps the game forward.
  if (gameNext === step.uci) return { ...n, ply: n.ply + 1 };
  // Same first move as the remembered line from here: re-enter it.
  if (v && v.base === n.ply && v.moves[0]?.uci === step.uci) return { ...n, variation: { ...v, cursor: 1 } };
  return { ply: n.ply, variation: { base: n.ply, moves: [step], cursor: 1 } };
}

/** One move back: inside the line it steps back through it, otherwise back through the game. */
export function back(n: Nav): Nav {
  if (inVariation(n)) return { ...n, variation: { ...n.variation!, cursor: n.variation!.cursor - 1 } };
  return { ...n, ply: Math.max(0, n.ply - 1) };
}

/** One move forward: through the line when you're in it, otherwise through the game. */
export function forward(n: Nav, gameLength: number): Nav {
  const v = n.variation;
  if (v && inVariation(n) && v.cursor < v.moves.length) return { ...n, variation: { ...v, cursor: v.cursor + 1 } };
  if (inVariation(n)) return n; // end of the line
  return { ...n, ply: Math.min(gameLength, n.ply + 1) };
}

/** Jump to a move of the remembered line (index into `moves`). */
export function jump(n: Nav, index: number): Nav {
  const v = n.variation;
  if (!v) return n;
  return { ply: v.base, variation: { ...v, cursor: Math.max(0, Math.min(v.moves.length, index + 1)) } };
}

/** Move-numbered text for the line, e.g. "12. Nf3 Nc6 13. d4" or "12... Nc6 13. d4". */
export function lineText(v: Variation): { label: string; san: string }[] {
  return v.moves.map((m, i) => {
    const ply = v.base + i; // half-moves played before this one
    const white = ply % 2 === 0;
    const num = Math.floor(ply / 2) + 1;
    return { label: white ? `${num}.` : i === 0 ? `${num}...` : "", san: m.san };
  });
}
