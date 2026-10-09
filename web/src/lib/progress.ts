/**
 * Course progress: spaced repetition per line, XP, levels, streaks and achievements.
 * Pure functions (no storage, no React) so they're easy to test and to merge across devices.
 */

export interface LineProgress {
  stage: number; // 0 = not learned, 1..MAX_STAGE = spaced-repetition box
  due: number; // ms timestamp of the next review
  learnedAt: number;
  lastAt: number;
  reviews: number;
  lapses: number; // reviews with mistakes
}

export interface QuizProgress {
  seen: number;
  correct: number;
  lastAt: number;
}

export interface Progress {
  version: 1;
  xp: number;
  lines: Record<string, LineProgress>; // key: "<courseId>/<lineId>"
  quizzes: Record<string, QuizProgress>;
  days: Record<string, number>; // "YYYY-MM-DD" -> XP earned that day
  achievements: string[];
  dailyGoal: number;
  updatedAt: number;
}

const HOUR = 3600_000;
// Review ladder in hours: 4h, 1d, 3d, 1w, 2w, 1mo, 3mo, 6mo (similar to Chessable's default ladder).
export const INTERVALS_H = [4, 24, 72, 168, 336, 720, 2160, 4320];
export const MAX_STAGE = INTERVALS_H.length;
export const MASTERED_STAGE = 4; // survived the one-week review

export const XP = { learn: 20, reviewPerfect: 10, reviewMistakes: 4, quizCorrect: 5, quizWrong: 1 } as const;

export function emptyProgress(): Progress {
  return { version: 1, xp: 0, lines: {}, quizzes: {}, days: {}, achievements: [], dailyGoal: 50, updatedAt: 0 };
}

export function lineKey(courseId: string, lineId: string) {
  return `${courseId}/${lineId}`;
}

export function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addXp(p: Progress, amount: number, now: number): Progress {
  const day = dayKey(now);
  return { ...p, xp: p.xp + amount, days: { ...p.days, [day]: (p.days[day] ?? 0) + amount }, updatedAt: now };
}

/** First time through a line (learn + practice). */
export function recordLearned(p: Progress, key: string, now: number): { progress: Progress; xp: number } {
  const existing = p.lines[key];
  if (existing && existing.stage > 0) return recordReview(p, key, 0, now);
  const line: LineProgress = { stage: 1, due: now + INTERVALS_H[0] * HOUR, learnedAt: now, lastAt: now, reviews: 0, lapses: 0 };
  return { progress: addXp({ ...p, lines: { ...p.lines, [key]: line } }, XP.learn, now), xp: XP.learn };
}

/**
 * A review from memory. Perfect -> next box; mistakes -> drop back two boxes (min 1).
 * Reviewing early (not yet due) still counts but can't climb more than one box per day.
 */
export function recordReview(p: Progress, key: string, mistakes: number, now: number): { progress: Progress; xp: number } {
  const prev = p.lines[key];
  if (!prev || prev.stage === 0) return recordLearned(p, key, now);
  const early = now < prev.due && now - prev.lastAt < 20 * HOUR;
  let stage: number;
  if (mistakes === 0) stage = early ? prev.stage : Math.min(MAX_STAGE, prev.stage + 1);
  else stage = Math.max(1, prev.stage - 2);
  const line: LineProgress = {
    ...prev,
    stage,
    due: now + INTERVALS_H[stage - 1] * HOUR,
    lastAt: now,
    reviews: prev.reviews + 1,
    lapses: prev.lapses + (mistakes ? 1 : 0),
  };
  const xp = mistakes ? XP.reviewMistakes : XP.reviewPerfect;
  return { progress: addXp({ ...p, lines: { ...p.lines, [key]: line } }, xp, now), xp };
}

export function recordQuiz(p: Progress, quizId: string, correct: boolean, now: number): { progress: Progress; xp: number } {
  const prev = p.quizzes[quizId] ?? { seen: 0, correct: 0, lastAt: 0 };
  const q: QuizProgress = { seen: prev.seen + 1, correct: prev.correct + (correct ? 1 : 0), lastAt: now };
  const xp = correct ? XP.quizCorrect : XP.quizWrong;
  return { progress: addXp({ ...p, quizzes: { ...p.quizzes, [quizId]: q } }, xp, now), xp };
}

export type LineStatus = "new" | "learning" | "mastered";

export function lineStatus(lp: LineProgress | undefined): LineStatus {
  if (!lp || lp.stage === 0) return "new";
  return lp.stage >= MASTERED_STAGE ? "mastered" : "learning";
}

export function isDue(lp: LineProgress | undefined, now: number): boolean {
  return !!lp && lp.stage > 0 && lp.due <= now;
}

