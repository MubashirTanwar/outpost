import assert from "node:assert/strict";
import { test } from "node:test";
import { back, forward, inVariation, jump, lineText, play, type Nav } from "./variation.ts";

const s = (uci: string) => ({ uci, san: uci, fen: uci });

test("back steps through the variation one move at a time and keeps it", () => {
  let n: Nav = { ply: 10, variation: null };
  n = play(n, s("a"), "game");
  n = play(n, s("b"));
  n = play(n, s("c"));
  assert.equal(n.variation!.cursor, 3);
  n = back(n);
  assert.equal(n.variation!.cursor, 2);
  assert.equal(n.ply, 10);
  n = back(n);
  n = back(n);
  assert.equal(inVariation(n), false); // at the branch point
  assert.equal(n.variation!.moves.length, 3); // still remembered
  n = back(n);
  assert.equal(n.ply, 9); // now back through the game
  assert.equal(n.variation!.moves.length, 3);
});

test("forward re-enters the remembered line and stops at its end", () => {
  let n: Nav = { ply: 10, variation: { base: 10, moves: [s("a"), s("b")], cursor: 1 } };
  n = forward(n, 40);
  assert.equal(n.variation!.cursor, 2);
  n = forward(n, 40);
  assert.equal(n.variation!.cursor, 2);
  assert.equal(n.ply, 10);
  // From the base position (cursor 0) forward follows the game.
  n = forward({ ply: 10, variation: { base: 10, moves: [s("a")], cursor: 0 } }, 40);
  assert.equal(n.ply, 11);
});

test("playing a different move mid-line replaces the rest; the same move steps forward", () => {
  let n: Nav = { ply: 4, variation: { base: 4, moves: [s("a"), s("b"), s("c")], cursor: 1 } };
  assert.equal(play(n, s("b")).variation!.moves.length, 3);
  assert.equal(play(n, s("b")).variation!.cursor, 2);
  n = play(n, s("x"));
  assert.deepEqual(n.variation!.moves.map((m) => m.uci), ["a", "x"]);
});

test("the game's own move steps the game; replaying the line's first move re-enters it", () => {
  const v = { base: 4, moves: [s("a"), s("b")], cursor: 0 };
  assert.deepEqual(play({ ply: 4, variation: v }, s("g"), "g"), { ply: 5, variation: v });
  assert.equal(play({ ply: 4, variation: v }, s("a"), "g").variation!.moves.length, 2);
  // A new line from another game position replaces the old one.
  assert.equal(play({ ply: 7, variation: v }, s("z"), "g").variation!.base, 7);
});

test("jump and lineText", () => {
  const n = jump({ ply: 20, variation: { base: 5, moves: [s("a"), s("b"), s("c")], cursor: 3 } }, 0);
  assert.deepEqual([n.ply, n.variation!.cursor], [5, 1]);
  assert.deepEqual(lineText(n.variation!).map((x) => x.label + x.san), ["3...a", "4.b", "c"]);
});
