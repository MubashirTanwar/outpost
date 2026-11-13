import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewStats } from "./reviewStats.ts";
import type { Review } from "./types.ts";

const counts = (o: Record<string, number>) => ({ brilliant: 0, great: 0, best: 0, excellent: 0, good: 0, book: 0, forced: 0, inaccuracy: 0, mistake: 0, miss: 0, blunder: 0, ...o });
const mv = (ply: number, color: "white" | "black", san: string, win_loss: number, eval_cp = 20) =>
  ({ ply, color, san, win_loss, eval_cp, eval_mate: null, classification: win_loss > 20 ? "blunder" : "good" }) as Review["moves"][number];

const review = {
  player_color: "black",
  start_eval: { cp: 20, mate: null },
  summary: {
    white: { accuracy: 71.2, counts: counts({ blunder: 1 }), phase_accuracy: {} },
    black: { accuracy: 88.4, counts: counts({ brilliant: 1, mistake: 1, miss: 1 }), phase_accuracy: {} },
  },
  moves: [mv(0, "white", "e4", 0), mv(1, "black", "e5", 1), mv(2, "white", "Qh5", 35.5, -300), mv(3, "black", "Nc6", 2, -310)],
  game: { id: "1", white: "Alice", black: "Bob", white_rating: 1500, black_rating: "1400", white_result: "resigned", black_result: "win", time_class: "blitz", time_control: "180", player_color: "black", opening: "King's Pawn", eco: "C20" },
} as unknown as Review;

test("reviewStats: whose review, both sides, the worst moment", () => {
  const s = reviewStats(review)!;
  assert.equal(s.player, "bob");
  assert.equal(s.player_color, "black");
  assert.equal(s.plies, 4);
  assert.equal(s.white.blunders, 1);
  assert.equal(s.black.mistakes, 2);
  assert.equal(s.black.rating, 1400);
  assert.equal(s.black.result, "win");
  assert.deepEqual(s.worst, { color: "white", san: "Qh5", ply: 2, win_loss: 35.5 });
  assert.ok(s.white.game_rating! < 1500 && s.black.game_rating! > 1400);
});

test("reviewStats: no game, no stats", () => {
  assert.equal(reviewStats({ ...review, game: undefined } as Review), null);
});
