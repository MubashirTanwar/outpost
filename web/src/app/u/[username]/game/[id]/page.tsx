"use client";

import { Chess, type Square } from "chess.js";
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, ExternalLink, Lightbulb, RefreshCcw, RotateCcw, Sparkles } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Board, type Arrow } from "@/components/Board";
import { CLS_COLORS, CLS_LABELS, ClassificationIcon } from "@/components/ClassificationIcon";
import { EvalBar } from "@/components/EvalBar";
import { EvalGraph } from "@/components/EvalGraph";
import { MoveList } from "@/components/MoveList";
import { Progress } from "@/components/Progress";
import { AccuracyBadge, ClassificationTable } from "@/components/ReviewSummary";
import { api } from "@/lib/api";
import { getReview, isBackendMode } from "@/lib/client";
import { formatClock, formatEval, prettyMotif, uciToMove } from "@/lib/format";
import { playSound, soundForMove } from "@/lib/sounds";
import type { MoveReview, Review } from "@/lib/types";

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
      setPly(target);
    },
    [review, ply],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "ArrowRight") goTo(ply + 1);
      else if (e.key === "ArrowLeft") goTo(ply - 1);
      else if (e.key === "ArrowUp") goTo(0);
      else if (e.key === "ArrowDown") goTo(moves.length);
      else if (e.key === "f") setFlipped((f) => !f);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, ply, moves.length]);

  const arrows = useMemo<Arrow[]>(() => {
    if (!current || retry || !showBest || !current.best_uci || current.best_uci === current.uci) return [];
    if (["book", "forced", "best", "brilliant", "great"].includes(current.classification)) return [];
    const b = uciToMove(current.best_uci);
    return [[b.from as Square, b.to as Square, "rgba(129, 182, 76, 0.85)"]];
  }, [current, retry, showBest]);

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

  const fen = retry ? retry.fen : current ? current.fen_after : moves[0]?.fen_before ?? new Chess().fen();
  const evalCp = current ? current.eval_cp : review.start_eval.cp;
  const evalMate = current ? current.eval_mate : review.start_eval.mate;
  const lastMove = retry ? retry.lastMove ?? null : current ? uciToMove(current.uci) : null;
  const explanation = current ? explanations[current.ply] : undefined;
  const isError = current && ["inaccuracy", "mistake", "miss", "blunder"].includes(current.classification);

  const PlayerBar = ({ c }: { c: "white" | "black" }) => (
    <div className="flex items-center gap-2 py-1.5">
      <span className={`flex h-8 w-8 items-center justify-center rounded text-lg ${c === "white" ? "bg-white text-black" : "bg-[#1a1a1a] text-white"}`}>
        {c === "white" ? "♔" : "♚"}
      </span>
      <span className="font-bold">{name(c)}</span>
      <span className="text-sm text-muted">({rating(c) ?? "?"})</span>
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
              badge={current && !retry ? { square: current.uci.slice(2, 4), cls: current.classification } : null}
              onMove={retry?.state === "trying" ? onRetryMove : undefined}
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
          {/* Coach bubble */}
          <div className="flex gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-2xl">♞</div>
            <div className="relative flex-1 rounded-lg bg-white p-3 text-[14px] text-[#312e2b] shadow">
              {retry ? (
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
            {current && isError && !retry && (
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
            {current && backend && !retry && (
              <button className="btn-secondary" onClick={explain} disabled={explanation === "loading"}>
                <Lightbulb size={16} /> {explanation === "loading" ? "Thinking…" : "Explain"}
              </button>
            )}
            <label className="ml-auto flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={showBest} onChange={(e) => setShowBest(e.target.checked)} /> Best-move arrow
            </label>
          </div>

          <EvalGraph moves={moves} current={ply} onSelect={goTo} startCp={review.start_eval.cp} />

          <div className="flex items-end justify-center gap-6">
            <AccuracyBadge label={name("white")} value={review.summary.white.accuracy} light />
            <span className="pb-3 text-xs font-bold text-muted">Accuracy</span>
            <AccuracyBadge label={name("black")} value={review.summary.black.accuracy} />
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
          <NavBtn onClick={() => goTo(ply - 1)} label="Previous move">
            <ChevronLeft />
          </NavBtn>
          <NavBtn onClick={() => goTo(ply + 1)} label="Next move" primary>
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
