"use client";

import { Chess, type Square } from "chess.js";
import { Eye, Lightbulb, Loader2, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Board, type Arrow } from "@/components/Board";
import { kittuSays, type KittuMood } from "@/components/Kittu";
import { KittuBubble } from "@/components/KittuBubble";
import { prettyMotif } from "@/lib/format";
import { playSound, soundForMove } from "@/lib/sounds";
import { getBrowserEngine } from "@/lib/stockfish";
import type { Puzzle } from "@/lib/types";

type Status = "solving" | "checking" | "opponent" | "solved" | "revealed";

const REPLY_DELAY = 550;
// An alternative move is accepted if it's within this many centipawns of the best move.
const ALT_TOLERANCE = 80;

function toMove(uci: string) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined };
}

/** Score for the side that just moved, from an analysis of the position after their move. */
function scoreAfter(line: { cp: number; mate: number | null } | undefined): number {
  if (!line) return 0;
  if (line.mate !== null) return line.mate > 0 ? -100000 : 100000;
  return -line.cp;
}

/**
 * Solve a puzzle made from one of your own mistakes. You find the moves, the opponent answers,
 * and any move that's as good as the engine's is accepted.
 */
export function PuzzlePlayer({ puzzle, onFinish }: { puzzle: Puzzle; onFinish: (solved: boolean) => void }) {
  const game = useRef(new Chess(puzzle.fen));
  const [fen, setFen] = useState(puzzle.fen);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [step, setStep] = useState(0); // index into puzzle.solution of the next move to play
  const [status, setStatus] = useState<Status>("solving");
  const [wrong, setWrong] = useState(0); // wrong tries on the current move
  const [clean, setClean] = useState(true); // no mistakes, hints or reveals
  const [arrow, setArrow] = useState<Arrow[]>([]);
  const [message, setMessage] = useState<{ tone: "good" | "bad" | "white"; text: string } | null>(null);
  const [shake, setShake] = useState(0);
  const reported = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const learner = puzzle.fen.split(" ")[1] === "w" ? "white" : "black";
  // The user plays every other move of the solution; always at least one, then the opponent's answer.
  const userMoves = Math.max(1, Math.ceil(puzzle.solution.length / 2));

  const report = useCallback(
    (solved: boolean) => {
      if (reported.current) return;
      reported.current = true;
      onFinish(solved);
    },
    [onFinish],
  );

  const reset = useCallback(() => {
    clearTimeout(timer.current);
    game.current = new Chess(puzzle.fen);
    setFen(puzzle.fen);
    setLastMove(null);
    setStep(0);
    setStatus("solving");
    setWrong(0);
    setArrow([]);
    setMessage(null);
  }, [puzzle]);

  useEffect(() => {
    reset();
    setClean(true);
    reported.current = false;
    return () => clearTimeout(timer.current);
  }, [puzzle, reset]);

  const play = (uci: string) => {
    const mv = game.current.move(toMove(uci));
    setFen(game.current.fen());
    setLastMove({ from: mv.from, to: mv.to });
    playSound(soundForMove(mv));
    return mv;
  };

  /** After a correct move: the opponent answers (from the solution, or the engine), then it's your turn again or the puzzle is done. */
  const opponentTurn = async (nextStep: number, userDone: number) => {
    if (game.current.isGameOver()) return finishSolved();
    setStatus("opponent");
    let reply = puzzle.solution[nextStep];
    if (!reply) {
      const [line] = await getBrowserEngine().analyse(game.current.fen(), { depth: 12 });
      reply = line?.pv[0];
    }
    timer.current = setTimeout(() => {
      if (reply) play(reply);
      if (userDone >= userMoves || game.current.isGameOver()) finishSolved();
      else {
        setStep(nextStep + 1);
        setStatus("solving");
        setWrong(0);
        setMessage({ tone: "white", text: "Keep going: what's the follow-up?" });
      }
    }, REPLY_DELAY);
  };

  const finishSolved = () => {
    setStatus("solved");
    setArrow([]);
    playSound("correct");
    setMessage({ tone: "good", text: clean ? `Solved! ${puzzle.best_san} was the move.` : "Solved, with some help. It'll come back for review." });
    report(clean);
  };

  const rejectMove = (text: string) => {
    playSound("wrong");
    setShake((s) => s + 1);
    setClean(false);
    const tries = wrong + 1;
    setWrong(tries);
    const expected = puzzle.solution[step];
    if (tries >= 2 && expected) {
      const m = toMove(expected);
      setArrow([[m.from as Square, m.to as Square, "rgba(247,198,49,0.85)"]]);
      setMessage({ tone: "bad", text: `${text} Here's a hint: follow the arrow.` });
    } else setMessage({ tone: "bad", text: `${text} Try again.` });
  };

  const onMove = (from: Square, to: Square, promotion?: string) => {
    if (status !== "solving") return false;
    const before = game.current.fen();
    let mv;
    try {
      mv = game.current.move({ from, to, promotion });
    } catch {
      return false;
    }
    const uci = mv.from + mv.to + (mv.promotion ?? "");
    const expected = puzzle.solution[step];
    const exact = expected && (uci === expected || uci.slice(0, 4) === expected.slice(0, 4));
    const userDone = Math.floor(step / 2) + 1;

    if (exact || game.current.isCheckmate()) {
      setFen(game.current.fen());
      setLastMove({ from, to });
      playSound(soundForMove(mv));
      setArrow([]);
      setMessage({ tone: "good", text: `${mv.san}: ${kittuSays("proud", step)}` });
      void opponentTurn(step + 1, userDone);
      return true;
    }

    // Not the stored move: show it, let the engine judge whether it's just as good, and take it back if not.
    setFen(game.current.fen());
    setLastMove({ from, to });
    playSound(soundForMove(mv));
    setStatus("checking");
    const engine = getBrowserEngine();
    void (async () => {
      const [best] = await engine.analyse(before, { depth: 14 });
      const [after] = await engine.analyse(game.current.fen(), { depth: 12 });
      const bestScore = best ? (best.mate !== null ? (best.mate > 0 ? 100000 : -100000) : best.cp) : 0;
      const mine = scoreAfter(after);
      if (mine >= bestScore - ALT_TOLERANCE) {
        setMessage({ tone: "good", text: `${mv.san} works too!` });
        // The rest of the stored solution no longer applies: let the engine answer from here.
        void opponentTurn(Number.MAX_SAFE_INTEGER, userDone);
        return;
      }
      timer.current = setTimeout(() => {
        game.current = new Chess(before);
        setFen(before);
        setLastMove(null);
        setStatus("solving");
        rejectMove(`${mv.san} isn't it.`);
      }, 450);
    })();
    return true;
  };

  const hint = () => {
    const expected = puzzle.solution[step];
    if (!expected || status !== "solving") return;
    setClean(false);
    const m = toMove(expected);
    setArrow([[m.from as Square, m.to as Square, "rgba(129,182,76,0.85)"]]);
  };

  const reveal = () => {
    clearTimeout(timer.current);
    reset();
    setClean(false);
    setStatus("revealed");
    report(false);
    const chess = new Chess(puzzle.fen);
    game.current = chess;
    puzzle.solution.forEach((uci, i) => {
      timer.current = setTimeout(() => {
        const mv = chess.move(toMove(uci));
        setFen(chess.fen());
        setLastMove({ from: mv.from, to: mv.to });
        playSound(soundForMove(mv));
      }, 400 + i * 800);
    });
    setMessage({ tone: "bad", text: `The solution: ${puzzle.best_san}. In your game you played ${puzzle.played}.` });
  };

  const mood: KittuMood =
    status === "solved" ? (clean ? "starry" : "happy") : status === "revealed" ? "sad" : message?.tone === "bad" ? (wrong > 1 ? "worried" : "unimpressed") : status === "opponent" ? "smug" : "thinking";
  const prompt =
    status === "checking" ? (
      <span className="flex items-center gap-2">
        <Loader2 size={16} className="animate-spin" /> Checking your move…
      </span>
    ) : status === "opponent" ? (
      "Your opponent replies…"
    ) : (
      message?.text ?? `${learner === "white" ? "White" : "Black"} to move. You went wrong here in your game: find the best move.`
    );

  return (
    <div className="flex flex-col gap-5 lg:flex-row">
      <div className="mx-auto w-full max-w-[min(80vh,660px)] lg:flex-1">
        <div key={shake} className={shake ? "animate-shake" : ""}>
          <Board fen={fen} orientation={learner} onMove={status === "solving" ? onMove : undefined} lastMove={lastMove} arrows={arrow} id="puzzle" />
        </div>
      </div>
      <div className="flex w-full flex-col gap-3 lg:w-[380px]">
        <KittuBubble mood={mood} quip={status === "solved" || status === "revealed" ? kittuSays(mood, step) : undefined} tone={message?.tone ?? "white"}>
          {prompt}
        </KittuBubble>
        <div className="flex flex-wrap gap-1.5">
          {puzzle.motifs.map((m) => (
            <span key={m} className="rounded bg-[#3c3a37] px-2 py-0.5 text-xs text-soft">
              {prettyMotif(m)}
            </span>
          ))}
          <span className="rounded bg-[#3c3a37] px-2 py-0.5 text-xs text-soft">{puzzle.phase}</span>
          <span className="rounded bg-[#3c3a37] px-2 py-0.5 text-xs text-soft">
            {userMoves} move{userMoves > 1 ? "s" : ""}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button className="btn-secondary" onClick={hint} disabled={status !== "solving"}>
            <Lightbulb size={16} /> Hint
          </button>
          <button className="btn-secondary" onClick={reveal} disabled={status === "solved" || status === "revealed"}>
            <Eye size={16} /> Solution
          </button>
          <button
            className="btn-secondary"
            onClick={() => {
              reset();
              if (status !== "solved") setClean(false);
            }}
          >
            <RotateCcw size={16} /> Retry
          </button>
        </div>
      </div>
    </div>
  );
}
