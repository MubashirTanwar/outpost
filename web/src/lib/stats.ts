/** Progress-over-time numbers from reviewed games (backend history or local reviews). */

export type Result = "win" | "loss" | "draw";

export interface HistoryRow {
  id: string;
  t: number; // ms since epoch
  timeClass: string;
  rating: number | null;
  accuracy: number | null;
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  result: Result | null;
  opponent: string;
}

/** The shape the backend's /history rows and local reviews share (loosely). */
export interface RawGame {
  id: string;
  end_time: number; // seconds
  time_class: string;
  player_color: "white" | "black" | null;
  white: string;
  black: string;
  white_result: string;
  black_result: string;
  white_rating: number | null;
  black_rating: number | null;
  accuracy?: number | null;
  rating?: number | null;
  counts?: Partial<Record<string, number>>;
  blunders?: number;
  mistakes?: number;
  inaccuracies?: number;
}

const DRAWS = ["agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"];

export function toRow(g: RawGame): HistoryRow {
  const color = g.player_color;
  const code = color === "black" ? g.black_result : g.white_result;
  const result: Result | null = !color ? null : code === "win" ? "win" : DRAWS.includes(code) ? "draw" : "loss";
  const count = (k: "blunder" | "mistake" | "inaccuracy", flat?: number) => flat ?? g.counts?.[k] ?? 0;
  return {
    id: g.id,
    t: g.end_time * 1000,
    timeClass: g.time_class,
    rating: g.rating ?? (color ? g[`${color}_rating`] : null) ?? null,
    accuracy: g.accuracy ?? null,
    blunders: count("blunder", g.blunders),
    mistakes: count("mistake", g.mistakes),
    inaccuracies: count("inaccuracy", g.inaccuracies),
    result,
    opponent: color === "black" ? g.white : color === "white" ? g.black : "",
  };
}

const DAY = 86400_000;

/** Rows in the last `days` days, oldest first. `offset` periods back gives the previous window. */
export function inRange(rows: HistoryRow[], days: number, now: number, offset = 0): HistoryRow[] {
  const end = now - offset * days * DAY;
  const start = end - days * DAY;
  return rows.filter((r) => r.t > start && r.t <= end).sort((a, b) => a.t - b.t);
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export interface Summary {
  games: number;
  accuracy: number | null;
  blundersPerGame: number | null;
  winRate: number | null;
  results: Record<Result, number>;
}

export function summarize(rows: HistoryRow[]): Summary {
  const results = { win: 0, loss: 0, draw: 0 };
  for (const r of rows) if (r.result) results[r.result]++;
  const decided = results.win + results.loss + results.draw;
  return {
    games: rows.length,
    accuracy: mean(rows.flatMap((r) => (r.accuracy == null ? [] : [r.accuracy]))),
    blundersPerGame: mean(rows.map((r) => r.blunders)),
    winRate: decided ? (100 * (results.win + results.draw / 2)) / decided : null,
    results,
  };
}

/** Trailing mean over the last `window` values (shorter at the start). */
export function rollingAverage(values: (number | null)[], window: number): (number | null)[] {
  return values.map((_, i) => mean(values.slice(Math.max(0, i - window + 1), i + 1).filter((v): v is number => v != null)));
}

/** Rating points per time class, oldest first. Classes with the most games come first. */
export function ratingSeries(rows: HistoryRow[]): { timeClass: string; points: { t: number; rating: number; id: string }[] }[] {
  const by = new Map<string, { t: number; rating: number; id: string }[]>();
  for (const r of [...rows].sort((a, b) => a.t - b.t)) {
    if (r.rating == null) continue;
    const list = by.get(r.timeClass) ?? [];
    list.push({ t: r.t, rating: r.rating, id: r.id });
    by.set(r.timeClass, list);
  }
  return [...by.entries()].sort((a, b) => b[1].length - a[1].length).map(([timeClass, points]) => ({ timeClass, points }));
}

/** "Nice" axis ticks covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  if (ticks[ticks.length - 1] < hi) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

export interface Bucket {
  start: number;
  games: number;
  blunders: number;
  mistakes: number;
  perGame: number | null; // blunders per game
}

/** Group rows into fixed windows ending at `now` (daily for short ranges, weekly for long ones). */
export function buckets(rows: HistoryRow[], days: number, now: number): Bucket[] {
  const size = (days <= 31 ? 1 : 7) * DAY;
  const n = Math.ceil((days * DAY) / size);
  const first = now - n * size;
  const out: Bucket[] = Array.from({ length: n }, (_, i) => ({ start: first + i * size, games: 0, blunders: 0, mistakes: 0, perGame: null }));
  for (const r of rows) {
    const i = Math.floor((r.t - first) / size);
    if (i < 0 || i >= n) continue;
    out[i].games++;
    out[i].blunders += r.blunders;
    out[i].mistakes += r.mistakes;
  }
  for (const b of out) b.perGame = b.games ? b.blunders / b.games : null;
  return out;
}
