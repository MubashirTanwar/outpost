/**
 * Browser port of backend/app/review.py, used when no backend is reachable (e.g. a plain
 * Vercel deploy). Same thresholds and formulas, slightly smaller motif set.
 */
import { Chess } from "chess.js";
import { CLASSIFICATIONS, type Classification, type Color, type EngineLine, type MoveReview, type Review } from "./types.ts";
import bookLines from "../data/openings.json";
import {
  ERRORS,
  classify,
  gameAccuracy,
  gamePhase,
  isSacrifice,
  materialDiff,
  moveAccuracy,
  playUci,
  sideOf,
  winPercent,
  VALUES,
} from "./classify.ts";

let book: Set<string> | null = null;
function openingBook(): Set<string> {
  if (!book) {
    book = new Set();
    for (const line of bookLines as { moves: string }[]) {
      const moves = line.moves.split(" ");
      for (let i = 1; i <= moves.length; i++) book.add(moves.slice(0, i).join(" "));
    }
  }
  return book;
}

function sanLine(fen: string, pv: string[], plies = 6): string[] {
  const chess = new Chess(fen);
  const out: string[] = [];
  for (const u of pv.slice(0, plies)) {
    const m = playUci(chess, u);
    if (!m) break;
    out.push(m.san);
  }
  return out;
}

function motifsFor(fen: string, uci: string, best: EngineLine, afterBest: EngineLine, phase: string, clock: number | null) {
  const motifs = [`${phase}_phase`];
  if (best.mate !== null && best.mate > 0 && !(afterBest.mate !== null && afterBest.mate < 0)) motifs.push("missed_mate");
  const chess = new Chess(fen);
  const mover = chess.turn();
  const base = materialDiff(chess, mover);
  playUci(chess, uci);
  if (afterBest.mate !== null && afterBest.mate > 0) {
    motifs.push("allowed_mate");
    const k = chess.findPiece({ type: "k", color: mover })[0];
    if (k && k[1] === (mover === "w" ? "1" : "8")) motifs.push("back_rank");
  }
  const reply = afterBest.pv[0] ? playUci(chess, afterBest.pv[0]) : null;
  if (reply?.captured && materialDiff(chess, mover) <= base - 2) motifs.push("hanging_piece");
  if (reply) {
    // Fork: the replying piece now attacks two or more of our valuable pieces.
    let targets = 0;
    for (const row of chess.board())
      for (const p of row)
        if (p && p.color === mover && (p.type === "k" || VALUES[p.type] >= 3) && chess.attackers(p.square, mover === "w" ? "b" : "w").includes(reply.to))
          targets++;
    if (targets >= 2) motifs.push("fork");
  }
  const bestChess = new Chess(fen);
  for (const u of best.pv.slice(0, 3)) if (!playUci(bestChess, u)) break;
  if (materialDiff(bestChess, mover) >= base + 2 && !motifs.includes("missed_mate")) motifs.push("missed_tactic");
  if (clock !== null && clock < 30) motifs.push("time_pressure");
  return motifs;
}

function parseClock(comment: string | undefined): number | null {
  const m = comment?.match(/\[%clk (\d+):(\d+):(\d+(?:\.\d+)?)\]/);
  return m ? +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]) : null;
}

export type Analyser = (fen: string, depth: number, multipv: number, signal?: AbortSignal) => Promise<EngineLine[]>;

