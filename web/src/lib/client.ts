"use client";

/**
 * One entry point for the UI. Uses the Python backend (agents, graph DB, native Stockfish)
 * when it's reachable, else falls back to browser-only mode (WASM Stockfish + localStorage).
 */
import { api, getHealth, pollJob, type BackfillResult } from "./api";
import { fetchDayGames, fetchGamesBetween, playerResult, tzOffset } from "./chesscom";
import { reviewPgn } from "./review";
import type { InsightSource } from "./insights";
import type { RawGame } from "./stats";
import { getBrowserEngine } from "./stockfish";
import { CLASSIFICATIONS, type Classification, type DayOverview, type GameMeta, type Puzzle, type Review } from "./types";

export type Progress = (stage: string, fraction: number) => void;

const BROWSER_DEPTH = 12;
const LS_PREFIX = "cc-review:";

function saveLocal(review: Review) {
  try {
    localStorage.setItem(LS_PREFIX + review.game!.id, JSON.stringify(review));
  } catch {
    // Storage full: drop the oldest reviews and try once more.
    try {
      Object.keys(localStorage).filter((k) => k.startsWith(LS_PREFIX)).slice(0, 10).forEach((k) => localStorage.removeItem(k));
      localStorage.setItem(LS_PREFIX + review.game!.id, JSON.stringify(review));
    } catch {}
  }
}

export function loadLocalReview(id: string): Review | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function browserReview(game: GameMeta, progress?: Progress, signal?: AbortSignal): Promise<Review> {
  const cached = loadLocalReview(game.id);
  if (cached) {
    // chess.com's own accuracy appears once the game is reviewed there: carry it into the cache.
    if (game.chesscom_white_accuracy != null && cached.game?.chesscom_white_accuracy == null) {
      cached.game = { ...game, pgn: undefined };
      saveLocal(cached);
    }
    return cached;
  }
  const engine = getBrowserEngine();
  const review = await reviewPgn(game.pgn!, (fen, depth, multipv, sig) => engine.analyse(fen, { depth, multipv, signal: sig }), {
    signal,
    depth: BROWSER_DEPTH,
    playerColor: game.player_color,
    onProgress: (d, t) => progress?.(`Analyzing move ${d}/${t}`, d / t),
  });
  review.game = { ...game, pgn: undefined };
  saveLocal(review);
  return review;
}

/** Reviewed games for the progress page: the backend's history, or this browser's saved reviews. */
export async function getHistory(username: string, days = 365): Promise<RawGame[]> {
  if (await isBackendMode()) return (await api.history(username, days)).games;
  const me = username.toLowerCase();
  const out: RawGame[] = [];
  let keys: string[] = [];
  try {
    keys = Object.keys(localStorage).filter((k) => k.startsWith(LS_PREFIX));
  } catch {}
  for (const key of keys) {
    // One unreadable entry (old format, corrupted) skips just that game.
    try {
      const review: Review = JSON.parse(localStorage.getItem(key)!);
      const g = review.game;
      if (!g || ![g.white, g.black].some((n) => n.toLowerCase() === me)) continue;
      const color = g.white.toLowerCase() === me ? "white" : "black";
      const side = review.summary[color];
      out.push({ ...g, player_color: color, accuracy: side.accuracy, counts: side.counts });
    } catch {}
  }
  return out;
}

/** Reviewed games with their moves, for the Insights section: from the backend, or this browser's reviews. */
export async function getInsightSources(username: string, days = 365): Promise<InsightSource[]> {
  if (await isBackendMode()) return (await api.reviews(username, days)).games;
  const me = username.toLowerCase();
  const since = Date.now() / 1000 - days * 86400;
  const out: InsightSource[] = [];
  let keys: string[] = [];
  try {
    keys = Object.keys(localStorage).filter((k) => k.startsWith(LS_PREFIX));
  } catch {}
  for (const key of keys) {
    try {
      const review: Review = JSON.parse(localStorage.getItem(key)!);
      const g = review.game;
      if (!g || g.end_time < since || ![g.white, g.black].some((n) => n.toLowerCase() === me)) continue;
      out.push({ ...review, game: { ...g, player_color: g.white.toLowerCase() === me ? "white" : "black" } });
    } catch {}
  }
  return out;
}

