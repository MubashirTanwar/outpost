"use client";

import { Chess, type Square } from "chess.js";
import { Lightbulb, Loader2, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Board, type Arrow } from "@/components/Board";
import { kittuSays, type KittuMood } from "@/components/Kittu";
import { KittuBubble } from "@/components/KittuBubble";
import { GOAL_TEXT, HOLD_MOVES, drillStars, judgeDrill, type Drill, type Verdict } from "@/lib/endgames";
import { playSound, soundForMove } from "@/lib/sounds";
import { getBrowserEngine } from "@/lib/stockfish";

const THINK_MS = 650;

/** Play one endgame drill against full-strength Stockfish. */
export function DrillPlayer({ drill, onDone }: { drill: Drill; onDone: (result: { ok: boolean; stars: number }) => void }) {
  const game = useRef(new Chess(drill.fen));
  const [fen, setFen] = useState(drill.fen);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [thinking, setThinking] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [moves, setMoves] = useState(0);
  const [hints, setHints] = useState(0);
  const [restarts, setRestarts] = useState(0);
  const [hintArrow, setHintArrow] = useState<Arrow[]>([]);
  const [showTip, setShowTip] = useState(false);
  const reported = useRef(false);

  const reset = useCallback(() => {
    game.current = new Chess(drill.fen);
    setFen(drill.fen);
    setLastMove(null);
    setVerdict(null);
    setMoves(0);
    setHintArrow([]);
    reported.current = false;
  }, [drill]);

  useEffect(() => {
    reset();
    setHints(0);
    setRestarts(0);
    setShowTip(false);
  }, [drill, reset]);

  const finish = useCallback(
    (v: Verdict) => {
      setVerdict(v);
      playSound(v.ok ? "correct" : "wrong");
      if (v.ok && !reported.current) {
        reported.current = true;
        onDone({ ok: true, stars: drillStars(hints, restarts) });
      }
    },
    [hints, restarts, onDone],
  );

  const engineReply = useCallback(
    async (userMoves: number, userPromoted: boolean) => {
      setThinking(true);
      const engine = getBrowserEngine();
      const [line] = await engine.analyse(game.current.fen(), { movetime: THINK_MS });
      setThinking(false);
      // The engine is to move, so its score is from its side: flip it for the learner.
      const evalForUser = line ? (line.mate !== null ? (line.mate > 0 ? -100000 : 100000) : -line.cp) : null;
      const before = judgeDrill(game.current, drill.goal, drill.side, userMoves, evalForUser, userPromoted);
      if (before.done) return finish(before);
      if (!line?.pv[0]) return;
      const u = line.pv[0];
      const mv = game.current.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      setFen(game.current.fen());
      setLastMove({ from: mv.from, to: mv.to });
      playSound(soundForMove(mv));
      const after = judgeDrill(game.current, drill.goal, drill.side, userMoves, null);
      if (after.done) finish(after);
    },
    [drill, finish],
  );

  const onMove = (from: Square, to: Square, promotion?: string) => {
    if (thinking || verdict?.done) return false;
    let mv;
    try {
      mv = game.current.move({ from, to, promotion });
    } catch {
      return false;
    }
    setFen(game.current.fen());
    setLastMove({ from, to });
    setHintArrow([]);
    playSound(soundForMove(mv));
    const n = moves + 1;
    setMoves(n);
    const quick = judgeDrill(game.current, drill.goal, drill.side, n, null);
    if (quick.done) {
      finish(quick);
      return true;
    }
    void engineReply(n, !!mv.promotion);
    return true;
  };

  const askHint = async () => {
    if (thinking || verdict?.done) return;
    setThinking(true);
    const [line] = await getBrowserEngine().analyse(game.current.fen(), { depth: 20 });
    setThinking(false);
    if (line?.pv[0]) {
      setHints((h) => h + 1);
      setHintArrow([[line.pv[0].slice(0, 2) as Square, line.pv[0].slice(2, 4) as Square, "rgba(129,182,76,0.85)"]]);
    }
  };

  const mood: KittuMood = verdict?.done ? (verdict.ok ? "party" : "sad") : thinking ? "thinking" : moves === 0 ? "smug" : "neutral";
  const status = verdict?.done
    ? verdict.text
    : thinking
      ? "Stockfish is thinking…"
      : `${GOAL_TEXT[drill.goal]}${drill.goal === "draw" ? ` (survive ${HOLD_MOVES} moves)` : ""}. You play ${drill.side}.`;

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="mx-auto w-full max-w-[min(78vh,640px)] lg:flex-1">
        <Board fen={fen} orientation={drill.side} onMove={verdict?.done ? undefined : onMove} lastMove={lastMove} arrows={hintArrow} id="drill" />
      </div>
      <div className="flex w-full flex-col gap-3 lg:w-[360px]">
        <KittuBubble mood={mood} quip={verdict?.done ? kittuSays(mood, moves) : moves === 0 ? "Go on. Show me you know this." : undefined} tone={verdict?.done ? (verdict.ok ? "good" : "bad") : "white"}>
          {thinking && !verdict ? (
            <span className="flex items-center gap-2">
              <Loader2 size={16} className="animate-spin" /> {status}
            </span>
          ) : (
            status
          )}
        </KittuBubble>
        {showTip && <p className="rounded-md bg-panel2 p-3 text-sm text-soft">{drill.hint}</p>}
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-secondary"
            onClick={() => {
              if (moves > 0 && !verdict?.ok) setRestarts((r) => r + 1);
              reset();
            }}
            disabled={thinking} // Stockfish's pending reply belongs to the current position
          >
            <RotateCcw size={16} /> Restart
          </button>
          <button className="btn-secondary" onClick={() => setShowTip(true)} disabled={showTip}>
            Technique tip
          </button>
          <button className="btn-secondary" onClick={askHint} disabled={thinking || !!verdict?.done}>
            <Lightbulb size={16} /> Best move (−1★)
          </button>
        </div>
        <p className="text-xs text-muted">
          Moves: {moves} · hints {hints} · restarts {restarts} · now worth {"★".repeat(drillStars(hints, restarts))}
        </p>
      </div>
    </div>
  );
}
