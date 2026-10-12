/**
 * Deeper patterns across reviewed games: converting winning positions, punishing mistakes, tilt,
 * the clock, openings and opponent strength. Pure functions over reviews (backend or local).
 */
import type { Color } from "./types.ts";

export interface InsightMove {
  ply: number;
  move_number: number;
  color: Color;
  san: string;
  classification: string;
  win_before: number; // best achievable, mover's point of view
  win_after: number; // mover's point of view
  clock: number | null;
  phase: string;
  motifs: string[];
  best_san: string | null;
}

/** A review as the backend's /reviews endpoint sends it; a full local review fits too. */
export interface InsightSource {
  game?: {
    id: string;
    end_time: number;
    time_class: string;
    time_control?: string | null;
    player_color: Color | null;
    white: string;
    black: string;
    white_rating: number | null;
    black_rating: number | null;
    white_result: string;
    black_result: string;
    opening?: string | null;
    eco?: string | null;
  };
  summary: Record<Color, { accuracy: number | null }>;
  moves: InsightMove[];
}

export type Result = "win" | "loss" | "draw";

export interface IGame {
  id: string;
  t: number; // ms
  timeClass: string;
  base: number | null; // seconds on the clock at the start (null for daily)
  increment: number;
  color: Color;
  result: Result;
  lostOnTime: boolean;
  myRating: number | null;
  oppRating: number | null;
  opponent: string;
  opening: string;
  accuracy: number | null;
  moves: InsightMove[];
}

/** A move to link to: /u/<user>/game/<gameId>?ply=<ply>. */
export interface Moment {
  gameId: string;
  ply: number;
  san: string;
  moveNumber: number;
  color: Color;
  opponent: string;
  detail: string;
}

const DRAWS = ["agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"];
const ERRORS = new Set(["mistake", "blunder"]);
const SOUND = new Set(["brilliant", "great", "best", "excellent", "good", "book", "forced"]);
export const WINNING = 80;
export const LOSING = 20;
const SLIP = 10; // win% a move must cost to count as where a winning game slipped

export function toIGame(src: InsightSource): IGame | null {
  const g = src.game;
  const color = g?.player_color;
  if (!g || !color) return null;
  const opp: Color = color === "white" ? "black" : "white";
  const code = g[`${color}_result`];
  const [base, inc] = (g.time_control ?? "").includes("/") ? [NaN, 0] : (g.time_control ?? "").split("+").map(Number);
  return {
    id: g.id,
    t: g.end_time * 1000,
    timeClass: g.time_class,
    base: Number.isFinite(base) && base > 0 ? base : null,
    increment: Number.isFinite(inc) ? inc : 0,
    color,
    result: code === "win" ? "win" : DRAWS.includes(code) ? "draw" : "loss",
    lostOnTime: code === "timeout",
    myRating: g[`${color}_rating`] ?? null,
    oppRating: g[`${opp}_rating`] ?? null,
    opponent: g[opp],
    opening: g.opening || g.eco || "Unknown opening",
    accuracy: src.summary?.[color]?.accuracy ?? null,
    moves: src.moves ?? [],
  };
}

/** My winning chances after a move, whoever made it. */
export function myWin(m: InsightMove, me: Color): number {
  return m.color === me ? m.win_after : 100 - m.win_after;
}

const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : null);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const score = (rs: Result[]) => (rs.length ? (100 * rs.reduce((s, r) => s + (r === "win" ? 1 : r === "draw" ? 0.5 : 0), 0)) / rs.length : null);
const round1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);

function moment(g: IGame, m: InsightMove, detail: string): Moment {
  return { gameId: g.id, ply: m.ply, san: m.san, moveNumber: m.move_number, color: m.color, opponent: g.opponent, detail };
}

