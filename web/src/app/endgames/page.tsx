"use client";

import { Chess, type Square } from "chess.js";
import { Lightbulb, Loader2, RotateCcw } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Board, type Arrow } from "@/components/Board";
import { kittuSays } from "@/components/Kittu";
import { KittuBubble } from "@/components/KittuBubble";
import endgameData from "@/data/endgames.json";
import { playSound, soundForMove } from "@/lib/sounds";
import { getBrowserEngine } from "@/lib/stockfish";
import type { Endgame } from "@/lib/types";

const DRILLS = endgameData as Endgame[];
// A draw drill counts as held after this many of your moves without the engine making progress.
const HOLD_MOVES = 25;

type Outcome = { ok: boolean; text: string } | null;

function EndgameTrainer() {
  const search = useSearchParams();
  const [drillId, setDrillId] = useState(search.get("drill") ?? DRILLS[0].id);
  const drill = DRILLS.find((d) => d.id === drillId) ?? DRILLS[0];
  const [fen, setFen] = useState(drill.fen);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [thinking, setThinking] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [userMoves, setUserMoves] = useState(0);
  const [hint, setHint] = useState<Arrow[]>([]);
  const [showHint, setShowHint] = useState(false);
  const game = useRef(new Chess(drill.fen));

  const reset = useCallback(() => {
    game.current = new Chess(drill.fen);
    setFen(drill.fen);
    setLastMove(null);
    setOutcome(null);
    setUserMoves(0);
    setHint([]);
    setShowHint(false);
  }, [drill]);

  useEffect(reset, [reset]);

  const judge = useCallback(
    (moves: number, engineCp?: number): Outcome => {
      const g = game.current;
      const userColor = drill.side === "white" ? "w" : "b";
      if (g.isCheckmate()) {
        return g.turn() === userColor ? { ok: false, text: "Checkmated. Reset and try again." } : drill.goal === "win" ? { ok: true, text: "Checkmate! Drill complete." } : { ok: true, text: "You even won it!" };
      }
      if (g.isDraw() || g.isStalemate()) {
        return drill.goal === "draw" ? { ok: true, text: "Draw secured. Well defended!" } : { ok: false, text: g.isStalemate() ? "Stalemate! Careful: leave the king a square." : "That's a draw. You needed to win." };
      }
      if (drill.goal === "draw" && moves >= HOLD_MOVES && engineCp !== undefined && engineCp < 150) {
        return { ok: true, text: `Held for ${HOLD_MOVES} moves. That's a draw.` };
      }
      return null;
    },
    [drill],
  );

  const engineReply = useCallback(
    async (moves: number) => {
      setThinking(true);
      const engine = getBrowserEngine();
      engine.setSkill(20);
      const [line] = await engine.analyse(game.current.fen(), { movetime: 700 });
      setThinking(false);
      if (!line?.pv[0]) return;
      const u = line.pv[0];
      const mv = game.current.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      setFen(game.current.fen());
      setLastMove({ from: mv.from, to: mv.to });
      playSound(soundForMove(mv));
      const verdict = judge(moves, line.cp);
      if (verdict) {
        setOutcome(verdict);
        playSound(verdict.ok ? "correct" : "wrong");
      }
    },
    [judge],
  );

  // The engine moves first when it's not the user's side to move.
  useEffect(() => {
    if ((game.current.turn() === "w" ? "white" : "black") !== drill.side && !outcome) void engineReply(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drill]);

  const onMove = (from: Square, to: Square, promotion?: string) => {
    if (thinking || outcome) return false;
    let mv;
    try {
      mv = game.current.move({ from, to, promotion });
    } catch {
      return false;
    }
    setFen(game.current.fen());
    setLastMove({ from, to });
    setHint([]);
    playSound(soundForMove(mv));
    const moves = userMoves + 1;
    setUserMoves(moves);
    const verdict = judge(moves);
    if (verdict) {
      setOutcome(verdict);
      playSound(verdict.ok ? "correct" : "wrong");
      return true;
    }
    void engineReply(moves);
    return true;
  };

  const askHint = async () => {
    if (thinking || outcome) return;
    setThinking(true);
    const [line] = await getBrowserEngine().analyse(game.current.fen(), { depth: 18 });
    setThinking(false);
    if (line?.pv[0]) setHint([[line.pv[0].slice(0, 2) as Square, line.pv[0].slice(2, 4) as Square, "rgba(129,182,76,0.8)"]]);
  };

  return (
    <div className="mx-auto flex max-w-[1250px] flex-col gap-5 p-3 lg:flex-row lg:p-5">
      <div className="mx-auto w-full max-w-[min(85vh,680px)] lg:flex-1">
        <Board fen={fen} orientation={drill.side} onMove={outcome ? undefined : onMove} lastMove={lastMove} arrows={hint} id="endgame" />
      </div>
      <div className="flex w-full flex-col gap-4 lg:w-[380px]">
        <div className="card p-5">
          <div className="text-xs font-bold uppercase text-muted">
            {drill.level} · play {drill.side} · goal: {drill.goal}
          </div>
          <h2 className="mt-1 text-xl font-extrabold">{drill.name}</h2>
          <div className="mt-3">
            <KittuBubble
              mood={outcome ? (outcome.ok ? "party" : "sad") : thinking ? "thinking" : "neutral"}
              quip={outcome ? kittuSays(outcome.ok ? "party" : "sad", userMoves) : undefined}
              tone={outcome ? (outcome.ok ? "good" : "bad") : "white"}
            >
              {outcome ? (
                outcome.text
              ) : thinking ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin" /> Stockfish is thinking…
                </span>
              ) : (
                `Your move. ${drill.goal === "win" ? "Convert it against perfect defence." : "Hold the draw against Stockfish."}`
              )}
            </KittuBubble>
          </div>
          {showHint && <p className="mt-3 text-sm text-soft">{drill.hint}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={reset}>
              <RotateCcw size={16} /> Reset
            </button>
            <button className="btn-secondary" onClick={() => setShowHint(true)}>
              Technique
            </button>
            <button className="btn-secondary" onClick={askHint} disabled={thinking || !!outcome}>
              <Lightbulb size={16} /> Best move
            </button>
          </div>
          <p className="mt-3 text-xs text-muted">Moves played: {userMoves}</p>
        </div>
        <div className="card p-3">
          {DRILLS.map((d) => (
            <button
              key={d.id}
              onClick={() => setDrillId(d.id)}
              className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm ${d.id === drill.id ? "bg-[#4b4847] text-white" : "text-soft hover:bg-[#3a3835]"}`}
            >
              <span className="flex-1 font-semibold">{d.name}</span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${d.goal === "win" ? "bg-brand/25 text-brand-light" : "bg-[#749bbf]/25 text-[#a9c5e0]"}`}>{d.goal}</span>
              <span className="w-20 text-right text-xs text-muted">{d.level}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <EndgameTrainer />
    </Suspense>
  );
}
