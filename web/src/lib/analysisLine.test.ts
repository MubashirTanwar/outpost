import assert from "node:assert/strict";
import { test } from "node:test";
import { START_FEN, fenAt, goTo, lastMove, lineFromText, moveRows, newLine, play, playUci, toPgn } from "./analysisLine.ts";

test("play, step back, and branch", () => {
  let l = newLine();
  for (const m of ["e4", "e5", "Nf3", "Nc6"]) l = play(l, m)!;
  assert.equal(l.cursor, 4);
  assert.deepEqual(lastMove(l), { from: "b8", to: "c6" });
  l = goTo(l, 2);
  assert.equal(fenAt(l), l.moves[1].fen);
  // Replaying the next move keeps the rest of the line.
  const same = play(l, "Nf3")!;
  assert.equal(same.moves.length, 4);
  assert.equal(same.cursor, 3);
  // A different move replaces it.
  const other = play(l, { from: "f1", to: "c4" })!;
  assert.deepEqual(other.moves.map((m) => m.san), ["e4", "e5", "Bc4"]);
  assert.equal(play(l, "Ke3"), null);
  assert.equal(goTo(l, 99).cursor, 4);
  assert.equal(goTo(l, -3).cursor, 0);
  assert.equal(fenAt(goTo(l, 0)), START_FEN);
});

test("engine moves in UCI, including promotion", () => {
  const l = playUci(newLine("8/P7/8/8/8/8/8/k6K w - - 0 1"), "a7a8q")!;
  assert.equal(l.moves[0].san, "a8=Q+");
});

test("load a FEN, a PGN, and a PGN from a set-up position", () => {
  const f = lineFromText("8/8/8/4k3/8/8/4P3/4K3 w - - 0 1");
  assert.deepEqual([f.moves.length, f.cursor], [0, 0]);
  const p = lineFromText('[Event "x"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 *');
  assert.deepEqual([p.moves.length, p.cursor, p.start], [5, 5, START_FEN]);
  const fromFen = lineFromText('[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/4P3/4K3 b - - 0 1"]\n\n1... Kd7 2. e4 *');
  assert.equal(fromFen.start, "4k3/8/8/8/8/8/4P3/4K3 b - - 0 1");
  assert.deepEqual(fromFen.moves.map((m) => m.san), ["Kd7", "e4"]);
  assert.throws(() => lineFromText("not chess"));
  assert.throws(() => lineFromText(""));
});

test("export PGN and the move list rows", () => {
  let l = newLine();
  for (const m of ["d4", "d5", "c4"]) l = play(l, m)!;
  assert.match(toPgn(l), /1\. d4 d5 2\. c4/);
  assert.deepEqual(moveRows(l), [{ number: 1, white: 0, black: 1 }, { number: 2, white: 2, black: null }]);
  // From a set-up position with Black to move, the first row starts with Black's move.
  let b = newLine("4k3/8/8/8/8/8/4P3/4K3 b - - 0 7");
  b = play(b, "Kd7")!;
  b = play(b, "e4")!;
  assert.deepEqual(moveRows(b), [{ number: 7, white: null, black: 0 }, { number: 8, white: 1, black: null }]);
  assert.match(toPgn(b), /\[FEN "4k3\/8\/8\/8\/8\/8\/4P3\/4K3 b - - 0 7"\]/);
});
