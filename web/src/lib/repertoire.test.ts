import assert from "node:assert/strict";
import { test } from "node:test";
import { Chess } from "chess.js";
import { bookReply, buildRepertoire, expectedMove } from "./repertoire.ts";

function line(id: string, sans: string[]) {
  const c = new Chess();
  return { id, name: id, moves: sans.map((s) => { const m = c.move(s); return { san: m.san, uci: m.from + m.to, fen: c.fen(), note: null }; }) };
}

const course = {
  color: "white" as const,
  chapters: [{ id: "c", title: "", intro: "", quizzes: [], lines: [line("a", ["e4", "e5", "Nf3", "Nc6", "Bc4"]), line("b", ["e4", "c5", "Nf3"])] }],
};

test("learner moves and opponent replies come from every line", () => {
  const rep = buildRepertoire(course);
  assert.equal(expectedMove(rep, new Chess().fen())?.san, "e4");
  const afterE4 = new Chess(); afterE4.move("e4");
  const replies = rep.replies.get(afterE4.fen().split(" ").slice(0, 4).join(" "))!.map((r) => r.san).sort();
  assert.deepEqual(replies, ["c5", "e5"]);
  assert.equal(bookReply(rep, afterE4.fen(), () => 0)?.san, "e5"); // first line's reply
  assert.equal(bookReply(rep, afterE4.fen(), () => 0.99)?.san, "c5"); // last line's reply
  const out = new Chess(); out.move("d4");
  assert.equal(bookReply(rep, out.fen()), null);
  assert.equal(expectedMove(rep, out.fen()), null);
});
