import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INTERVALS_H,
  MASTERED_STAGE,
  XP,
  checkAchievements,
  courseSummary,
  emptyProgress,
  level,
  lineStatus,
  mergeProgress,
  recordLearned,
  recordQuiz,
  recordReview,
  streak,
} from "./progress.ts";

const H = 3600_000;
const T0 = new Date(2026, 9, 9, 12).getTime();

test("learning puts a line in box 1, due in 4 hours", () => {
  const { progress, xp } = recordLearned(emptyProgress(), "italian/main", T0);
  const lp = progress.lines["italian/main"];
  assert.equal(lp.stage, 1);
  assert.equal(lp.due, T0 + INTERVALS_H[0] * H);
  assert.equal(xp, XP.learn);
  assert.equal(progress.xp, XP.learn);
  assert.equal(lineStatus(lp), "learning");
});

test("perfect reviews climb the ladder to mastered; mistakes drop two boxes", () => {
  let p = recordLearned(emptyProgress(), "k", T0).progress;
  let t = T0;
  for (let i = 0; i < MASTERED_STAGE - 1; i++) {
    t = p.lines.k.due;
    p = recordReview(p, "k", 0, t).progress;
  }
  assert.equal(p.lines.k.stage, MASTERED_STAGE);
  assert.equal(lineStatus(p.lines.k), "mastered");
  p = recordReview(p, "k", 2, p.lines.k.due).progress;
  assert.equal(p.lines.k.stage, MASTERED_STAGE - 2);
  assert.equal(p.lines.k.lapses, 1);
});

test("cramming early doesn't skip boxes", () => {
  let p = recordLearned(emptyProgress(), "k", T0).progress;
  p = recordReview(p, "k", 0, T0 + H).progress;
  assert.equal(p.lines.k.stage, 1);
});

test("streaks count consecutive days and survive an unfinished today", () => {
  let p = emptyProgress();
  for (let d = 0; d < 3; d++) p = recordQuiz(p, `q${d}`, true, T0 - d * 24 * H).progress;
  assert.equal(streak(p, T0), 3);
  assert.equal(streak(p, T0 + 24 * H), 3); // tomorrow, nothing done yet
  assert.equal(streak(p, T0 + 48 * H), 0); // missed a day
});

test("levels", () => {
  assert.deepEqual(level(0), { level: 1, into: 0, needed: 50 });
  assert.equal(level(50).level, 2);
  assert.equal(level(199).level, 2);
  assert.equal(level(200).level, 3);
});

test("course summary and achievements", () => {
  let p = recordLearned(emptyProgress(), "c/a", T0).progress;
  p = recordLearned(p, "c/b", T0).progress;
  const s = courseSummary(p, "c", ["a", "b", "c"], T0 + 5 * H);
  assert.deepEqual(s, { total: 3, learned: 2, mastered: 0, due: 2, percent: 67 });
  const { unlocked } = checkAchievements(p, [{ id: "c", lineIds: ["a", "b"] }], T0);
  assert.deepEqual(unlocked.map((a) => a.id).sort(), ["course-complete", "first-line"]);
});

test("merge keeps the most recently practised copy of each line", () => {
  const a = recordLearned(emptyProgress(), "x", T0).progress;
  let b = recordLearned(emptyProgress(), "x", T0 - H).progress;
  b = recordLearned(b, "y", T0 + H).progress;
  const m = mergeProgress(a, b);
  assert.equal(m.lines.x.learnedAt, T0);
  assert.ok(m.lines.y);
  assert.equal(m.xp, Math.max(a.xp, b.xp));
});
