import assert from "node:assert/strict";
import { test } from "node:test";
import { acpl, chesscomToLichess, gameRating, lichessToChesscom, performance, ratingClass } from "./gameRating.ts";
import type { Classification, Color, MoveReview } from "./types.ts";

function mv(color: Color, eval_cp: number, classification: Classification = "good", eval_mate: number | null = null): MoveReview {
  return { color, eval_cp, eval_mate, classification } as MoveReview;
}
const START = { cp: 20, mate: null };

test("lower loss rates higher, in every time control, within bounds", () => {
  for (const cls of ["bullet", "blitz", "rapid", "classical"] as const) {
    const rs = [2, 20, 40, 60, 80, 100, 150, 400].map((l) => performance(l, 40, cls, 1500));
    for (let i = 1; i < rs.length; i++) assert.ok(rs[i] <= rs[i - 1], `${cls}: ${rs}`);
    assert.ok(rs[0] <= 3200 && rs[rs.length - 1] >= 100);
  }
});

test("a typical game for your rating rates about your rating", () => {
  // Median blitz ACPL for Lichess 1700 (chess.com ~1400) is ~66 in 30-move games.
  assert.ok(Math.abs(performance(66, 30, "blitz", 1400) - 1400) < 80);
});

test("long games move the estimate further than short ones", () => {
  const short = performance(20, 8, "blitz", 1200);
  const long = performance(20, 45, "blitz", 1200);
  assert.ok(short > 1200 && long > short, `${short} ${long}`);
});

test("Lichess ratings come down to chess.com's scale, less so higher up", () => {
  assert.ok(lichessToChesscom(1400) < 1100);
  assert.equal(lichessToChesscom(2600), 2600);
  assert.ok(Math.abs(lichessToChesscom(chesscomToLichess(1234)) - 1234) < 1e-9);
});

test("time classes from chess.com or a PGN time control", () => {
  assert.equal(ratingClass("blitz"), "blitz");
  assert.equal(ratingClass("daily"), "classical");
  assert.equal(ratingClass(null, "60+0"), "bullet");
  assert.equal(ratingClass(null, "180+2"), "blitz");
  assert.equal(ratingClass(null, "600+0"), "rapid");
  assert.equal(ratingClass(null, "1/86400"), "classical");
  assert.equal(ratingClass(), "blitz");
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

test("no moves of your own, no game rating; no real rating still gives one", () => {
  assert.equal(gameRating([mv("white", 20, "book")], "white", START, 1500), null);
  const moves = Array.from({ length: 60 }, (_, i) => mv(i % 2 ? "black" : "white", 20));
  assert.ok(gameRating(moves, "white", START)! > 1500);
});