export async function isBackendMode(): Promise<boolean> {
  return (await getHealth()) !== null;
}

export async function getReview(username: string, gameId: string, progress?: Progress, day?: string, signal?: AbortSignal): Promise<Review> {
  if (await isBackendMode()) {
    try {
      return await api.getReview(gameId, username);
    } catch {
      const res = await api.reviewGame({ username, game_id: gameId, day, tz_offset: tzOffset(day) });
      if (res.review) return res.review;
      const out = await pollJob<{ review: Review }>(res.job_id!, (j) => progress?.(j.stage, j.progress));
      return out.review;
    }
  }
  const local = loadLocalReview(gameId);
  if (local) return local;
  if (!day) throw new Error("Game not reviewed yet: open it from the day overview.");
  const game = (await fetchDayGames(username, day)).find((g) => g.id === gameId);
  if (!game) throw new Error("Game not found on chess.com");
  return browserReview(game, progress, signal);
}

export async function reviewDay(username: string, day: string, progress: Progress, signal?: AbortSignal): Promise<DayOverview> {
  if (await isBackendMode()) {
    const { job_id } = await api.reviewDay({ username, day, tz_offset: tzOffset(day) });
    return pollJob<DayOverview>(job_id, (j) => progress(j.stage, j.progress));
  }
  progress("Fetching games from chess.com", 0.02);
  const games = await fetchDayGames(username, day);
  const reviews: Review[] = [];
  for (let i = 0; i < games.length; i++) {
    reviews.push(
      await browserReview(games[i], (stage, f) => progress(`Game ${i + 1}/${games.length}: ${stage}`, 0.05 + (0.9 * (i + f)) / games.length), signal),
    );
  }
  return buildLocalOverview(username, day, games, reviews);
}

