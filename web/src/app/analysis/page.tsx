"use client";

import { Chess, type Square } from "chess.js";
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Copy, FilePlus2, PencilRuler, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Board, type Arrow } from "@/components/Board";
import { ClassificationIcon } from "@/components/ClassificationIcon";
import { BoardEditor } from "@/components/BoardEditor";
import { CapturedPieces } from "@/components/CapturedPieces";
import { EngineLines } from "@/components/EngineLines";
import { EvalBar } from "@/components/EvalBar";
import { fenAt, goTo, lastMove, lineFromText, moveRows, newLine, play, playUci, toPgn, type Line } from "@/lib/analysisLine";
import { CLASSIFY_DEPTH, classifyLine, positionsToAnalyse, type CachedEval, type MoveVerdict } from "@/lib/liveClassify";
import { material } from "@/lib/material";
import { judgeMove } from "@/lib/review";
import { getBrowserEngine } from "@/lib/stockfish";
import { playSound, soundForMove } from "@/lib/sounds";
import type { Classification, EngineLine } from "@/lib/types";

const BEST_ARROW = "rgba(129,182,76,0.85)";

export default function AnalysisPage() {
  const [line, setLine] = useState<Line>(() => newLine());
  const [mode, setMode] = useState<"analyse" | "setup">("analyse");
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  // Engine lines arrive tagged with their position, so a late update never shows against a new one.
  const [engine, setEngine] = useState<{ fen: string; lines: EngineLine[] }>({ fen: "", lines: [] });
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const fen = fenAt(line);
  const lines = engine.fen === fen ? engine.lines : [];
  const top = lines[0];
  // The bar keeps the last evaluation until the engine has one for the new position, instead of
  // dropping to 0.0 after every move. Stored from White's point of view.
  const [bar, setBar] = useState<{ cp: number; mate: number | null }>({ cp: 0, mate: null });
  const status = useMemo(() => {
    const c = new Chess(fen);
    if (c.isCheckmate()) return `Checkmate: ${c.turn() === "w" ? "Black" : "White"} wins.`;
    if (c.isStalemate()) return "Stalemate: it's a draw.";
    if (c.isInsufficientMaterial()) return "Draw: neither side can checkmate.";
    return null;
  }, [fen]);

  // Engine evaluations per position (from the live lines and quick checks), for the move classifier.
  const evals = useRef(new Map<string, CachedEval>());
  const [evalVersion, setEvalVersion] = useState(0);
  const remember = useCallback((f: string, l: EngineLine[]) => {
    if (!l.length) return;
    const depth = l.reduce((d, x) => Math.max(d, x.depth ?? 0), 0);
    const prev = evals.current.get(f);
    if (prev && (prev.depth > depth || (prev.depth === depth && prev.lines.length >= l.length))) return;
    evals.current.set(f, { depth, lines: l });
    if (depth >= CLASSIFY_DEPTH) setEvalVersion((v) => v + 1);
  }, []);
  const checks = useRef<AbortController | null>(null);

  /**
   * Move to another point in the line. Positions the classifier still needs get a quick search
   * queued first, so the verdict on a move appears within a second instead of after the deep search.
   */
  const go = useCallback(
    (next: Line) => {
      checks.current?.abort();
      const ctrl = new AbortController();
      checks.current = ctrl;
      for (const f of positionsToAnalyse(next, (x) => evals.current.get(x))) {
        void getBrowserEngine()
          .analyse(f, { depth: CLASSIFY_DEPTH, multipv: 2, signal: ctrl.signal })
          .then((l) => !ctrl.signal.aborted && remember(f, l));
      }
      setLine(next);
    },
    [remember],
  );

  const update = useCallback(
    (next: Line | null) => {
      if (!next) return false;
      const before = fenAt(next, next.cursor - 1);
      const mv = next.moves[next.cursor - 1];
      if (mv) {
        playSound(soundForMove(new Chess(before).move(mv.san)));
      }
      go(next);
      return true;
    },
    [go],
  );
  const step = (cursor: number) => go(goTo(line, cursor));

  const verdicts = useMemo(
    () => classifyLine(line, (f) => evals.current.get(f), judgeMove),
    // evalVersion: re-judge as evaluations come in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [line, evalVersion],
  );
  const current = line.cursor > 0 ? line.moves[line.cursor - 1] : null;
  const verdict = line.cursor > 0 ? verdicts[line.cursor - 1] : null;

  const onMove = (from: Square, to: Square, promotion?: string) => update(play(line, { from, to, promotion }));

  // Arrow keys step through the line (unless you're typing).
  useEffect(() => {
    if (mode !== "analyse") return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea")) return;
      const to = { ArrowLeft: line.cursor - 1, ArrowRight: line.cursor + 1, Home: 0, End: line.moves.length }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      go(goTo(line, to));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, line, go]);

  const load = () => {
    try {
      go(lineFromText(input));
      setError(null);
      setInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const copy = async (what: "FEN" | "PGN") => {
    try {
      await navigator.clipboard.writeText(what === "FEN" ? fen : toPgn(line));
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("Couldn't copy: your browser blocked the clipboard.");
    }
  };

  // Game over: the bar shows the result, not the last search.
  const mated = status?.startsWith("Checkmate") ? (fen.split(" ")[1] === "w" ? -1 : 1) : 0;
  const shownBar = mated ? { cp: mated, mate: 0 } : status ? { cp: 0, mate: null } : bar;

  const arrows = useMemo<Arrow[]>(() => (top?.pv[0] ? [[top.pv[0].slice(0, 2) as Square, top.pv[0].slice(2, 4) as Square, BEST_ARROW]] : []), [top]);

  if (mode === "setup") {
    return (
      <BoardEditor
        initialFen={fen}
        onCancel={() => setMode("analyse")}
        onDone={(f) => {
          go(newLine(f));
          setMode("analyse");
        }}
      />
    );
  }

  const nav = (
    <NavRow
      cursor={line.cursor}
      length={line.moves.length}
      onStep={step}
      onFlip={() => setOrientation((o) => (o === "white" ? "black" : "white"))}
    />
  );

  return (
    <div className="mx-auto flex max-w-[1250px] flex-col gap-3 p-2 sm:p-3 lg:flex-row lg:gap-5 lg:p-5">
      <div className="mx-auto w-full max-w-[min(80vh,680px)] lg:flex-1">
        <div className="flex gap-2">
          <EvalBar {...shownBar} orientation={orientation} />
          <div className="min-w-0 flex-1">
            <SideBar c={orientation === "white" ? "black" : "white"} fen={fen} />
            <Board
              fen={fen}
              orientation={orientation}
              onMove={onMove}
              lastMove={lastMove(line)}
              arrows={arrows}
              badge={current && verdict ? { square: current.to, cls: verdict.classification } : null}
              id="analysis"
            />
            <SideBar c={orientation} fen={fen} />
          </div>
        </div>
        <Verdict san={current?.san ?? null} verdict={verdict} />
        {/* On phones the moves and the arrows sit right under the board. */}
        <div className="mt-2 space-y-2 lg:hidden">
          <MoveStrip line={line} verdicts={verdicts} onPick={step} />
          {nav}
        </div>
      </div>

      <div className="flex w-full flex-col gap-4 lg:w-[400px]">
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-4 pt-3">
            <h2 className="text-lg font-extrabold">Analysis</h2>
            <button className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setMode("setup")}>
              <PencilRuler size={16} /> Set up position
            </button>
          </div>
          <div className="p-3">
            {status ? (
              <div className="rounded-md bg-panel2 px-3 py-2.5 text-sm font-bold">{status}</div>
            ) : (
              <EngineLines
                fen={fen}
                onLines={(l, f) => {
                  setEngine({ fen: f, lines: l });
                  remember(f, l);
                  if (l[0]) {
                    const sign = f.split(" ")[1] === "w" ? 1 : -1;
                    setBar({ cp: sign * l[0].cp, mate: l[0].mate !== null ? sign * l[0].mate : null });
                  }
                }}
                // Clicking a line plays its first move.
                onSelect={(i) => lines[i]?.pv[0] && update(playUci(line, lines[i].pv[0]))}
              />
            )}
          </div>
          <div className="hidden lg:block">
            <MoveList line={line} verdicts={verdicts} onPick={step} />
            <div className="border-t border-line p-3">{nav}</div>
          </div>
        </div>

        <div className="card p-4">
          <h3 className="mb-2 font-bold">Load a game or position</h3>
          <textarea
            className="input h-20 w-full font-mono text-xs"
            placeholder="Paste a FEN or a PGN"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError(null);
            }}
          />
          {error && <p className="mt-1 text-xs text-[#ff8a7a]">{error}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={load} disabled={!input.trim()}>
              Load
            </button>
            <button className="btn-secondary" onClick={() => go(newLine())} title="Back to the starting position, clearing the moves">
              <FilePlus2 size={16} /> New
            </button>
            <button className="btn-secondary" onClick={() => copy("FEN")}>
              <Copy size={16} /> {copied === "FEN" ? "Copied" : "FEN"}
            </button>
            <button className="btn-secondary" onClick={() => copy("PGN")} disabled={!line.moves.length}>
              <Copy size={16} /> {copied === "PGN" ? "Copied" : "PGN"}
            </button>
          </div>
          <p className="mt-3 break-all font-mono text-[11px] text-muted">{fen}</p>
        </div>
      </div>
    </div>
  );
}

