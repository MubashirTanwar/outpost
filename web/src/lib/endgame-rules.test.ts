import assert from "node:assert/strict";
import { test } from "node:test";
import { Chess } from "chess.js";
import { HOLD_MOVES, drillStars, judgeDrill } from "./endgame-rules.ts";
import { emptyProgress, mergeProgress, recordDrill } from "./progress.ts";

test("mate goal: checkmate passes, stalemate fails", () => {
  const mate = new Chess("4k3/8/4K3/8/8/8/8/7Q w - - 0 1");
  mate.move("Qh8#");
  assert.deepEqual(judgeDrill(mate, "mate", "white", 1, null).ok, true);
  const stale = new Chess("k7/8/1K6/8/8/8/8/2Q5 w - - 0 1");
  stale.move("Qc7");
  const v = judgeDrill(stale, "mate", "white", 1, null);
  assert.ok(v.done && !v.ok && v.text.includes("Stalemate"));
});

test("draw goal: insufficient material and surviving count as held", () => {
  const bare = new Chess("8/8/8/4k3/8/8/8/4K3 w - - 0 1");
  assert.ok(judgeDrill(bare, "draw", "black", 3, null).ok);
  const open = new Chess("3k4/8/1r6/3PK3/8/8/8/7R w - - 0 1");
  assert.equal(judgeDrill(open, "draw", "black", HOLD_MOVES - 1, 0).done, false);
  assert.ok(judgeDrill(open, "draw", "black", HOLD_MOVES, 0).ok);
  assert.ok(!judgeDrill(open, "draw", "black", 3, -800).ok);
});

test("promote and convert goals", () => {
  const b = new Chess("8/8/8/8/8/8/8/K6k w - - 0 1");
  // a promotion only counts when the engine agrees it's winning
  assert.equal(judgeDrill(b, "promote", "white", 5, 900, true).done, true);
  assert.equal(judgeDrill(new Chess("4k3/8/8/8/8/8/1P6/4K3 w - - 0 1"), "promote", "white", 5, 200, true).done, false);
  // convert: opponent down to a bare king while we keep a queen
  assert.ok(judgeDrill(new Chess("4k3/8/8/8/8/8/8/3QK3 b - - 0 1"), "convert", "white", 4, 1000).ok);
  // win goals fail once the advantage is gone
  assert.ok(!judgeDrill(new Chess("4k3/8/8/8/8/8/4P3/4K3 b - - 0 1"), "promote", "white", 4, 20).ok);
});

test("stars and drill progress", () => {
  assert.equal(drillStars(0, 0), 3);
  assert.equal(drillStars(1, 0), 2);
  assert.equal(drillStars(1, 2), 1);
  let { progress: p, xp } = recordDrill(emptyProgress(), "kq-k-1", 2, 1000);
  assert.equal(xp, 15);
  ({ progress: p, xp } = recordDrill(p, "kq-k-1", 3, 2000));
  assert.equal(xp, 7); // practice + one more star
  assert.equal(p.drills["kq-k-1"].stars, 3);
  ({ progress: p } = recordDrill(p, "kq-k-1", 1, 3000));
  assert.equal(p.drills["kq-k-1"].stars, 3); // best result is kept
  const merged = mergeProgress(emptyProgress(), p);
  assert.equal(merged.drills["kq-k-1"].stars, 3);
});
