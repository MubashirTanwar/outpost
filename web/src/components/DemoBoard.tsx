"use client";

import { Chess } from "chess.js";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Board } from "@/components/Board";
import type { DemoMove } from "@/lib/endgames";
import { playSound, soundForMove } from "@/lib/sounds";

/** A demo position you can step through (or autoplay), with a note on each move. */
export function DemoBoard({ fen, moves, orientation }: { fen: string; moves: DemoMove[]; orientation: "white" | "black" }) {
  const [ply, setPly] = useState(0);
  const [playing, setPlaying] = useState(false);

  const go = (next: number) => {
    const target = Math.max(0, Math.min(moves.length, next));
    if (target === ply + 1) {
      const m = moves[ply];
      const before = ply === 0 ? fen : moves[ply - 1].fen;
      playSound(soundForMove(new Chess(before).move({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci[4] })));
    }
    setPly(target);
  };

  useEffect(() => {
    if (!playing) return;
    if (ply >= moves.length) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => go(ply + 1), 1100);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, ply]);

  const current = ply > 0 ? moves[ply - 1] : null;
  const shown = current ? current.fen : fen;
  const last = current ? { from: current.uci.slice(0, 2), to: current.uci.slice(2, 4) } : null;

  return (
    <div>
      <Board fen={shown} orientation={orientation} lastMove={last} id="demo" />
      <div className="mt-2 flex items-center gap-2">
        <button className="btn-secondary px-2.5" onClick={() => { setPlaying(false); setPly(0); }} aria-label="Restart demo">
          <RotateCcw size={16} />
        </button>
        <button className="btn-secondary px-2.5" onClick={() => { setPlaying(false); go(ply - 1); }} aria-label="Previous move">
          <ChevronLeft size={18} />
        </button>
        <button className="btn-secondary px-3" onClick={() => (ply >= moves.length ? (setPly(0), setPlaying(true)) : setPlaying((p) => !p))} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button className="btn-secondary px-2.5" onClick={() => { setPlaying(false); go(ply + 1); }} aria-label="Next move">
          <ChevronRight size={18} />
        </button>
        <span className="ml-auto font-mono text-sm text-soft">
          {moves.slice(0, ply).map((m) => m.san).join(" ") || "Press play"}
        </span>
      </div>
      {current?.note && <p className="mt-2 rounded-md bg-panel2 px-3 py-2 text-sm font-semibold text-soft">{current.note}</p>}
    </div>
  );
}