/** Browser-mode stand-in for the backend's LangGraph day agent (no LLM, no graph history). */
function buildLocalOverview(username: string, day: string, games: GameMeta[], reviews: Review[]): DayOverview {
  const counts = Object.fromEntries(CLASSIFICATIONS.map((c) => [c, 0])) as Record<Classification, number>;
  const motifCount = new Map<string, number>();
  const phaseLoss = new Map<string, number>();
  const worst: NonNullable<DayOverview["summary"]>["worst_moments"] = [];
  const perGame: NonNullable<DayOverview["summary"]>["per_game"] = [];
  const accs: number[] = [];
  let wins = 0, draws = 0, losses = 0;
  const puzzles: Puzzle[] = [];

  games.forEach((g, i) => {
    const r = reviews[i];
    const color = g.player_color ?? "white";
    const mine = r.summary[color];
    CLASSIFICATIONS.forEach((c) => (counts[c] += mine.counts[c]));
    const res = playerResult(g);
    if (res === "win") wins++;
    else if (res === "draw") draws++;
    else losses++;
    if (mine.accuracy !== null) accs.push(mine.accuracy);
    const opponent = color === "white" ? g.black : g.white;
    perGame.push({
      id: g.id, url: g.url, opponent, color, result: res, accuracy: mine.accuracy,
      opponent_accuracy: r.summary[color === "white" ? "black" : "white"].accuracy,
      counts: mine.counts, time_class: g.time_class, opening: g.opening, eco: g.eco, end_time: g.end_time,
    });
    for (const m of r.moves) {
      if (m.color !== color) continue;
      for (const mo of m.motifs) {
        if (mo.endsWith("_phase")) phaseLoss.set(mo.replace("_phase", ""), (phaseLoss.get(mo.replace("_phase", "")) ?? 0) + m.win_loss);
        else motifCount.set(mo, (motifCount.get(mo) ?? 0) + 1);
      }
      if (m.classification === "blunder" || m.classification === "mistake" || m.classification === "miss") {
        worst.push({ ...m, game_id: g.id, opponent, best_san: m.best_san ?? "" });
        if (m.best_pv.length) {
          const motifs = m.motifs.filter((x) => !x.endsWith("_phase"));
          puzzles.push({
            id: `pz-${g.id}:${m.ply}`, game_id: g.id, fen: m.fen_before,
            solution: puzzleSolution(m.best_pv, motifs),
            played: m.san, best_san: m.best_san ?? "", motifs: motifs.length ? motifs : ["positional"],
            theme: motifs[0] ?? "positional", win_loss: m.win_loss, phase: m.phase,
          });
        }
      }
    }
  });
  worst.sort((a, b) => b.win_loss - a.win_loss);
  const today = Array.from(motifCount.entries()).sort((a, b) => b[1] - a[1]);
  const weakest = Array.from(phaseLoss.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const avg = accs.length ? Math.round((accs.reduce((a, b) => a + b, 0) / accs.length) * 10) / 10 : null;
  const withAcc = perGame.filter((g) => g.accuracy !== null);
  savePuzzles(username, puzzles);

  const lesson = games.length
    ? [
        `## Your day in chess: ${games.length} games, ${wins}W / ${draws}D / ${losses}L`,
        avg !== null ? `Average accuracy: **${avg}%**.` : "",
        `${counts.brilliant} brilliant and ${counts.great} great moves; ${counts.blunder} blunders, ${counts.mistake} mistakes and ${counts.miss} missed chances.`,
        worst.length ? "\n### Key moments to replay" : "",
        ...worst.slice(0, 3).map(
          (w) =>
            `- vs [${w.opponent}](game:${w.game_id}), move ${w.move_number}: you played [**${w.san}**](move:${w.game_id}:${w.ply}), best was **${w.best_san}** (−${w.win_loss.toFixed(0)}% winning chances).`,
        ),
        "\n_Browser-only mode: connect the backend for AI coaching, cross-game pattern memory and a personal puzzle queue._",
      ].filter(Boolean).join("\n")
    : null;

  return {
    username,
    day,
    games: games.length,
    summary: games.length
      ? {
          games: games.length, wins, draws, losses, avg_accuracy: avg, counts, per_game: perGame,
          best_game: withAcc.length ? withAcc.reduce((a, b) => (a.accuracy! >= b.accuracy! ? a : b)).id : null,
          worst_game: withAcc.length ? withAcc.reduce((a, b) => (a.accuracy! <= b.accuracy! ? a : b)).id : null,
          worst_moments: worst.slice(0, 8),
          openings: [],
        }
      : null,
    patterns: {
      today_motifs: today.map(([motif, count]) => ({ motif, count, historical: count, recurring: false })),
      weakest_phase: weakest,
      phase_losses: Object.fromEntries(phaseLoss),
    },
    lesson,
    lesson_source: "browser",
    plan: games.length ? { puzzles: puzzles.slice(0, 10), focus: [], opening: null, endgame: null, repertoire: [] } : null,
  };
}

/** Same rule as the backend: mates up to 5 plies, tactics 3, otherwise 1; always ends on your move. */
function puzzleSolution(pv: string[], motifs: string[]): string[] {
  const tactical = ["missed_tactic", "hanging_piece", "fork", "pin", "allowed_mate"];
  let plies = motifs.includes("missed_mate") ? 5 : motifs.some((m) => tactical.includes(m)) ? 3 : 1;
  plies = Math.min(plies, pv.length);
  return pv.slice(0, plies % 2 === 1 ? plies : plies - 1);
}

const PZ_KEY = "cc-puzzles:";

function savePuzzles(username: string, puzzles: Puzzle[]) {
  try {
    const existing: Puzzle[] = JSON.parse(localStorage.getItem(PZ_KEY + username.toLowerCase()) || "[]");
    const ids = new Set(existing.map((p) => p.id));
    localStorage.setItem(PZ_KEY + username.toLowerCase(), JSON.stringify([...existing, ...puzzles.filter((p) => !ids.has(p.id))]));
  } catch {}
}

export async function getPuzzles(username: string, motif?: string): Promise<Puzzle[]> {
  if (await isBackendMode()) return (await api.puzzles(username, motif)).puzzles;
  try {
    const all: Puzzle[] = JSON.parse(localStorage.getItem(PZ_KEY + username.toLowerCase()) || "[]");
    return all.filter((p) => !motif || p.motifs.includes(motif)).sort((a, b) => {
      const sa = a.attempt ? (a.attempt.solved ? 2 : 1) : 0;
      const sb = b.attempt ? (b.attempt.solved ? 2 : 1) : 0;
      return sa - sb || b.win_loss - a.win_loss;
    });
  } catch {
    return [];
  }
}

export async function recordAttempt(username: string, puzzle: Puzzle, solved: boolean) {
  if (await isBackendMode()) return api.attempt(puzzle.id, username, solved);
  try {
    const key = PZ_KEY + username.toLowerCase();
    const all: Puzzle[] = JSON.parse(localStorage.getItem(key) || "[]");
    const p = all.find((x) => x.id === puzzle.id);
    if (p) {
      const prev = p.attempt ?? { attempts: 0, streak: 0, solved: false, last_at: 0 };
      p.attempt = { attempts: prev.attempts + 1, streak: solved ? prev.streak + 1 : 0, solved, last_at: Date.now() / 1000 };
      localStorage.setItem(key, JSON.stringify(all));
    }
  } catch {}
}

/* ---------- Background analysis of the last N days ---------- */

export interface BackfillState {
  status: "queued" | "running" | "done" | "error" | "cancelled";
  stage: string;
  progress: number;
  result: BackfillResult | null;
  error: string | null;
  /** True when it runs in this browser tab (no backend): it stops if the tab is closed. */
  inBrowser: boolean;
}

// Browser-mode runner. Module-level, so it keeps going while you move around the app.
let local: { username: string; state: BackfillState; ctrl: AbortController } | null = null;

export async function startBackfill(username: string, days = 30): Promise<BackfillState> {
  if (await isBackendMode()) return { ...(await api.startBackfill(username, days)), inBrowser: false };
  if (local && local.username === username.toLowerCase() && ["queued", "running"].includes(local.state.status)) return local.state;
  const ctrl = new AbortController();
  const run = { username: username.toLowerCase(), ctrl, state: { status: "running", stage: "Fetching your games from chess.com", progress: 0, result: null, error: null, inBrowser: true } as BackfillState };
  local = run;
  const set = (patch: Partial<BackfillState>) => (run.state = { ...run.state, ...patch });
  (async () => {
    try {
      const now = Date.now();
      const games = (await fetchGamesBetween(username, now - days * 86400_000, now + 60_000)).reverse(); // newest first
      const todo = games.filter((g) => !loadLocalReview(g.id));
      for (let i = 0; i < todo.length; i++) {
        await browserReview(todo[i], (_, f) => set({ stage: `Analysing game ${i + 1} of ${todo.length}`, progress: (i + f) / todo.length }), ctrl.signal);
      }
      set({ status: "done", stage: "Done", progress: 1, result: { games: games.length, analysed: todo.length, already_reviewed: games.length - todo.length } });
    } catch (e) {
      if (ctrl.signal.aborted) set({ status: "cancelled", stage: "Stopped" });
      else set({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  })();
  return run.state;
}

export async function backfillStatus(username: string): Promise<BackfillState | null> {
  if (await isBackendMode()) {
    const { job } = await api.backfill(username);
    return job ? { ...job, inBrowser: false } : null;
  }
  return local && local.username === username.toLowerCase() ? local.state : null;
}

export async function stopBackfill(username: string): Promise<void> {
  if (await isBackendMode()) {
    await api.stopBackfill(username);
    return;
  }
  if (local && local.username === username.toLowerCase()) local.ctrl.abort();
}
