import assert from "node:assert/strict";
import { test } from "node:test";
import { acpl, gameRating, ratingFromAcpl } from "./gameRating.ts";
import type { Classification, Color, MoveReview } from "./types.ts";

function mv(color: Color, eval_cp: number, classification: Classification = "good", eval_mate: number | null = null): MoveReview {
  return { color, eval_cp, eval_mate, classification } as MoveReview;
}
const START = { cp: 20, mate: null };

test("the ACPL curve: strong play rates high, sloppy play low", () => {
  assert.equal(Math.round(ratingFromAcpl(0)), 3100);
  assert.ok(Math.abs(ratingFromAcpl(50) - 1880) < 5);
  assert.ok(Math.abs(ratingFromAcpl(100) - 1140) < 5);
  assert.equal(ratingFromAcpl(1000), 100);
});

test("losses are counted per side, book moves skipped, gains never count", () => {
  const moves = [mv("white", 30, "book"), mv("black", 30, "book"), mv("white", -70), mv("black", 10), mv("white", 0)];
  // White: 30 -> -70 is a 100 loss; 10 -> 0 a 10 loss. Black: -70 -> 10 is a gain for White, so 80 lost.
  assert.deepEqual(acpl(moves, "white", START), { acpl: 55, moves: 2 });
  assert.deepEqual(acpl(moves, "black", START), { acpl: 80, moves: 1 });
});

test("mates count as ten pawns, not a hundred thousand", () => {
  const moves = [mv("white", 50), mv("black", 100000, "blunder", 3)];
  assert.deepEqual(acpl(moves, "black", START), { acpl: 950, moves: 1 });
});

test("short games lean on the real rating, long ones on the play", () => {
  const perfect = (n: number) => Array.from({ length: 2 * n }, (_, i) => mv(i % 2 ? "black" : "white", 20));
  assert.equal(gameRating(perfect(3), "white", START, 1200), Math.round((3 * 3100 + 12 * 1200) / 15));
  assert.ok(gameRating(perfect(40), "white", START, 1200)! > 2500);
  assert.equal(gameRating(perfect(3), "white", START), 3100);
  assert.equal(gameRating([mv("white", 20, "book")], "white", START, 1500), null);
});
