/** Rules for when an endgame drill is passed or failed. Pure functions, no data imports. */
import { Chess } from "chess.js";

export type Goal = "mate" | "promote" | "convert" | "draw";

export const GOAL_TEXT: Record<Goal, string> = {
  mate: "Deliver checkmate",
  promote: "Promote a pawn and stay winning",
  convert: "Win the material, then it's a basic mate",
  draw: "Hold the draw",
};

/** Moves you must survive in a "draw" drill without the engine making progress. */
export const HOLD_MOVES = 20;

export interface Verdict {
  done: boolean;
  ok: boolean;
  text: string;
}

const PENDING: Verdict = { done: false, ok: false, text: "" };

function onlyKing(chess: Chess, color: "w" | "b"): boolean {
  return chess.board().every((row) => row.every((p) => !p || p.color !== color || p.type === "k"));
}

function hasMatingMaterial(chess: Chess, color: "w" | "b"): boolean {
  const pieces = chess.board().flat().filter((p) => p && p.color === color && p.type !== "k");
  if (pieces.some((p) => p!.type === "q" || p!.type === "r" || p!.type === "p")) return true;
  const bishops = pieces.filter((p) => p!.type === "b").length;
  const knights = pieces.filter((p) => p!.type === "n").length;
  return bishops >= 2 || (bishops >= 1 && knights >= 1);
}

/**
 * Judge a drill position after a move.
 * `evalForUser` is the engine's evaluation in centipawns from the learner's side (null if unknown);
 * `userPromoted` is true if the learner's last move was a promotion.
 */
export function judgeDrill(
  chess: Chess,
  goal: Goal,
  side: "white" | "black",
  userMoves: number,
  evalForUser: number | null,
  userPromoted = false,
): Verdict {
  const me = side === "white" ? "w" : "b";
  const them = me === "w" ? "b" : "w";

  if (chess.isCheckmate()) {
    if (chess.turn() === me) return { done: true, ok: false, text: "Checkmated. Reset and try again." };
    return { done: true, ok: true, text: goal === "draw" ? "You even won it!" : "Checkmate! Drill complete." };
  }
  if (chess.isDraw() || chess.isStalemate()) {
    if (goal === "draw") return { done: true, ok: true, text: "Draw secured. Well defended!" };
    return { done: true, ok: false, text: chess.isStalemate() ? "Stalemate! Leave the king a square next time." : "That's a draw. You needed to win." };
  }

  if (goal === "convert" && onlyKing(chess, them) && hasMatingMaterial(chess, me))
    return { done: true, ok: true, text: "Only a bare king left. You know the rest." };
  if (goal === "promote") {
    if (userPromoted && evalForUser !== null && evalForUser >= 400) return { done: true, ok: true, text: "New queen, and it's winning. Drill complete." };
    if (onlyKing(chess, them) && hasMatingMaterial(chess, me) && evalForUser !== null && evalForUser >= 400)
      return { done: true, ok: true, text: "Their last defender is gone. Drill complete." };
  }

  if (evalForUser !== null) {
    if (goal === "draw") {
      if (evalForUser <= -500) return { done: true, ok: false, text: "That position is lost now. Try again." };
      if (userMoves >= HOLD_MOVES && evalForUser >= -150) return { done: true, ok: true, text: `Held for ${HOLD_MOVES} moves. That's a draw.` };
    } else if (evalForUser <= 50) {
      return { done: true, ok: false, text: "It's not winning any more. Reset and try again." };
    }
  }
  return PENDING;
}

/** 3 stars: clean. 2: one hint or one restart. 1: got there in the end. */
export function drillStars(hints: number, restarts: number): number {
  const cost = hints + restarts;
  return cost === 0 ? 3 : cost === 1 ? 2 : 1;
}
