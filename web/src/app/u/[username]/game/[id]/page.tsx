"use client";

import { Chess, type Square } from "chess.js";
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, ExternalLink, Lightbulb, RefreshCcw, RotateCcw, Sparkles } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Board, type Arrow } from "@/components/Board";
import { CapturedPieces } from "@/components/CapturedPieces";
import { CLS_COLORS, CLS_LABELS, ClassificationIcon } from "@/components/ClassificationIcon";
import { EngineLines } from "@/components/EngineLines";
import { EvalBar } from "@/components/EvalBar";
import { Kittu, kittuSays, moodForClassification, type KittuMood } from "@/components/Kittu";
import { EvalGraph } from "@/components/EvalGraph";
import { MoveList } from "@/components/MoveList";
import { Progress } from "@/components/Progress";
import { AccuracyBadge, ClassificationTable } from "@/components/ReviewSummary";
import { api } from "@/lib/api";
import { getReview, isBackendMode } from "@/lib/client";
import { formatClock, formatEval, prettyMotif, uciToMove } from "@/lib/format";
import { material } from "@/lib/material";
import { playSound, soundForMove } from "@/lib/sounds";
import { back, forward, inVariation, jump, lineText, play, type Nav, type Variation } from "@/lib/variation";
import type { EngineLine, MoveReview, Review } from "@/lib/types";

function coachLine(m: MoveReview): string {
  const label = CLS_LABELS[m.classification].toLowerCase();
  switch (m.classification) {
    case "brilliant":
      return `${m.san} is brilliant! A real sacrifice that works.`;
    case "great":
      return `${m.san} is a great move: the only one that holds.`;
    case "best":
      return `${m.san} is the best move.`;
    case "book":
      return `${m.san} is a book move.`;
    case "forced":
      return `${m.san} was the only legal move.`;
    case "excellent":
    case "good":
      return `${m.san} is ${label}. ${m.best_san} was best.`;
    case "miss":
      return `${m.san} misses the chance to punish your opponent. ${m.best_san} was best.`;
    default:
      return `${m.san} is ${label === "inaccuracy" ? "an" : "a"} ${label}. ${m.best_san} was best.`;
  }
}

/** Kittu reacts to your moves; on your opponent's moves he gloats or frets on your behalf. */
function kittuReaction(m: MoveReview | null, retry: "trying" | "right" | "wrong" | null, player: string): { mood: KittuMood; quip: string } {
  if (retry === "trying") return { mood: "thinking", quip: kittuSays("thinking", m?.ply ?? 0) };
  if (retry === "right") return { mood: "proud", quip: kittuSays("proud", m?.ply ?? 0) };
  if (retry === "wrong") return { mood: "unimpressed", quip: kittuSays("unimpressed", m?.ply ?? 0) };
  if (!m) return { mood: "smug", quip: "Let's see how you did. I already know, obviously." };
  if (m.color === player) {
    const mood = moodForClassification(m.classification);
    return { mood, quip: kittuSays(mood, m.ply) };
  }
  if (["blunder", "mistake", "miss"].includes(m.classification))
    return { mood: "smug", quip: ["Heh. They slipped. Did you punish it?", "Your opponent just blundered. Pay attention.", "Hehe. A gift. Don't drop it."][m.ply % 3] };
  if (m.classification === "brilliant" || m.classification === "great")
    return { mood: "worried", quip: "Ugh. Your opponent found a good one." };
  return { mood: "neutral", quip: "" };
}