export function courseSummary(p: Progress, courseId: string, lineIds: string[], now: number) {
  let learned = 0, mastered = 0, due = 0;
  for (const id of lineIds) {
    const lp = p.lines[lineKey(courseId, id)];
    const s = lineStatus(lp);
    if (s !== "new") learned++;
    if (s === "mastered") mastered++;
    if (isDue(lp, now)) due++;
  }
  const total = lineIds.length;
  return { total, learned, mastered, due, percent: total ? Math.round((learned / total) * 100) : 0 };
}

export function streak(p: Progress, now: number): number {
  let count = 0;
  const d = new Date(now);
  // Today not done yet doesn't break the streak; it just isn't counted.
  if (!p.days[dayKey(d.getTime())]) d.setDate(d.getDate() - 1);
  while (p.days[dayKey(d.getTime())]) {
    count++;
    d.setDate(d.getDate() - 1);
  }
  return count;
}

/** Level n needs 50 * n^2 XP in total: 50, 200, 450, 800, ... */
export function level(xp: number): { level: number; into: number; needed: number } {
  const lvl = Math.floor(Math.sqrt(xp / 50));
  const base = 50 * lvl * lvl;
  const next = 50 * (lvl + 1) * (lvl + 1);
  return { level: lvl + 1, into: xp - base, needed: next - base };
}

export interface Achievement {
  id: string;
  title: string;
  text: string;
  icon: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first-line", title: "First steps", text: "Learn your first line", icon: "♟" },
  { id: "ten-lines", title: "Building a repertoire", text: "Learn 10 lines", icon: "📘" },
  { id: "fifty-lines", title: "Theory nerd", text: "Learn 50 lines", icon: "📚" },
  { id: "first-master", title: "Locked in", text: "Master a line (survive the 1-week review)", icon: "👑" },
  { id: "streak-3", title: "On a roll", text: "3-day streak", icon: "🔥" },
  { id: "streak-7", title: "Week warrior", text: "7-day streak", icon: "⚡" },
  { id: "streak-30", title: "Unstoppable", text: "30-day streak", icon: "🏆" },
  { id: "quiz-25", title: "Quiz whiz", text: "Answer 25 quiz questions correctly", icon: "🧠" },
  { id: "course-complete", title: "Graduate", text: "Learn every line in a course", icon: "🎓" },
];

export function checkAchievements(p: Progress, courses: { id: string; lineIds: string[] }[], now: number): { progress: Progress; unlocked: Achievement[] } {
  const have = new Set(p.achievements);
  const learned = Object.values(p.lines).filter((l) => l.stage > 0).length;
  const masteredAny = Object.values(p.lines).some((l) => l.stage >= MASTERED_STAGE);
  const s = streak(p, now);
  const quizCorrect = Object.values(p.quizzes).reduce((n, q) => n + q.correct, 0);
  const courseDone = courses.some((c) => c.lineIds.length && c.lineIds.every((id) => (p.lines[lineKey(c.id, id)]?.stage ?? 0) > 0));
  const earned: Record<string, boolean> = {
    "first-line": learned >= 1,
    "ten-lines": learned >= 10,
    "fifty-lines": learned >= 50,
    "first-master": masteredAny,
    "streak-3": s >= 3,
    "streak-7": s >= 7,
    "streak-30": s >= 30,
    "quiz-25": quizCorrect >= 25,
    "course-complete": courseDone,
  };
  const unlocked = ACHIEVEMENTS.filter((a) => earned[a.id] && !have.has(a.id));
  if (!unlocked.length) return { progress: p, unlocked };
  return { progress: { ...p, achievements: [...p.achievements, ...unlocked.map((a) => a.id)] }, unlocked };
}

/**
 * Merge two copies of progress (e.g. this browser and the server). Per line, keep the copy
 * that was practised most recently; XP and daily totals take the max; achievements union.
 */
export function mergeProgress(a: Progress, b: Progress): Progress {
  const lines: Record<string, LineProgress> = { ...a.lines };
  for (const [k, v] of Object.entries(b.lines)) if (!lines[k] || v.lastAt > lines[k].lastAt) lines[k] = v;
  const quizzes: Record<string, QuizProgress> = { ...a.quizzes };
  for (const [k, v] of Object.entries(b.quizzes)) if (!quizzes[k] || v.lastAt > quizzes[k].lastAt) quizzes[k] = v;
  const days: Record<string, number> = { ...a.days };
  for (const [k, v] of Object.entries(b.days)) days[k] = Math.max(days[k] ?? 0, v);
  return {
    version: 1,
    xp: Math.max(a.xp, b.xp),
    lines,
    quizzes,
    days,
    achievements: Array.from(new Set([...a.achievements, ...b.achievements])),
    dailyGoal: a.updatedAt >= b.updatedAt ? a.dailyGoal : b.dailyGoal,
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
  };
}
