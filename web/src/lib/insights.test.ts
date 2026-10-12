import assert from "node:assert/strict";
import { test } from "node:test";
import { clockStats, conversion, openings, punishRate, ratingGap, tilt, toIGame, type InsightMove, type InsightSource } from "./insights.ts";

let ply = 0;
/** A move; `win` is the mover's winning chances after it, `before` the best they had. */
const mv = (color: "white" | "black", win: number, cls = "best", extra: Partial<InsightMove> = {}): InsightMove => ({
  ply: ++ply, move_number: Math.ceil(ply / 2), color, san: `m${ply}`, classification: cls,
  win_before: extra.win_before ?? win, win_after: win, clock: null, phase: "middlegame", motifs: [], best_san: "Bx", ...extra,
});

function game(id: string, moves: InsightMove[], o: { result?: "win" | "loss" | "draw" | "timeout"; t?: number; me?: number; opp?: number; acc?: number; opening?: string; tc?: string } = {}): InsightSource {
  const code = o.result === "loss" ? "resigned" : o.result === "draw" ? "agreed" : o.result === "timeout" ? "timeout" : "win";
  return {
    game: {
      id, end_time: o.t ?? 1000, time_class: "blitz", time_control: o.tc ?? "300", player_color: "white",
      white: "me", black: `opp-${id}`, white_rating: o.me ?? 1200, black_rating: o.opp ?? 1200,
      white_result: code, black_result: code === "win" ? "resigned" : "win", opening: o.opening ?? "Italian Game", eco: "C50",
    },
    summary: { white: { accuracy: o.acc ?? 80 }, black: { accuracy: 70 } },
    moves,
  };
}
const games = (...srcs: InsightSource[]) => srcs.map((s) => toIGame(s)!);

test("toIGame reads the player's side and the result", () => {
  const g = toIGame(game("a", [], { result: "timeout", tc: "180+2" }))!;
  assert.equal(g.result, "loss");
  assert.equal(g.lostOnTime, true);
  assert.deepEqual([g.base, g.increment, g.opponent], [180, 2, "opp-a"]);
  assert.equal(toIGame({ ...game("b", []), game: { ...game("b", []).game!, player_color: null } }), null);
  assert.equal(toIGame(game("d", [], { tc: "1/86400" }))!.base, null);
});

test("conversion: winning positions won, thrown and saved", () => {
  const won = game("won", [mv("white", 60), mv("black", 15), mv("white", 90)]);
  // Reached 85%, then a 85 -> 30 blunder, then lost.
  const thrown = game("thrown", [mv("white", 85), mv("black", 15), mv("white", 30, "blunder", { win_before: 85 }), mv("black", 70)], { result: "loss" });
  // Was down to 10%, still drew.
  const saved = game("saved", [mv("white", 10), mv("black", 90), mv("white", 50)], { result: "draw" });
  const c = conversion(games(won, thrown, saved));
  assert.deepEqual([c.winning, c.converted, c.rate], [2, 1, 50]);
  assert.equal(c.thrown.length, 1);
  assert.equal(c.thrown[0].gameId, "thrown");
  assert.equal(c.thrown[0].san, thrown.moves[2].san);
  assert.deepEqual([c.losing, c.saved, c.saveRate], [1, 1, 100]);
  // A winning game lost on the clock, without a bad move, counts but has no move to show.
  const flagged = game("flag", [mv("white", 90), mv("black", 10), mv("white", 92, "best", { win_before: 93 })], { result: "timeout" });
  const c2 = conversion(games(won, flagged));
  assert.deepEqual([c2.winning, c2.converted, c2.thrown.length], [2, 1, 0]);
});

test("punish rate: replies to the opponent's mistakes", () => {
  const g = game("p", [
    mv("white", 50), mv("black", 20, "blunder"), mv("white", 80, "best"), // punished
    mv("black", 10, "mistake"), mv("white", 60, "mistake", { win_before: 90 }), // missed
    mv("black", 40, "inaccuracy"), mv("white", 60), // an inaccuracy isn't a chance
    mv("black", 5, "blunder"), // game over: no reply
  ]);
  const p = punishRate(games(g));
  assert.deepEqual([p.chances, p.punished, p.rate], [2, 1, 50]);
  assert.equal(p.missed[0].san, g.moves[4].san);
  assert.ok(p.missed[0].detail.startsWith(`after their ${g.moves[3].san}?`));
});

test("tilt: after a loss, after a win, and by game in the session", () => {
  const H = 3600_000 / 1000;
  const gs = games(
    game("1", [], { t: 0, result: "loss", acc: 80 }),
    game("2", [], { t: 0.5 * H, result: "win", acc: 60 }), // after a loss
    game("3", [], { t: 1 * H, result: "loss", acc: 90 }), // after a win
    game("4", [], { t: 1.5 * H, acc: 50 }), // after a loss
    game("5", [], { t: 10 * H, acc: 100 }), // new session
  );
  const t = tilt(gs);
  assert.deepEqual([t.afterLoss.games, t.afterLoss.accuracy, t.afterLoss.score], [2, 55, 100]);
  assert.deepEqual([t.afterWin.games, t.afterWin.accuracy], [1, 90]);
  assert.deepEqual(t.bySlot.map((s) => s.games), [2, 1, 1, 1]);
  assert.equal(t.bySlot[0].accuracy, 90);
});

test("clock: mistakes by time left and on fast moves", () => {
  const g = game("c", [
    mv("white", 50, "best", { clock: 290 }),
    mv("black", 50),
    mv("white", 50, "blunder", { clock: 289 }), // 1s spent: fast blunder, plenty of time
    mv("black", 50),
    mv("white", 50, "best", { clock: 100 }), // slow, 33% left
    mv("black", 50),
    mv("white", 50, "mistake", { clock: 20 }), // slow, under 10%
    mv("black", 50),
    mv("white", 50, "blunder", { clock: 10 }), // slow, under 10%: the worst
  ], { result: "timeout" });
  const c = clockStats(games(g));
  assert.deepEqual(c.bands.map((b) => [b.moves, b.errors]), [[2, 2], [0, 0], [3, 1]]);
  assert.deepEqual([c.fast.moves, c.fast.errors, c.slow.moves, c.slow.errors], [1, 1, 3, 2]);
  assert.equal(c.lostOnTime, 1);
  assert.equal(c.worst!.san, g.moves[8].san);
});

test("openings: per side, with win% when the opening ends", () => {
  const o = (id: string, result: "win" | "loss", after: number, opening = "Italian Game") =>
    game(id, [mv("white", 50, "book", { phase: "opening" }), mv("black", 100 - after, "book", { phase: "opening" }), mv("white", 50)], { result, opening });
  const rows = openings(games(o("1", "win", 60), o("2", "loss", 40), o("3", "win", 70, "London System")));
  assert.deepEqual(rows.map((r) => [r.opening, r.games, r.score, r.afterOpening]), [["Italian Game", 2, 50, 50], ["London System", 1, 100, 70]]);
});

test("rating gap: score vs expectation, and the biggest upset", () => {
  const r = ratingGap(games(
    game("a", [], { me: 1200, opp: 1350 }), // upset win vs +150
    game("b", [], { me: 1200, opp: 1210, result: "loss" }),
    game("c", [], { me: 1200, opp: 1000 }),
  ));
  assert.deepEqual(r.bands.map((b) => b.games), [1, 0, 1, 0, 1]);
  assert.equal(r.bands[0].score, 100);
  assert.deepEqual(r.upset, { gameId: "a", opponent: "opp-a", gap: 150, rating: 1350 });
  assert.ok(r.overPerformance! > 0);
});
