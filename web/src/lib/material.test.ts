import assert from "node:assert/strict";
import { test } from "node:test";
import { material } from "./material.ts";

test("start position: nothing captured, level", () => {
  assert.deepEqual(material("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"), { captured: { white: [], black: [] }, diff: 0 });
});

test("captures and balance", () => {
  // White took a knight and a pawn, Black took a bishop.
  const m = material("r1bqkbnr/ppp1pppp/8/8/8/8/PPPPPPPP/RN1QKBNR w KQkq - 0 1");
  assert.deepEqual(m.captured.white, ["n", "p"]);
  assert.deepEqual(m.captured.black, ["b"]);
  assert.equal(m.diff, 1);
});

test("a promoted queen is not shown as a capture", () => {
  // White has two queens and seven pawns (one promoted); Black lost the queen.
  const m = material("rnb1kbnr/pppppppp/8/8/8/8/PPPPPPP1/RNBQKBNQ w Qkq - 0 1");
  assert.deepEqual(m.captured.black, ["r"]);
  assert.deepEqual(m.captured.white, ["q"]);
  assert.equal(m.diff, 42 - 30); // QQ R BB NN 7P vs RR BB NN 8P
});