/** Of the games where you reached a winning position (80%+), how many you won; and where the rest slipped. */
export function conversion(games: IGame[]) {
  let winning = 0, converted = 0, losing = 0, saved = 0;
  const thrown: Moment[] = [];
  for (const g of games) {
    const series = g.moves.map((m) => myWin(m, g.color));
    const up = series.findIndex((w) => w >= WINNING);
    if (up >= 0) {
      winning++;
      if (g.result === "win") converted++;
      else {
        // The move after the winning point that cost the most (none, if the game ended on the clock
        // or by resignation without a bad move).
        const worst = g.moves
          .slice(up + 1)
          .filter((m) => m.color === g.color && m.win_before - m.win_after >= SLIP)
          .reduce<InsightMove | null>((w, m) => (!w || m.win_before - m.win_after > w.win_before - w.win_after ? m : w), null);
        if (worst) thrown.push(moment(g, worst, `${Math.round(worst.win_before)}% → ${Math.round(worst.win_after)}% · ${g.result === "draw" ? "drew" : "lost"}`));
      }
    }
    if (series.some((w) => w <= LOSING)) {
      losing++;
      if (g.result !== "loss") saved++;
    }
  }
  return { winning, converted, rate: pct(converted, winning), thrown, losing, saved, saveRate: pct(saved, losing) };
}

/** When the opponent made a mistake or blunder, how often your reply took advantage. */
export function punishRate(games: IGame[]) {
  let chances = 0, punished = 0;
  const missed: Moment[] = [];
  for (const g of games) {
    g.moves.forEach((m, i) => {
      const reply = g.moves[i + 1];
      if (m.color === g.color || !ERRORS.has(m.classification) || !reply) return;
      chances++;
      if (SOUND.has(reply.classification)) punished++;
      else missed.push(moment(g, reply, `after their ${m.san}${m.classification === "blunder" ? "??" : "?"} · best ${reply.best_san ?? "?"}`));
    });
  }
  // The costliest misses first.
  const cost = (x: Moment) => {
    const g = games.find((gg) => gg.id === x.gameId)!;
    const m = g.moves.find((mm) => mm.ply === x.ply)!;
    return m.win_before - m.win_after;
  };
  return { chances, punished, rate: pct(punished, chances), missed: missed.sort((a, b) => cost(b) - cost(a)) };
}

export const SESSION_GAP_MS = 60 * 60_000;

interface Bucket {
  label: string;
  games: number;
  accuracy: number | null;
  score: number | null;
}

function bucket(label: string, gs: IGame[]): Bucket {
  return { label, games: gs.length, accuracy: round1(avg(gs.flatMap((g) => (g.accuracy == null ? [] : [g.accuracy])))), score: round1(score(gs.map((g) => g.result))) };
}

/** Accuracy right after a loss vs after a win, and how it changes the longer a session goes. */
export function tilt(games: IGame[]) {
  const sorted = [...games].sort((a, b) => a.t - b.t);
  const afterLoss: IGame[] = [], afterWin: IGame[] = [];
  const slots: IGame[][] = [[], [], [], []];
  let slot = 0;
  sorted.forEach((g, i) => {
    const prev = sorted[i - 1];
    const sameSession = prev && g.t - prev.t <= SESSION_GAP_MS;
    slot = sameSession ? slot + 1 : 0;
    slots[Math.min(slot, 3)].push(g);
    if (sameSession && prev.result === "loss") afterLoss.push(g);
    if (sameSession && prev.result === "win") afterWin.push(g);
  });
  return {
    afterLoss: bucket("After a loss", afterLoss),
    afterWin: bucket("After a win", afterWin),
    bySlot: ["1st game", "2nd game", "3rd game", "4th game +"].map((label, i) => bucket(label, slots[i])),
  };
}

