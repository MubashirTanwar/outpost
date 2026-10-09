"use client";

import { Chess, type Square } from "chess.js";
import { RefreshCcw, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Board, type Arrow } from "@/components/Board";
import { CapturedPieces } from "@/components/CapturedPieces";
import { EvalBar } from "@/components/EvalBar";
import { material } from "@/lib/material";
import { formatEval } from "@/lib/format";
import { playSound, soundForMove } from "@/lib/sounds";
import { getBrowserEngine } from "@/lib/stockfish";
import type { EngineLine } from "@/lib/types";

const ARROW_COLORS = ["rgba(129,182,76,0.85)", "rgba(116,155,191,0.7)", "rgba(247,198,49,0.6)"];

function sanLine(fen: string, pv: string[], n = 8): string {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const u of pv.slice(0, n)) {
    try {
      const mv = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      out.push(mv.san);
    } catch {
      break;
    }
  }
  return out.join(" ");
}

export default function AnalysisPage() {
  const [history, setHistory] = useState<string[]>([new Chess().fen()]);
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [lines, setLines] = useState<EngineLine[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const fen = history[history.length - 1];
  const turn = fen.split(" ")[1] === "w" ? 1 : -1;

  useEffect(() => {
    const engine = getBrowserEngine();
    engine.setSkill(20);
    engine.stop();
    setLines([]);
    let live = true;
    engine.analyse(fen, { depth: 20, multipv: 3, onInfo: (l) => live && setLines([...l]) }).then((l) => live && setLines(l));
    return () => {
      live = false;
      engine.stop();
    };
  }, [fen]);

  const onMove = (from: Square, to: Square, promotion?: string) => {
    const c = new Chess(fen);
    try {
      const mv = c.move({ from, to, promotion });
      playSound(soundForMove(mv));
      setLastMove({ from, to });
      setHistory((h) => [...h, c.fen()]);
      return true;
    } catch {
      return false;
    }
  };

  const load = () => {
    setError(null);
    const text = input.trim();
    try {
      const c = new Chess();
      if (text.split("/").length === 8) c.load(text);
      else c.loadPgn(text);
      setHistory([c.fen()]);
      setLastMove(null);
    } catch {
      setError("That's neither a valid FEN nor PGN.");
    }
  };

  const arrows = useMemo<Arrow[]>(
    () => lines.slice(0, 3).filter((l) => l.pv[0]).map((l, i) => [l.pv[0].slice(0, 2) as Square, l.pv[0].slice(2, 4) as Square, ARROW_COLORS[i]]),
    [lines],
  );
  const top = lines[0];

  return (
    <div className="mx-auto flex max-w-[1250px] flex-col gap-5 p-3 lg:flex-row lg:p-5">
      <div className="mx-auto flex w-full max-w-[min(85vh,700px)] gap-2 lg:flex-1">
        <EvalBar cp={top ? turn * top.cp : 0} mate={top?.mate != null ? turn * top.mate : null} orientation={orientation} />
        <div className="flex-1">
          <SideBar c={orientation === "white" ? "black" : "white"} fen={fen} />
          <Board fen={fen} orientation={orientation} onMove={onMove} lastMove={lastMove} arrows={arrows} id="analysis" />
          <SideBar c={orientation} fen={fen} />
        </div>
      </div>
      <div className="flex w-full flex-col gap-4 lg:w-[400px]">
        <div className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-extrabold">Analysis</h2>
            <span className="text-xs tabular-nums text-muted">Stockfish 17.1 · depth {top?.depth ?? 0}</span>
          </div>
          {/* Fixed one-line rows so live engine updates don't make the panel jump. */}
          {[0, 1, 2].map((i) => {
            const l = lines[i];
            return (
              <div key={i} className="flex h-9 items-center gap-2 overflow-hidden whitespace-nowrap border-t border-line text-sm">
                <span className="w-12 shrink-0 rounded bg-[#403d39] px-1 text-center font-bold tabular-nums">
                  {l ? formatEval(turn * l.cp, l.mate !== null ? turn * l.mate : null) : "…"}
                </span>
                <span className="min-w-0 flex-1 truncate text-soft">{l ? sanLine(fen, l.pv) : ""}</span>
              </div>
            );
          })}
          <div className="mt-3 flex gap-2">
            <button className="btn-secondary" onClick={() => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h))}>
              <Undo2 size={16} /> Undo
            </button>
            <button className="btn-secondary" onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))}>
              <RefreshCcw size={16} /> Flip
            </button>
            <button className="btn-secondary" onClick={() => setHistory([new Chess().fen()])}>
              Reset
            </button>
          </div>
        </div>
        <div className="card p-4">
          <h3 className="mb-2 font-bold">Load position</h3>
          <textarea className="input h-24 w-full font-mono text-xs" placeholder="Paste a FEN or PGN" value={input} onChange={(e) => setInput(e.target.value)} />
          {error && <p className="mt-1 text-xs text-[#fa412d]">{error}</p>}
          <button className="btn-secondary mt-2" onClick={load}>
            Load
          </button>
          <p className="mt-3 break-all font-mono text-[11px] text-muted">{fen}</p>
        </div>
      </div>
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
