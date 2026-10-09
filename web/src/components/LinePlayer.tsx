"use client";

import { Chess, type Square } from "chess.js";
import { Lightbulb } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Board, type Arrow } from "@/components/Board";
import { START_FEN, isLearnerMove, positionBefore, type Course, type CourseLine } from "@/lib/courses";
import { playSound, soundForMove } from "@/lib/sounds";

export type PlayerMode = "learn" | "review";
type Pass = "learn" | "practice";

export interface LineResult {
  mistakes: number;
}

interface Props {
  course: Course;
  line: CourseLine;
  mode: PlayerMode;
  /** Learner positions already known from other lines (auto-played in the learn pass). */
  known?: Set<string>;
  onComplete: (result: LineResult) => void;
}

const OPPONENT_DELAY = 550;
const KNOWN_DELAY = 280;

/**
 * Plays one course line on the board.
 * learn mode  = a guided pass (arrow + explanation for every move), then a practice pass from memory.
 * review mode = one pass from memory; a wrong move costs a mistake and shows the right one.
 */
export function LinePlayer({ course, line, mode, known, onComplete }: Props) {
  const [pass, setPass] = useState<Pass>(mode === "learn" ? "learn" : "practice");
  const [ply, setPly] = useState(0);
  const [fen, setFen] = useState(START_FEN);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const [wrongHere, setWrongHere] = useState(0);
  const [feedback, setFeedback] = useState<{ kind: "note" | "right" | "wrong" | "known"; text: string } | null>(null);
  const [shake, setShake] = useState(0);
  const [banner, setBanner] = useState<string | null>(mode === "learn" ? "Watch and learn: play each move the arrow shows." : null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const done = useRef(false);

  const orientation = course.color;
  const learnerTotal = useMemo(() => line.moves.filter((_, i) => isLearnerMove(course, i)).length, [course, line]);
  const learnerDone = line.moves.slice(0, ply).filter((_, i) => isLearnerMove(course, i)).length;
  const expected = line.moves[ply];
  const learnerTurn = ply < line.moves.length && isLearnerMove(course, ply);

  const applyMove = useCallback(
    (i: number) => {
      const m = line.moves[i];
      const chess = new Chess(i === 0 ? START_FEN : line.moves[i - 1].fen);
      const mv = chess.move({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci[4] });
      playSound(soundForMove(mv));
      setFen(m.fen);
      setLastMove({ from: mv.from, to: mv.to });
      setPly(i + 1);
      setWrongHere(0);
    },
    [line],
  );

  const restart = useCallback((next: Pass) => {
    clearTimeout(timer.current);
    setPass(next);
    setPly(0);
    setFen(START_FEN);
    setLastMove(null);
    setWrongHere(0);
    setFeedback(null);
  }, []);

  // Drive the line: opponent moves, known moves, and the end of each pass.
  useEffect(() => {
    clearTimeout(timer.current);
    if (ply >= line.moves.length) {
      if (pass === "learn") {
        timer.current = setTimeout(() => {
          setBanner("Now play the whole line from memory.");
          restart("practice");
        }, 900);
      } else if (!done.current) {
        done.current = true;
        playSound("correct");
        timer.current = setTimeout(() => onComplete({ mistakes }), 600);
      }
      return;
    }
    if (!isLearnerMove(course, ply)) {
      timer.current = setTimeout(() => {
        applyMove(ply);
        const note = line.moves[ply].note;
        setFeedback(note ? { kind: "note", text: `${line.moves[ply].san}: ${note}` } : null);
      }, OPPONENT_DELAY);
    } else if (pass === "learn" && known?.has(positionBefore(line, ply))) {
      timer.current = setTimeout(() => {
        applyMove(ply);
        setFeedback({ kind: "known", text: `${line.moves[ply].san}: you already know this from another line.` });
      }, KNOWN_DELAY);
    } else if (pass === "learn") {
      const note = line.moves[ply].note;
      setFeedback({ kind: "note", text: `Play ${line.moves[ply].san}.${note ? ` ${note}` : ""}` });
    }
    return () => clearTimeout(timer.current);
  }, [ply, pass, course, line, known, applyMove, restart, onComplete, mistakes]);

  const onMove = (from: Square, to: Square, promotion?: string) => {
    if (!learnerTurn || !expected) return false;
    const uci = from + to + (promotion ?? "");
    const ok = uci === expected.uci || (expected.uci.length === 4 && uci.slice(0, 4) === expected.uci);
    if (!ok) {
      // Only legal moves count as attempts.
      try {
        new Chess(fen).move({ from, to, promotion });
      } catch {
        return false;
      }
      playSound("wrong");
      setShake((s) => s + 1);
      if (pass === "practice" && wrongHere === 0) setMistakes((m) => m + 1);
      setWrongHere((w) => w + 1);
      setFeedback({ kind: "wrong", text: pass === "learn" ? `Not quite: follow the arrow and play ${expected.san}.` : "Not the repertoire move. Try again." });
      return false;
    }
    applyMove(ply);
    setBanner(null);
    setFeedback({ kind: "right", text: `${expected.san}${expected.note ? `: ${expected.note}` : " ✓"}` });
    return true;
  };

  const arrows: Arrow[] =
    learnerTurn && expected && (pass === "learn" || wrongHere > 0)
      ? [[expected.uci.slice(0, 2) as Square, expected.uci.slice(2, 4) as Square, pass === "learn" ? "rgba(129,182,76,0.85)" : "rgba(247,198,49,0.85)"]]
      : [];

  const percent = Math.round(((pass === "practice" ? learnerTotal : 0) + learnerDone) / (mode === "learn" ? 2 * learnerTotal : learnerTotal) * 100);

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="mx-auto w-full max-w-[min(78vh,660px)] lg:flex-1">
        <div className="mb-3 h-4 overflow-hidden rounded-full bg-[#3c3a37]">
          <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${Math.max(3, percent)}%` }} />
        </div>
        <div key={shake} className={shake ? "animate-shake" : ""}>
          <Board fen={fen} orientation={orientation} onMove={learnerTurn ? onMove : undefined} lastMove={lastMove} arrows={arrows} id="lesson" />
        </div>
      </div>

      <div className="flex w-full flex-col gap-3 lg:w-[360px]">
        <div className="card p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-muted">
            {pass === "learn" ? "Learn" : mode === "learn" ? "Practice from memory" : "Review"} · {learnerDone}/{learnerTotal} moves
          </div>
          <h2 className="mt-1 text-lg font-extrabold">{line.name}</h2>
          {banner && <p className="mt-2 rounded-md bg-brand/15 px-3 py-2 text-sm font-semibold text-brand-light">{banner}</p>}
        </div>

        <div className="flex gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-2xl">♞</div>
          <div
            className={`min-h-[64px] flex-1 rounded-lg p-3 text-[14px] font-semibold shadow ${
              feedback?.kind === "wrong"
                ? "bg-[#fde4e1] text-[#a1271a]"
                : feedback?.kind === "right"
                  ? "bg-[#e6f4d9] text-[#3d6b1f]"
                  : "bg-white text-[#312e2b]"
            }`}
          >
            {feedback?.text ??
              (learnerTurn
                ? pass === "learn"
                  ? "Your move."
                  : "Your move: what's the repertoire move here?"
                : "Watch the opponent's move…")}
          </div>
        </div>

        {pass === "practice" && learnerTurn && wrongHere === 0 && (
          <button
            className="btn-secondary self-start"
            onClick={() => {
              setWrongHere(1);
              setMistakes((m) => m + 1);
            }}
          >
            <Lightbulb size={16} /> Show me (counts as a mistake)
          </button>
        )}
        {pass === "practice" && <div className="text-sm text-muted">Mistakes: {mistakes}</div>}
      </div>
    </div>
  );
}
