import assert from "node:assert/strict";
import { test } from "node:test";
import { buckets, inRange, niceTicks, ratingSeries, rollingAverage, summarize, toRow, type RawGame } from "./stats.ts";

const DAY = 86400_000;
const NOW = Date.UTC(2026, 9, 9, 12);

function game(over: Partial<RawGame> & { id: string; daysAgo: number }): RawGame {
  const { daysAgo, ...rest } = over;
  return {
    end_time: (NOW - daysAgo * DAY) / 1000,
    time_class: "blitz",
    player_color: "white",
    white: "me",
    black: "them",
    white_result: "win",
    black_result: "checkmated",
    white_rating: 1500,
    black_rating: 1490,
    ...rest,
  };
}

test("toRow reads the player's side, result and counts", () => {
  const r = toRow(game({ id: "a", daysAgo: 1, player_color: "black", black_result: "repetition", black_rating: 1320, counts: { blunder: 2, mistake: 1 }, accuracy: 81.5 }));
  assert.equal(r.rating, 1320);
  assert.equal(r.result, "draw");
  assert.equal(r.opponent, "me");
  assert.equal(r.blunders, 2);
  assert.equal(r.mistakes, 1);
  assert.equal(r.inaccuracies, 0);
  assert.equal(r.accuracy, 81.5);
  // Flat fields win over counts.
  assert.equal(toRow(game({ id: "b", daysAgo: 1, blunders: 4, counts: { blunder: 1 } })).blunders, 4);
  assert.equal(toRow(game({ id: "c", daysAgo: 1, white_result: "resigned" })).result, "loss");
});

test("inRange splits current and previous periods", () => {
  const rows = [1, 5, 9, 12, 25].map((d, i) => toRow(game({ id: String(i), daysAgo: d })));
  assert.deepEqual(inRange(rows, 7, NOW).map((r) => r.id), ["1", "0"]);
  assert.deepEqual(inRange(rows, 7, NOW, 1).map((r) => r.id), ["3", "2"]);
});

test("summarize averages accuracy over games that have it", () => {
  const rows = [
    toRow(game({ id: "a", daysAgo: 1, accuracy: 80, blunders: 1 })),
    toRow(game({ id: "b", daysAgo: 2, accuracy: 60, blunders: 3, white_result: "resigned" })),
    toRow(game({ id: "c", daysAgo: 3, accuracy: null, white_result: "agreed" })),
  ];
  const s = summarize(rows);
  assert.equal(s.games, 3);
  assert.equal(s.accuracy, 70);
  assert.equal(s.blundersPerGame, 4 / 3);
  assert.equal(s.winRate, 50);
  assert.deepEqual(s.results, { win: 1, loss: 1, draw: 1 });
  assert.equal(summarize([]).accuracy, null);
});

test("rollingAverage skips gaps", () => {
  assert.deepEqual(rollingAverage([10, null, 20, 30], 2), [10, 10, 20, 25]);
});

test("ratingSeries groups by time class, busiest first", () => {
  const rows = [
    toRow(game({ id: "a", daysAgo: 3, time_class: "rapid" })),
    toRow(game({ id: "b", daysAgo: 2, white_rating: 1510 })),
    toRow(game({ id: "c", daysAgo: 1, white_rating: 1520 })),
  ];
  const s = ratingSeries(rows);
  assert.deepEqual(s.map((x) => x.timeClass), ["blitz", "rapid"]);
  assert.deepEqual(s[0].points.map((p) => p.rating), [1510, 1520]);
});

test("niceTicks covers the range with round steps", () => {
  assert.deepEqual(niceTicks(1432, 1517), [1425, 1450, 1475, 1500, 1525]);
  assert.deepEqual(niceTicks(0, 100), [0, 25, 50, 75, 100]);
  assert.equal(niceTicks(5, 5).length > 1, true);
});

test("buckets are daily for a month and weekly beyond", () => {
  const rows = [0.5, 0.6, 3.5].map((d, i) => toRow(game({ id: String(i), daysAgo: d, blunders: i + 1 })));
  const daily = buckets(rows, 30, NOW);
  assert.equal(daily.length, 30);
  assert.deepEqual(daily[29], { start: NOW - DAY, games: 2, blunders: 3, mistakes: 0, perGame: 1.5 });
  assert.equal(daily[26].games, 1);
  const weekly = buckets(rows, 90, NOW);
  assert.equal(weekly.length, 13);
  assert.equal(weekly[12].games, 3);
  assert.equal(weekly[0].perGame, null);
});