function ReviewPage({ params }: { params: { username: string; id: string } }) {
  const username = decodeURIComponent(params.username);
  const gameId = decodeURIComponent(params.id);
  const search = useSearchParams();
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ stage: string; value: number } | null>(null);
  const [ply, setPly] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showBest, setShowBest] = useState(true);
  const [explanations, setExplanations] = useState<Record<number, { text: string; source: string } | "loading">>({});
  const [backend, setBackend] = useState(false);
  const [retry, setRetry] = useState<{ fen: string; state: "trying" | "right" | "wrong"; lastMove?: { from: string; to: string } } | null>(null);
  // Free exploration: moves you play on the board branch off the game, like chess.com's analysis.
  // The line stays in memory; back/forward step through it.
  const [variation, setVariation] = useState<Variation | null>(null);
  const nav: Nav = { ply, variation };
  const exploring = inVariation(nav);

  useEffect(() => {
    isBackendMode().then(setBackend);
    setProgress({ stage: "Loading review", value: 0 });
    getReview(username, gameId, (stage, value) => setProgress({ stage, value }), search.get("day") ?? undefined)
      .then((r) => {
        setReview(r);
        const start = parseInt(search.get("ply") ?? "", 10);
        if (!Number.isNaN(start)) setPly(Math.min(start, r.moves.length));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setProgress(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, gameId]);

  const moves = review?.moves ?? [];
  const current = ply > 0 ? moves[ply - 1] : null;
  const playerColor = review?.player_color ?? "white";
  const orientation = (flipped ? (playerColor === "white" ? "black" : "white") : playerColor) as "white" | "black";

  const goTo = useCallback(
    (next: number) => {
      if (!review) return;
      const target = Math.max(0, Math.min(review.moves.length, next));
      if (target === ply + 1) {
        const m = review.moves[target - 1];
        const mv = new Chess(m.fen_before).move(uciToMove(m.uci));
        playSound(soundForMove(mv));
      } else if (target !== ply) {
        playSound("move");
      }
      setRetry(null);
      setVariation((v) => (v ? { ...v, cursor: 0 } : v)); // leave the line, but remember it
      setPly(target);
    },
    [review, ply],
  );

  const stepBack = () => {
    if (!exploring) return goTo(ply - 1);
    playSound("move");
    setVariation(back(nav).variation);
  };
  const stepForward = () => {
    if (!exploring) return goTo(ply + 1);
    const next = forward(nav, moves.length);
    const v = next.variation!;
    if (v.cursor === variation!.cursor) return;
    const step = v.moves[v.cursor - 1];
    const prevFen = v.cursor > 1 ? v.moves[v.cursor - 2].fen : moves[ply - 1]?.fen_after ?? moves[0]?.fen_before ?? new Chess().fen();
    playSound(soundForMove(new Chess(prevFen).move(uciToMove(step.uci))));
    setVariation(v);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "ArrowRight") stepForward();
      else if (e.key === "ArrowLeft") stepBack();
      else if (e.key === "ArrowUp") goTo(0);
      else if (e.key === "ArrowDown") goTo(moves.length);
      else if (e.key === "f") setFlipped((f) => !f);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const [engineLines, setEngineLines] = useState<EngineLine[]>([]);
  const [lineSel, setLineSel] = useState<number | null>(null);
  useEffect(() => {
    setLineSel(null);
  }, [ply]);

  const arrows = useMemo<Arrow[]>(() => {
    // A clicked engine line: show its first two moves.
    const sel = lineSel !== null ? engineLines[lineSel] : null;
    if (sel && !retry) {
      return sel.pv.slice(0, 2).map((u, i) => [u.slice(0, 2) as Square, u.slice(2, 4) as Square, i === 0 ? "rgba(116,155,191,0.9)" : "rgba(116,155,191,0.45)"] as Arrow);
    }
    if (exploring || !current || retry || !showBest || !current.best_uci || current.best_uci === current.uci) return [];
    if (["book", "forced", "best", "brilliant", "great"].includes(current.classification)) return [];
    const b = uciToMove(current.best_uci);
    return [[b.from as Square, b.to as Square, "rgba(129, 182, 76, 0.85)"]];
  }, [current, retry, showBest, lineSel, engineLines, exploring]);

  const explain = async () => {
    if (!current) return;
    setExplanations((x) => ({ ...x, [current.ply]: "loading" }));
    try {
      const res = await api.explain(gameId, current.ply);
      setExplanations((x) => ({ ...x, [current.ply]: res }));
    } catch (e) {
      setExplanations((x) => ({ ...x, [current.ply]: { text: String(e), source: "error" } }));
    }
  };

  const onRetryMove = (from: Square, to: Square, promotion?: string) => {
    if (!retry || !current) return false;
    const chess = new Chess(retry.fen);
    let mv;
    try {
      mv = chess.move({ from, to, promotion });
    } catch {
      return false;
    }
    const uci = from + to + (mv.promotion ?? "");
    const right = uci === current.best_uci || (current.best_uci?.slice(0, 4) === uci.slice(0, 4) && !mv.promotion);
    playSound(right ? "correct" : "wrong");
    setRetry({ fen: chess.fen(), state: right ? "right" : "wrong", lastMove: { from, to } });
    return true;
  };

  if (error)
    return (
      <div className="mx-auto max-w-xl p-8">
        <div className="card p-6 text-[#ff8a7a]">{error}</div>
      </div>
    );
  if (!review)
    return (
      <div className="mx-auto max-w-xl p-8">
        <div className="card p-6">
          <h2 className="mb-4 text-lg font-extrabold">Reviewing game…</h2>
          {progress && <Progress stage={progress.stage} value={progress.value} />}
        </div>
      </div>
    );

  const meta = review.game;
  const h = review.headers;
  const top = orientation === "white" ? "black" : "white";
  const bottom = orientation;
  const name = (c: "white" | "black") => (c === "white" ? meta?.white ?? h.White : meta?.black ?? h.Black);
  const rating = (c: "white" | "black") => (c === "white" ? meta?.white_rating ?? h.WhiteElo : meta?.black_rating ?? h.BlackElo);
  const clockFor = (c: "white" | "black") => {
    for (let i = ply - 1; i >= 0; i--) if (moves[i].color === c) return moves[i].clock;
    return null;
  };

  const gameFen = current ? current.fen_after : moves[0]?.fen_before ?? new Chess().fen();
  const exploreLast = exploring ? variation!.moves[variation!.cursor - 1] : undefined;
  const fen = retry ? retry.fen : exploreLast ? exploreLast.fen : gameFen;
  // While exploring, the eval bar follows the live engine; otherwise the stored review eval.
  const live = exploring && engineLines[0] ? engineLines[0] : null;
  const liveSign = fen.split(" ")[1] === "w" ? 1 : -1;
  const evalCp = live ? liveSign * live.cp : current ? current.eval_cp : review.start_eval.cp;
  const evalMate = live ? (live.mate !== null ? liveSign * live.mate : null) : current ? current.eval_mate : review.start_eval.mate;
  const lastMove = retry ? retry.lastMove ?? null : exploreLast ? uciToMove(exploreLast.uci) : current ? uciToMove(current.uci) : null;

  const onExploreMove = (from: Square, to: Square, promotion?: string) => {
    const chess = new Chess(fen);
    let mv;
    try {
      mv = chess.move({ from, to, promotion });
    } catch {
      return false;
    }
    playSound(soundForMove(mv));
    const step = { uci: mv.from + mv.to + (mv.promotion ?? ""), san: mv.san, fen: chess.fen() };
    // Playing the game's own next move just steps forward in the game.
    const next = play(nav, step, exploring ? undefined : moves[ply]?.uci);
    setPly(next.ply);
    setVariation(next.variation);
    setLineSel(null);
    return true;
  };
  const materialNow = material(fen);
  const explanation = current ? explanations[current.ply] : undefined;
  const isError = current && ["inaccuracy", "mistake", "miss", "blunder"].includes(current.classification);
  const kittu = exploring
    ? { mood: "thinking" as KittuMood, quip: "Ooh, a what-if. Let's see what the engine thinks." }
    : kittuReaction(current, retry?.state ?? null, playerColor);

  const PlayerBar = ({ c }: { c: "white" | "black" }) => (
    <div className="flex items-center gap-2 py-1.5">
      <span className={`flex h-8 w-8 items-center justify-center rounded text-lg ${c === "white" ? "bg-white text-black" : "bg-[#1a1a1a] text-white"}`}>
        {c === "white" ? "♔" : "♚"}
      </span>
      <span className="font-bold">{name(c)}</span>
      <span className="text-sm text-muted">({rating(c) ?? "?"})</span>
      <CapturedPieces pieces={materialNow.captured[c]} color={c} lead={c === "white" ? materialNow.diff : -materialNow.diff} />
      {clockFor(c) !== null && (
        <span className={`ml-auto rounded px-2 py-0.5 font-mono text-sm font-bold ${c === "white" ? "bg-white text-black" : "bg-[#1a1a1a] text-white"}`}>
          {formatClock(clockFor(c))}
        </span>
      )}
    </div>
  );

  return (
    <div className="mx-auto flex max-w-[1250px] flex-col gap-4 p-3 lg:flex-row lg:p-5">
      {/* Board column */}
      <div className="mx-auto w-full max-w-[min(88vh,720px)] lg:mx-0 lg:flex-1">
        <PlayerBar c={top} />
        <div className="flex gap-2">
          <EvalBar cp={evalCp} mate={evalMate} orientation={orientation} />
          <div className="flex-1">
            <Board
              fen={fen}
              orientation={orientation}
              lastMove={lastMove}
              arrows={arrows}
              badge={current && !retry && !exploring ? { square: current.uci.slice(2, 4), cls: current.classification } : null}
              onMove={retry ? (retry.state === "trying" ? onRetryMove : undefined) : onExploreMove}
              id="review"
            />
          </div>
        </div>
        <PlayerBar c={bottom} />
      </div>

      {/* Review panel */}
      <div className="card flex w-full flex-col overflow-hidden lg:h-[calc(100vh-40px)] lg:w-[420px]">
        <div className="flex items-center gap-2 bg-panel2 px-4 py-3">
          <Sparkles size={18} className="text-brand" />
          <h2 className="font-extrabold">Game Review</h2>
          {meta?.url && (
            <a href={meta.url} target="_blank" rel="noreferrer" className="ml-auto text-muted hover:text-white" title="Open on chess.com">
              <ExternalLink size={16} />
            </a>
          )}
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {/* Kittu's bubble */}
          <div className="flex items-start gap-2">
            <div key={kittu.mood} className="animate-pop h-[68px] w-[68px] shrink-0">
              <Kittu mood={kittu.mood} size={68} />
            </div>
            <div className="relative mt-1 flex-1 rounded-xl bg-white p-3 text-[14px] text-[#312e2b] shadow">
              <span className="absolute -left-1.5 top-5 h-3 w-3 rotate-45 bg-white" />
              {kittu.quip && <p className="mb-1 font-extrabold italic">{kittu.quip}</p>}
              {exploring ? (
                <p className="font-semibold">
                  You&apos;re exploring your own line. The engine lines below follow every move. ← and → step through it.
                </p>
              ) : retry ? (
                <p className="font-semibold">
                  {retry.state === "trying" && "Find the best move for this position."}
                  {retry.state === "right" && <span className="text-[#5d9948]">Correct! {current?.best_san} is the best move.</span>}
                  {retry.state === "wrong" && <span className="text-[#ca3431]">Not quite. Try again or see the best move.</span>}
                </p>
              ) : current ? (
                <>
                  <div className="flex items-center gap-2 font-bold" style={{ color: CLS_COLORS[current.classification] }}>
                    <ClassificationIcon cls={current.classification} size={22} />
                    <span>{coachLine(current)}</span>
                    <span className="ml-auto rounded bg-[#312e2b] px-1.5 py-0.5 text-xs text-white">{formatEval(current.eval_cp, current.eval_mate)}</span>
                  </div>
                  {current.best_line.length > 0 && isError && (
                    <p className="mt-1.5 text-xs text-[#555]">Best line: {current.best_line.join(" ")}</p>
                  )}
                  {current.motifs.filter((m) => !m.endsWith("_phase")).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {current.motifs.filter((m) => !m.endsWith("_phase")).map((m) => (
                        <span key={m} className="rounded bg-[#eee] px-1.5 py-0.5 text-[11px] font-semibold">
                          {prettyMotif(m)}
                        </span>
                      ))}
                    </div>
                  )}
                  {explanation && explanation !== "loading" && <p className="mt-2 whitespace-pre-line border-t pt-2 text-[13px]">{explanation.text}</p>}
                </>
              ) : (
                <p className="font-semibold">
                  {name("white")} vs {name("black")} · {review.result}. Step through the game with the arrows, or jump to a key moment.
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {current && isError && !retry && !exploring && (
              <button className="btn-secondary" onClick={() => setRetry({ fen: current.fen_before, state: "trying" })}>
                <RotateCcw size={16} /> Retry
              </button>
            )}
            {retry && (
              <>
                <button className="btn-secondary" onClick={() => setRetry({ fen: current!.fen_before, state: "trying" })}>
                  <RefreshCcw size={16} /> Again
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    const b = uciToMove(current!.best_uci!);
                    const chess = new Chess(current!.fen_before);
                    chess.move(b);
                    setRetry({ fen: chess.fen(), state: "right", lastMove: b });
                  }}
                >
                  Show best
                </button>
                <button className="btn-secondary" onClick={() => setRetry(null)}>
                  Back
                </button>
              </>
            )}
            {current && backend && !retry && !exploring && (
              <button className="btn-secondary" onClick={explain} disabled={explanation === "loading"}>
                <Lightbulb size={16} /> {explanation === "loading" ? "Thinking…" : "Explain"}
              </button>
            )}
            <label className="ml-auto flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={showBest} onChange={(e) => setShowBest(e.target.checked)} /> Best-move arrow
            </label>
          </div>

          {variation && (
            <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${exploring ? "border-[#749bbf]/40 bg-[#749bbf]/10" : "border-line bg-panel2"}`}>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-extrabold uppercase text-[#a9c5e0]">Your variation</div>
                <div className="mt-0.5 flex flex-wrap gap-x-1 font-mono text-[13px]">
                  {lineText(variation).map((m, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setRetry(null);
                        const n = jump(nav, i);
                        setPly(n.ply);
                        setVariation(n.variation);
                      }}
                      className={`rounded px-0.5 ${exploring && variation.cursor === i + 1 ? "bg-[#749bbf] text-white" : i < (exploring ? variation.cursor : 0) ? "text-white hover:bg-white/10" : "text-soft hover:bg-white/10"}`}
                    >
                      {m.label && <span className="text-muted">{m.label}</span>}
                      {m.san}
                    </button>
                  ))}
                </div>
              </div>
              {exploring ? (
                <button className="btn-secondary shrink-0 px-3 py-1.5" onClick={() => goTo(ply)}>
                  Back to game
                </button>
              ) : (
                <button className="btn-secondary shrink-0 px-3 py-1.5" onClick={() => setVariation(null)}>
                  Clear
                </button>
              )}
            </div>
          )}

          <EngineLines fen={fen} onLines={setEngineLines} selected={lineSel ?? undefined} onSelect={(i) => setLineSel(lineSel === i ? null : i)} />

          <EvalGraph moves={moves} current={ply} onSelect={goTo} startCp={review.start_eval.cp} />

          <div className="flex items-end justify-center gap-6">
            <AccuracyBadge label={name("white")} value={review.summary.white.accuracy} light chesscom={meta?.chesscom_white_accuracy} />
            <span className="pb-3 text-xs font-bold text-muted">Accuracy</span>
            <AccuracyBadge label={name("black")} value={review.summary.black.accuracy} chesscom={meta?.chesscom_black_accuracy} />
          </div>

          <ClassificationTable left={review.summary.white.counts} right={review.summary.black.counts} />

          {review.key_moments.length > 0 && (
            <div>
              <h4 className="mb-1.5 text-xs font-bold uppercase text-muted">Key moments</h4>
              <div className="flex flex-wrap gap-1.5">
                {review.key_moments.map((p) => {
                  const m = moves[p - 1];
                  return (
                    <button key={p} onClick={() => goTo(p)} className="flex items-center gap-1 rounded bg-[#3c3a37] px-2 py-1 text-xs font-bold hover:bg-[#4b4847]">
                      <ClassificationIcon cls={m.classification} size={14} /> {m.move_number}
                      {m.color === "white" ? "." : "…"} {m.san}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="rounded-md bg-panel2 py-1">
            <MoveList moves={moves} current={ply} onSelect={goTo} />
          </div>
        </div>

        <div className="grid grid-cols-5 gap-1 bg-panel2 p-2">
          <NavBtn onClick={() => goTo(0)} label="First move">
            <ChevronFirst />
          </NavBtn>
          <NavBtn onClick={stepBack} label="Previous move">
            <ChevronLeft />
          </NavBtn>
          <NavBtn onClick={stepForward} label="Next move" primary>
            <ChevronRight />
          </NavBtn>
          <NavBtn onClick={() => goTo(moves.length)} label="Last move">
            <ChevronLast />
          </NavBtn>
          <NavBtn onClick={() => setFlipped((f) => !f)} label="Flip board">
            <RefreshCcw size={18} />
          </NavBtn>
        </div>
      </div>
    </div>
  );
}

function NavBtn({ onClick, label, children, primary }: { onClick: () => void; label: string; children: React.ReactNode; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-11 items-center justify-center rounded-md ${primary ? "bg-brand shadow-btn hover:bg-brand-light" : "bg-[#3c3a37] shadow-btn2 hover:bg-[#4b4847]"} active:translate-y-[2px] active:shadow-none`}
    >
      {children}
    </button>
  );
}

export default function Page(props: { params: { username: string; id: string } }) {
  return (
    <Suspense>
      <ReviewPage {...props} />
    </Suspense>
  );
}