function NavRow({ cursor, length, onStep, onFlip }: { cursor: number; length: number; onStep: (c: number) => void; onFlip: () => void }) {
  return (
    <div className="grid grid-cols-5 gap-1.5">
      <NavButton label="Start" onClick={() => onStep(0)} disabled={cursor === 0}>
        <ChevronFirst size={20} />
      </NavButton>
      <NavButton label="Back" onClick={() => onStep(cursor - 1)} disabled={cursor === 0}>
        <ChevronLeft size={22} />
      </NavButton>
      <NavButton label="Forward" onClick={() => onStep(cursor + 1)} disabled={cursor === length}>
        <ChevronRight size={22} />
      </NavButton>
      <NavButton label="End" onClick={() => onStep(length)} disabled={cursor === length}>
        <ChevronLast size={20} />
      </NavButton>
      <NavButton label="Flip board" onClick={onFlip}>
        <RefreshCcw size={18} />
      </NavButton>
    </div>
  );
}

function NavButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button className="btn-secondary justify-center px-0 py-2.5" onClick={onClick} disabled={disabled} aria-label={label} title={label}>
      {children}
    </button>
  );
}

const VERDICT_TEXT: Record<Classification, string> = {
  brilliant: "is brilliant",
  great: "is a great move",
  best: "is the best move",
  excellent: "is excellent",
  good: "is good",
  book: "is a book move",
  forced: "is forced: the only move",
  inaccuracy: "is an inaccuracy",
  mistake: "is a mistake",
  miss: "misses a chance",
  blunder: "is a blunder",
};
const NO_BEST_SHOWN = new Set<Classification>(["brilliant", "great", "best", "book", "forced"]);

