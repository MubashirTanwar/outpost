import assert from "node:assert/strict";
import { test } from "node:test";
import { ratingChanges, ratingSummary, timeControlLabel, type RatedGame } from "./timecontrol.ts";

test("time control labels", () => {
  assert.equal(timeControlLabel("600"), "10 min");
  assert.equal(timeControlLabel("180+2"), "3 | 2");
  assert.equal(timeControlLabel("60"), "1 min");
  assert.equal(timeControlLabel("30"), "30 sec");
  assert.equal(timeControlLabel("30+1"), "30s | 1");
  assert.equal(timeControlLabel("90+1"), "1.5 | 1");
  assert.equal(timeControlLabel("1/86400"), "1 day");
  assert.equal(timeControlLabel("1/259200"), "3 days");
  assert.equal(timeControlLabel(""), "");
});

const g = (id: string, t: number, tc: string, rating: number, color: "white" | "black" = "white", rated = true): RatedGame => ({
  id, end_time: t, time_class: tc, rated, player_color: color,
  white_rating: color === "white" ? rating : 1500, black_rating: color === "black" ? rating : 1500,
});

test("rating change is per time class, from the previous rated game", () => {
  const games = [g("b2", 4, "blitz", 1210, "black"), g("b1", 1, "blitz", 1200), g("r1", 2, "rapid", 1400), g("u", 3, "blitz", 1100, "white", false), g("r2", 5, "rapid", 1392)];
  assert.deepEqual(ratingChanges(games), { b1: null, r1: null, u: null, b2: 10, r2: -8 });
});

test("day summary uses earlier games for the starting rating", () => {
  const earlier = [g("y", 1, "blitz", 1190)];
  const day = [g("a", 10, "blitz", 1198), g("b", 11, "blitz", 1205), g("c", 12, "rapid", 1400)];
  const changes = ratingChanges([...earlier, ...day]);
  assert.deepEqual(ratingSummary(day, changes), [
    { timeClass: "blitz", games: 2, end: 1205, change: 15 },
    { timeClass: "rapid", games: 1, end: 1400, change: null },
  ]);
});