/** Mistakes per 100 moves by how much time you had left, and on moves played in under 2 seconds. */
export function clockStats(games: IGame[]) {
  const bands = [
    { label: "Under 10% left", test: (f: number) => f < 0.1, moves: 0, errors: 0 },
    { label: "10–30% left", test: (f: number) => f >= 0.1 && f < 0.3, moves: 0, errors: 0 },
    { label: "Over 30% left", test: (f: number) => f >= 0.3, moves: 0, errors: 0 },
  ];
  const fast = { moves: 0, errors: 0 }, slow = { moves: 0, errors: 0 };
  let worst: { g: IGame; m: InsightMove } | null = null;
  for (const g of games) {
    if (!g.base) continue;
    let prevClock: number | null = null;
    for (const m of g.moves) {
      if (m.color !== g.color || m.clock == null) continue;
      const err = ERRORS.has(m.classification);
      const band = bands.find((b) => b.test(m.clock! / g.base!))!;
      band.moves++;
      if (err) band.errors++;
      if (prevClock != null && m.phase !== "opening" && m.classification !== "book") {
        const spent = prevClock + g.increment - m.clock;
        const side = spent < 2 ? fast : slow;
        side.moves++;
        if (err) side.errors++;
      }
      if (m.classification === "blunder" && (!worst || m.clock < worst.m.clock!)) worst = { g, m };
      prevClock = m.clock;
    }
  }
  const rate = (x: { moves: number; errors: number }) => (x.moves ? Math.round((1000 * x.errors) / x.moves) / 10 : null);
  return {
    bands: bands.map(({ label, moves, errors }) => ({ label, moves, errors, per100: rate({ moves, errors }) })),
    fast: { ...fast, per100: rate(fast) },
    slow: { ...slow, per100: rate(slow) },
    lostOnTime: games.filter((g) => g.lostOnTime).length,
    worst: worst ? moment(worst.g, worst.m, `blunder with ${Math.round(worst.m.clock!)}s left`) : null,
  };
}

/** Your results per opening and side, and how good your position is when the opening ends. */
export function openings(games: IGame[], limit = 8) {
  const by = new Map<string, { opening: string; color: Color; games: IGame[] }>();
  for (const g of games) {
    const key = `${g.color}|${g.opening}`;
    if (!by.has(key)) by.set(key, { opening: g.opening, color: g.color, games: [] });
    by.get(key)!.games.push(g);
  }
  return [...by.values()]
    .map(({ opening, color, games: gs }) => {
      const out = gs.flatMap((g) => {
        const last = [...g.moves].reverse().find((m) => m.phase === "opening");
        return last ? [myWin(last, g.color)] : [];
      });
      return {
        opening,
        color,
        games: gs.length,
        wins: gs.filter((g) => g.result === "win").length,
        draws: gs.filter((g) => g.result === "draw").length,
        losses: gs.filter((g) => g.result === "loss").length,
        score: round1(score(gs.map((g) => g.result))),
        accuracy: round1(avg(gs.flatMap((g) => (g.accuracy == null ? [] : [g.accuracy])))),
        afterOpening: out.length ? Math.round(avg(out)!) : null,
      };
    })
    .sort((a, b) => b.games - a.games || a.opening.localeCompare(b.opening))
    .slice(0, limit);
}

const GAP_BANDS: [string, (d: number) => boolean][] = [
  ["100+ stronger", (d) => d >= 100],
  ["25–99 stronger", (d) => d >= 25 && d < 100],
  ["Within 25", (d) => Math.abs(d) < 25],
  ["25–99 weaker", (d) => d <= -25 && d > -100],
  ["100+ weaker", (d) => d <= -100],
];

/** Score against stronger, equal and weaker opponents, vs what the rating gap predicts. */
export function ratingGap(games: IGame[]) {
  const rated = games.filter((g) => g.myRating != null && g.oppRating != null);
  const gap = (g: IGame) => g.oppRating! - g.myRating!;
  const expected = (g: IGame) => 1 / (1 + 10 ** (gap(g) / 400));
  const actual = (g: IGame) => (g.result === "win" ? 1 : g.result === "draw" ? 0.5 : 0);
  const upset = rated.filter((g) => g.result === "win" && gap(g) > 0).sort((a, b) => gap(b) - gap(a))[0];
  return {
    bands: GAP_BANDS.map(([label, test]) => {
      const gs = rated.filter((g) => test(gap(g)));
      return { label, games: gs.length, score: round1(score(gs.map((g) => g.result))), expected: gs.length ? round1((100 * gs.reduce((s, g) => s + expected(g), 0)) / gs.length) : null };
    }),
    // Points scored above (or below) what the ratings predicted, over all games.
    overPerformance: rated.length ? Math.round(rated.reduce((s, g) => s + actual(g) - expected(g), 0) * 10) / 10 : null,
    upset: upset ? { gameId: upset.id, opponent: upset.opponent, gap: gap(upset), rating: upset.oppRating! } : null,
  };
}