/** What the classifier thinks of the move that led here. */
function Verdict({ san, verdict }: { san: string | null; verdict: MoveVerdict | null }) {
  return (
    <div className="mt-2 flex h-10 items-center gap-2 overflow-hidden rounded-md bg-panel2 px-3 text-sm" aria-live="polite">
      {!san ? (
        <span className="text-muted">Play a move to see how good it is.</span>
      ) : !verdict ? (
        <span className="text-muted">
          <b className="text-white">{san}</b> · judging…
        </span>
      ) : (
        <>
          <ClassificationIcon cls={verdict.classification} size={20} />
          <span className="min-w-0 truncate">
            <b className="text-white">{san}</b> {VERDICT_TEXT[verdict.classification]}
            {verdict.bestSan && !NO_BEST_SHOWN.has(verdict.classification) && (
              <span className="text-muted">
                {" "}
                · best was <b className="text-brand-light">{verdict.bestSan}</b>
              </span>
            )}
          </span>
        </>
      )}
    </div>
  );
}

/** Keep the current move visible by scrolling only the list itself, never the page. */
function useKeepInView(box: React.RefObject<HTMLDivElement>, cursor: number, axis: "x" | "y") {
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>("[data-current]");
    const b = box.current;
    if (!b) return;
    if (!el) {
      if (axis === "x") b.scrollLeft = cursor === 0 ? 0 : b.scrollWidth;
      return;
    }
    if (axis === "x") {
      const left = el.offsetLeft - b.clientWidth / 2 + el.offsetWidth / 2;
      b.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
    } else if (el.offsetTop < b.scrollTop || el.offsetTop + el.offsetHeight > b.scrollTop + b.clientHeight) {
      b.scrollTo({ top: el.offsetTop - b.clientHeight / 2, behavior: "smooth" });
    }
  }, [box, cursor, axis]);
}