export async function reviewPgn(
  pgn: string,
  analyse: Analyser,
  opts: { depth?: number; playerColor?: Color | null; onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<Review> {
  const depth = opts.depth ?? 12;
  const game = new Chess();
  game.loadPgn(pgn);
  const history = game.history({ verbose: true });
  const comments = new Map(game.getComments().map((c) => [c.fen, c.comment]));
  const fens = [history.length ? history[0].before : game.fen(), ...history.map((m) => m.after)];

  const analyses: EngineLine[][] = [];
  for (let i = 0; i < fens.length; i++) {
    // Cancelled (e.g. the page was left): stop, so a half-analysed game is never returned or cached.
    if (opts.signal?.aborted) throw new DOMException("Review cancelled", "AbortError");
    const c = new Chess(fens[i]);
    if (c.isCheckmate()) analyses.push([{ cp: -100000, mate: 0, pv: [] }]);
    else if (c.isGameOver()) analyses.push([{ cp: 0, mate: null, pv: [] }]);
    else analyses.push(await analyse(fens[i], depth, 2, opts.signal));
    opts.onProgress?.(i + 1, fens.length);
  }
  if (opts.signal?.aborted) throw new DOMException("Review cancelled", "AbortError");

  const bookSet = openingBook();
  const sans: string[] = [];
  let inBook = true;
  let prev: Classification | null = null;
  const moves: MoveReview[] = [];

  history.forEach((mv, i) => {
    const uci = mv.from + mv.to + (mv.promotion ?? "");
    sans.push(mv.san);
    const [best, second] = analyses[i];
    const afterBest = analyses[i + 1][0];
    const playedBest = best.pv[0] === uci;
    let winBefore = winPercent(best.cp);
    let winAfter = winPercent(-afterBest.cp);
    if (playedBest) winAfter = Math.max(winAfter, winBefore);
    winBefore = Math.max(winBefore, winAfter);
    const loss = winBefore - winAfter;

    const boardBefore = new Chess(mv.before);
    const isBookMove = bookSet.has(sans.join(" ")) && loss < 5;
    inBook = inBook && (isBookMove || (i < 12 && loss < 3));
    const phase = gamePhase(boardBefore, i);
    const prevMove = i > 0 ? history[i - 1] : null;
    const isRecapture = !!(prevMove?.captured && mv.captured && prevMove.to === mv.to);
    const clock = parseClock(comments.get(mv.after));

    const cls = classify({
      winBefore,
      winAfter,
      playedBest,
      secondBestWin: second ? winPercent(second.cp) : null,
      sacrifice: loss < 2 && !inBook && isSacrifice(mv.before, uci, afterBest.pv),
      isBook: inBook,
      onlyMove: boardBefore.moves().length === 1,
      isRecapture,
      givesMate: mv.san.includes("#"),
      prevOpponentClass: prev,
    });
    const sign = new Chess(mv.after).turn() === "w" ? 1 : -1;
    moves.push({
      ply: i + 1,
      move_number: Math.floor(i / 2) + 1,
      color: sideOf(mv.color),
      san: mv.san,
      uci,
      fen_before: mv.before,
      fen_after: mv.after,
      classification: cls,
      eval_cp: sign * afterBest.cp,
      eval_mate: afterBest.mate === null ? null : sign * afterBest.mate,
      win_before: Math.round(winBefore * 10) / 10,
      win_after: Math.round(winAfter * 10) / 10,
      win_loss: Math.round(loss * 10) / 10,
      accuracy: Math.round(moveAccuracy(loss) * 10) / 10,
      best_uci: best.pv[0] ?? null,
      best_san: best.pv[0] ? sanLine(mv.before, best.pv, 1)[0] ?? null : null,
      best_line: sanLine(mv.before, best.pv),
      best_pv: best.pv.slice(0, 6),
      phase,
      motifs: ERRORS.has(cls) ? motifsFor(mv.before, uci, best, afterBest, phase, clock) : [],
      clock,
    });
    prev = cls;
  });

  const summary = {} as Review["summary"];
  for (const color of ["white", "black"] as Color[]) {
    const mine = moves.filter((m) => m.color === color);
    const counts = Object.fromEntries(CLASSIFICATIONS.map((c) => [c, 0])) as Record<Classification, number>;
    mine.forEach((m) => counts[m.classification]++);
    const phaseAcc: Record<string, number | null> = {};
    for (const ph of ["opening", "middlegame", "endgame"]) phaseAcc[ph] = gameAccuracy(mine.filter((m) => m.phase === ph).map((m) => m.accuracy));
    summary[color] = {
      accuracy: gameAccuracy(mine.filter((m) => m.classification !== "book" && m.classification !== "forced").map((m) => m.accuracy)),
      counts,
      phase_accuracy: phaseAcc,
    };
  }
  const focus = opts.playerColor ?? "white";
  const key = moves
    .filter((m) => m.color === focus && (ERRORS.has(m.classification) || m.classification === "brilliant" || m.classification === "great"))
    .sort((a, b) => (ERRORS.has(b.classification) ? b.win_loss : 100) - (ERRORS.has(a.classification) ? a.win_loss : 100))
    .slice(0, 6)
    .map((m) => m.ply)
    .sort((a, b) => a - b);

  const headers = game.getHeaders();
  const startSign = fens[0].split(" ")[1] === "w" ? 1 : -1;
  return {
    headers,
    player_color: opts.playerColor ?? null,
    result: headers.Result ?? "*",
    eco: headers.ECO ?? null,
    // Engine scores are from the side to move: a set-up position may start with Black to move.
    start_eval: { cp: startSign * (analyses[0][0]?.cp ?? 0), mate: analyses[0][0]?.mate == null ? null : startSign * analyses[0][0].mate },
    summary,
    moves,
    key_moments: key,
    depth,
  };
}
