// Mirrors backend/tests/test_review.py so the browser and server classifiers stay in step.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Chess } from "chess.js";
import { classify, gameAccuracy, isSacrifice, materialDiff, winPercent, type ClassifyInput } from "./classify.ts";

const BASE: Omit<ClassifyInput, "winBefore" | "winAfter"> = {
  playedBest: false,
  secondBestWin: null,
  sacrifice: false,
  isBook: false,
  onlyMove: false,
  isRecapture: false,
  prevOpponentClass: null,
};

test("win percent", () => {
  assert.equal(winPercent(0), 50);
  assert.ok(Math.abs(winPercent(300) + winPercent(-300) - 100) < 1e-9);
  assert.ok(winPercent(100000) > 97);
});

test("thresholds", () => {
  const cases: [number, string][] = [[0.5, "excellent"], [3, "good"], [7, "inaccuracy"], [15, "mistake"], [40, "blunder"]];
  for (const [loss, expected] of cases) assert.equal(classify({ ...BASE, winBefore: 60, winAfter: 60 - loss }), expected);
});

test("special cases", () => {
  assert.equal(classify({ ...BASE, winBefore: 60, winAfter: 60, playedBest: true }), "best");
  const great = { ...BASE, playedBest: true, secondBestWin: 30 };
  assert.equal(classify({ ...great, winBefore: 55, winAfter: 55 }), "great");
  assert.equal(classify({ ...great, winBefore: 55, winAfter: 55, isRecapture: true }), "best");
  assert.equal(classify({ ...great, winBefore: 55, winAfter: 55, givesMate: true }), "best");
  assert.equal(classify({ ...BASE, winBefore: 70, winAfter: 70, sacrifice: true }), "brilliant");
  assert.equal(classify({ ...BASE, winBefore: 40, winAfter: 40, sacrifice: true }), "excellent");
  assert.equal(classify({ ...BASE, winBefore: 80, winAfter: 55, prevOpponentClass: "blunder" }), "miss");
  assert.equal(classify({ ...BASE, winBefore: 80, winAfter: 10, prevOpponentClass: "blunder" }), "blunder");
  assert.equal(classify({ ...BASE, winBefore: 50, winAfter: 10, onlyMove: true }), "forced");
});

test("sacrifice detection", () => {
  assert.ok(isSacrifice("r1bq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R2QK2R w KQ - 0 8", "d3h7", ["g8h7", "f3g5"]));
  assert.ok(!isSacrifice("r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4", "b5c6", ["d7c6"]));
  assert.ok(isSacrifice("rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 2", "f3g5", ["d8g5"]));
});

test("accuracy and material", () => {
  assert.equal(gameAccuracy([]), null);
  assert.equal(gameAccuracy([100, 100]), 100);
  assert.ok((gameAccuracy([100, 10]) ?? 100) < 55);
  assert.equal(materialDiff(new Chess(), "w"), 0);
});