function MoveButton({ line, i, verdict, onPick, compact }: { line: Line; i: number; verdict: MoveVerdict | null; onPick: (c: number) => void; compact?: boolean }) {
  const isCurrent = line.cursor === i + 1;
  return (
    <button
      onClick={() => onPick(i + 1)}
      data-current={isCurrent ? "" : undefined}
      className={`flex min-w-0 shrink-0 items-center gap-1 rounded px-2 py-1 text-left font-semibold ${isCurrent ? "bg-[#4b4847] text-white" : "text-soft hover:bg-[#363431] hover:text-white"}`}
    >
      {verdict && verdict.classification !== "book" && (compact ? !["best", "excellent", "good"].includes(verdict.classification) : true) && (
        <ClassificationIcon cls={verdict.classification} size={14} />
      )}
      <span className="truncate">{line.moves[i].san}</span>
    </button>
  );
}

/** One scrolling row of moves under the board, for phones. */
function MoveStrip({ line, verdicts, onPick }: { line: Line; verdicts: (MoveVerdict | null)[]; onPick: (c: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useKeepInView(box, line.cursor, "x");
  const rows = moveRows(line);
  return (
    <div ref={box} className="relative flex h-10 items-center gap-0.5 overflow-x-auto whitespace-nowrap rounded-md bg-panel2 px-2 text-sm [scrollbar-width:none]">
      {rows.length === 0 ? (
        <span className="text-muted">Your moves will show here.</span>
      ) : (
        rows.map((r) => (
          <span key={r.number} className="flex items-center gap-0.5">
            <span className="pl-1 text-muted tabular-nums">{r.number}.</span>
            {r.white === null ? <span className="px-1 text-muted">…</span> : <MoveButton line={line} i={r.white} verdict={verdicts[r.white]} onPick={onPick} compact />}
            {r.black !== null && <MoveButton line={line} i={r.black} verdict={verdicts[r.black]} onPick={onPick} compact />}
          </span>
        ))
      )}
    </div>
  );
}

/** Two-column move list; click a move to jump there. */
function MoveList({ line, verdicts, onPick }: { line: Line; verdicts: (MoveVerdict | null)[]; onPick: (cursor: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useKeepInView(box, line.cursor, "y");
  const rows = moveRows(line);
  return (
    <div ref={box} className="relative max-h-56 min-h-[88px] overflow-y-auto border-t border-line px-3 py-2 text-sm">
      {rows.length === 0 ? (
        <p className="py-2 text-muted">Make a move on the board, or click an engine line to play it.</p>
      ) : (
        rows.map((r) => (
          <div key={r.number} className="grid grid-cols-[2.5rem_1fr_1fr] items-center gap-1">
            <span className="text-muted tabular-nums">{r.number}.</span>
            {r.white === null ? <span className="px-2 text-muted">…</span> : <MoveButton line={line} i={r.white} verdict={verdicts[r.white]} onPick={onPick} />}
            {r.black === null ? <span /> : <MoveButton line={line} i={r.black} verdict={verdicts[r.black]} onPick={onPick} />}
          </div>
        ))
      )}
    </div>
  );
}

/** Side label with the pieces that side has captured and its material lead. */
function SideBar({ c, fen }: { c: "white" | "black"; fen: string }) {
  const m = material(fen);
  return (
    <div className="flex h-9 items-center gap-2 py-1">
      <span className={`flex h-6 w-6 items-center justify-center rounded text-sm ${c === "white" ? "bg-white text-black" : "bg-[#1a1a1a] text-white"}`}>
        {c === "white" ? "♔" : "♚"}
      </span>
      <span className="text-sm font-bold capitalize">{c}</span>
      <CapturedPieces pieces={m.captured[c]} color={c} lead={c === "white" ? m.diff : -m.diff} />
    </div>
  );
}
