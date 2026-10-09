"use client";

import { Chess } from "chess.js";
import { Cpu } from "lucide-react";
import { useEffect, useState } from "react";
import { formatEval } from "@/lib/format";
import { getBrowserEngine } from "@/lib/stockfish";
import type { EngineLine } from "@/lib/types";

const MAX_DEPTH = 24;

function sanLine(fen: string, pv: string[], n = 10): string[] {
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
  return out;
}

function moveNumberPrefix(fen: string): string {
  const [, turn, , , , full] = fen.split(" ");
  return turn === "w" ? `${full}.` : `${full}...`;
}

/**
 * chess.com-style engine panel: the top N lines for the current position with live depth.
 * Runs Stockfish in the browser; `onLines` reports the lines so the board can draw arrows.
 */
export function EngineLines({ fen, onLines, selected, onSelect }: { fen: string; onLines?: (lines: EngineLine[]) => void; selected?: number; onSelect?: (i: number) => void }) {
  const [enabled, setEnabled] = useState(true);
  const [multipv, setMultipv] = useState(3);
  const [lines, setLines] = useState<EngineLine[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("cc-engine-lines");
      if (saved) {
        const { on, n } = JSON.parse(saved);
        setEnabled(!!on);
        setMultipv(n === 5 ? 5 : 3);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("cc-engine-lines", JSON.stringify({ on: enabled, n: multipv }));
    } catch {}
  }, [enabled, multipv]);

  useEffect(() => {
    setLines([]);
    onLines?.([]);
    if (!enabled) return;
    const chess = new Chess(fen);
    if (chess.isGameOver()) return;
    const engine = getBrowserEngine();
    engine.setSkill(20);
    engine.stop();
    let live = true;
    engine
      .analyse(fen, {
        depth: MAX_DEPTH,
        multipv,
        onInfo: (l) => {
          if (!live) return;
          setLines([...l]);
          onLines?.([...l]);
        },
      })
      .then((l) => {
        if (!live) return;
        setLines(l);
        onLines?.(l);
      });
    return () => {
      live = false;
      engine.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, enabled, multipv]);

  const turn = fen.split(" ")[1] === "w" ? 1 : -1;
  const depth = lines.reduce((d, l) => Math.max(d, l.depth ?? 0), 0);

  return (
    <div className="rounded-md bg-panel2">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs font-bold text-muted">
        <Cpu size={14} />
        <span>Stockfish 17.1</span>
        {enabled && <span className="w-14 text-soft tabular-nums">depth {depth || "…"}</span>}
        <div className="ml-auto flex items-center gap-1">
          {[3, 5].map((n) => (
            <button
              key={n}
              onClick={() => setMultipv(n)}
              className={`rounded px-1.5 py-0.5 ${multipv === n ? "bg-[#4b4847] text-white" : "hover:text-white"}`}
              aria-label={`Show ${n} lines`}
            >
              {n}
            </button>
          ))}
          <button
            onClick={() => setEnabled((e) => !e)}
            role="switch"
            aria-checked={enabled}
            aria-label="Engine lines"
            className={`ml-1 h-5 w-9 rounded-full p-0.5 transition ${enabled ? "bg-brand" : "bg-[#4b4847]"}`}
          >
            <span className={`block h-4 w-4 rounded-full bg-white transition ${enabled ? "translate-x-4" : ""}`} />
          </button>
        </div>
      </div>
      {enabled && (
        <div className="divide-y divide-line/60">
          {/* Always exactly `multipv` one-line rows, so updates never change the panel's height. */}
          {Array.from({ length: multipv }, (_, i) => lines[i] ?? null).map((l, i) => {
            if (!l)
              return (
                <div key={i} className="h-8 animate-pulse px-3 py-2.5">
                  <div className="h-3 w-3/4 rounded bg-[#3c3a37]" />
                </div>
              );
            const cp = turn * l.cp;
            const mate = l.mate !== null ? turn * l.mate : null;
            const white = mate !== null ? mate > 0 : cp >= 0;
            const sans = sanLine(fen, l.pv);
            return (
              <button
                key={i}
                onClick={() => onSelect?.(i)}
                className={`flex h-8 w-full items-center gap-2 overflow-hidden whitespace-nowrap px-3 text-left text-[13px] hover:bg-[#2d2b28] ${selected === i ? "bg-[#2d2b28]" : ""}`}
              >
                <span className={`w-12 shrink-0 rounded px-1 text-center text-xs font-extrabold tabular-nums ${white ? "bg-white text-[#312e2b]" : "bg-[#403d39] text-white"}`}>
                  {formatEval(cp, mate)}
                </span>
                <span className="min-w-0 flex-1 truncate text-soft">
                  <span className="text-muted">{moveNumberPrefix(fen)} </span>
                  <span className="font-bold text-white">{sans[0]}</span> {sans.slice(1).join(" ")}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
