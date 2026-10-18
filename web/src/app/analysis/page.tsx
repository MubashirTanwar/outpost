"use client";

import { Chess, type Square } from "chess.js";
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Copy, FilePlus2, PencilRuler, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Board, type Arrow } from "@/components/Board";
import { BoardEditor } from "@/components/BoardEditor";
import { CapturedPieces } from "@/components/CapturedPieces";
import { EngineLines } from "@/components/EngineLines";
import { EvalBar } from "@/components/EvalBar";
import { fenAt, goTo, lastMove, lineFromText, moveRows, newLine, play, playUci, toPgn, type Line } from "@/lib/analysisLine";
import { material } from "@/lib/material";
import { playSound, soundForMove } from "@/lib/sounds";
import type { EngineLine } from "@/lib/types";

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
  const turn = fen.split(" ")[1] === "w" ? 1 : -1;
  const status = useMemo(() => {
    const c = new Chess(fen);
    if (c.isCheckmate()) return `Checkmate: ${c.turn() === "w" ? "Black" : "White"} wins.`;
    if (c.isStalemate()) return "Stalemate: it's a draw.";
    if (c.isInsufficientMaterial()) return "Draw: neither side can checkmate.";
    return null;
  }, [fen]);

  const update = useCallback((next: Line | null) => {
    if (!next) return false;
    const before = fenAt(next, next.cursor - 1);
    const mv = next.moves[next.cursor - 1];
    if (mv) {
      playSound(soundForMove(new Chess(before).move(mv.san)));
    }
    setLine(next);
    return true;
  }, []);

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
      setLine((l) => goTo(l, to));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, line.cursor, line.moves.length]);

  const load = () => {
    try {
      setLine(lineFromText(input));
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

  const arrows = useMemo<Arrow[]>(() => (top?.pv[0] ? [[top.pv[0].slice(0, 2) as Square, top.pv[0].slice(2, 4) as Square, BEST_ARROW]] : []), [top]);

  if (mode === "setup") {
    return (
      <BoardEditor
        initialFen={fen}
        onCancel={() => setMode("analyse")}
        onDone={(f) => {
          setLine(newLine(f));
          setMode("analyse");
        }}
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-[1250px] flex-col gap-5 p-3 lg:flex-row lg:p-5">
      <div className="mx-auto flex w-full max-w-[min(80vh,680px)] gap-2 lg:flex-1">
        <EvalBar cp={top ? turn * top.cp : 0} mate={top?.mate != null ? turn * top.mate : null} orientation={orientation} />
        <div className="min-w-0 flex-1">
          <SideBar c={orientation === "white" ? "black" : "white"} fen={fen} />
          <Board fen={fen} orientation={orientation} onMove={onMove} lastMove={lastMove(line)} arrows={arrows} id="analysis" />
          <SideBar c={orientation} fen={fen} />
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
                onLines={(l, f) => setEngine({ fen: f, lines: l })}
                // Clicking a line plays its first move.
                onSelect={(i) => lines[i]?.pv[0] && update(playUci(line, lines[i].pv[0]))}
              />
            )}
          </div>
          <MoveList line={line} onPick={(c) => setLine((l) => goTo(l, c))} />
          <div className="grid grid-cols-5 gap-1.5 border-t border-line p-3">
            <NavButton label="Start" onClick={() => setLine((l) => goTo(l, 0))} disabled={line.cursor === 0}>
              <ChevronFirst size={20} />
            </NavButton>
            <NavButton label="Back" onClick={() => setLine((l) => goTo(l, l.cursor - 1))} disabled={line.cursor === 0}>
              <ChevronLeft size={20} />
            </NavButton>
            <NavButton label="Forward" onClick={() => setLine((l) => goTo(l, l.cursor + 1))} disabled={line.cursor === line.moves.length}>
              <ChevronRight size={20} />
            </NavButton>
            <NavButton label="End" onClick={() => setLine((l) => goTo(l, l.moves.length))} disabled={line.cursor === line.moves.length}>
              <ChevronLast size={20} />
            </NavButton>
            <NavButton label="Flip board" onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))}>
              <RefreshCcw size={18} />
            </NavButton>
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
            <button className="btn-secondary" onClick={() => setLine(newLine())} title="Back to the starting position, clearing the moves">
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

function NavButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button className="btn-secondary justify-center px-0 py-2" onClick={onClick} disabled={disabled} aria-label={label} title={label}>
      {children}
    </button>
  );
}

/** Two-column move list; click a move to jump there. Keeps the current move in view. */
function MoveList({ line, onPick }: { line: Line; onPick: (cursor: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector("[data-current]")?.scrollIntoView({ block: "nearest" });
  }, [line.cursor]);
  const rows = moveRows(line);
  const cell = (i: number | null) =>
    i === null ? (
      <span />
    ) : (
      <button
        onClick={() => onPick(i + 1)}
        data-current={line.cursor === i + 1 ? "" : undefined}
        className={`truncate rounded px-2 py-1 text-left font-semibold ${line.cursor === i + 1 ? "bg-[#4b4847] text-white" : "text-soft hover:bg-[#363431] hover:text-white"}`}
      >
        {line.moves[i].san}
      </button>
    );
  return (
    <div ref={box} className="max-h-56 min-h-[88px] overflow-y-auto border-t border-line px-3 py-2 text-sm">
      {rows.length === 0 ? (
        <p className="py-2 text-muted">Make a move on the board, or click an engine line to play it.</p>
      ) : (
        rows.map((r) => (
          <div key={r.number} className="grid grid-cols-[2.5rem_1fr_1fr] items-center gap-1">
            <span className="text-muted tabular-nums">{r.number}.</span>
            {r.white === null ? <span className="px-2 text-muted">…</span> : cell(r.white)}
            {cell(r.black)}
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
