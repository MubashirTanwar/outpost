"use client";

/**
 * One entry point for the UI. Uses the Python backend (agents, graph DB, native Stockfish)
 * when it's reachable, else falls back to browser-only mode (WASM Stockfish + localStorage).
 */
import { api, getHealth, pollJob } from "./api";
import { fetchDayGames, playerResult, tzOffset } from "./chesscom";
import { reviewPgn } from "./review";
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

async function browserReview(game: GameMeta, progress?: Progress): Promise<Review> {
  const cached = loadLocalReview(game.id);
  if (cached) return cached;
  const engine = getBrowserEngine();
  const review = await reviewPgn(game.pgn!, (fen, depth, multipv) => engine.analyse(fen, { depth, multipv }), {
    depth: BROWSER_DEPTH,
    playerColor: game.player_color,
    onProgress: (d, t) => progress?.(`Analyzing move ${d}/${t}`, d / t),
  });
  review.game = { ...game, pgn: undefined };
  saveLocal(review);
  return review;
}

export async function isBackendMode(): Promise<boolean> {
  return (await getHealth()) !== null;
}

export async function getReview(username: string, gameId: string, progress?: Progress, day?: string): Promise<Review> {
  if (await isBackendMode()) {
    try {
      return await api.getReview(gameId);
    } catch {
      const res = await api.reviewGame({ username, game_id: gameId, day, tz_offset: tzOffset() });
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
  return browserReview(game, progress);
}

export async function reviewDay(username: string, day: string, progress: Progress): Promise<DayOverview> {
  if (await isBackendMode()) {
    const { job_id } = await api.reviewDay({ username, day, tz_offset: tzOffset() });
    return pollJob<DayOverview>(job_id, (j) => progress(j.stage, j.progress));
  }
  progress("Fetching games from chess.com", 0.02);
  const games = await fetchDayGames(username, day);
  const reviews: Review[] = [];
  for (let i = 0; i < games.length; i++) {
    reviews.push(
      await browserReview(games[i], (stage, f) => progress(`Game ${i + 1}/${games.length}: ${stage}`, 0.05 + (0.9 * (i + f)) / games.length)),
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
            solution: motifs.some((x) => x === "missed_mate" || x === "missed_tactic") && m.best_pv.length >= 3 ? m.best_pv.slice(0, 3) : m.best_pv.slice(0, 1),
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
        ...worst.slice(0, 3).map((w) => `- vs ${w.opponent}, move ${w.move_number}: you played **${w.san}**, best was **${w.best_san}** (−${w.win_loss.toFixed(0)}% winning chances).`),
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
