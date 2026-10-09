/** A course as a move tree: your repertoire move per position, and the opponent replies it covers. */
import { Chess } from "chess.js";
import type { Course } from "./courses.ts";

export interface RepMove {
  san: string;
  uci: string;
  lineId: string;
}

export interface Repertoire {
  learner: Map<string, RepMove>; // position (no move counters) -> your move
  replies: Map<string, RepMove[]>; // position -> opponent replies the course answers
}

export function positionKey(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

export function buildRepertoire(course: Pick<Course, "color" | "chapters">): Repertoire {
  const learnerColor = course.color === "white" ? "w" : "b";
  const learner = new Map<string, RepMove>();
  const replies = new Map<string, RepMove[]>();
  for (const chapter of course.chapters) {
    for (const line of chapter.lines) {
      const chess = new Chess();
      for (const m of line.moves) {
        const key = positionKey(chess.fen());
        const move: RepMove = { san: m.san, uci: m.uci, lineId: line.id };
        if (chess.turn() === learnerColor) {
          if (!learner.has(key)) learner.set(key, move);
        } else {
          const list = replies.get(key) ?? [];
          if (!list.some((r) => r.uci === m.uci)) list.push(move);
          replies.set(key, list);
        }
        chess.move({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci[4] });
      }
    }
  }
  return { learner, replies };
}

/** Pick a course reply for the bot (uniformly, so every line comes up). */
export function bookReply(rep: Repertoire, fen: string, random = Math.random): RepMove | null {
  const options = rep.replies.get(positionKey(fen));
  if (!options?.length) return null;
  return options[Math.floor(random() * options.length)];
}

/** Your repertoire move here, if the course has one. */
export function expectedMove(rep: Repertoire, fen: string): RepMove | null {
  return rep.learner.get(positionKey(fen)) ?? null;
}
