"use client";

import { Chess, type Square } from "chess.js";
import { Lightbulb, Pause, Play, SkipForward, StepForward } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Board, type Arrow } from "@/components/Board";
import { KittuBubble } from "@/components/KittuBubble";
import { kittuSays, type KittuMood } from "@/components/Kittu";
import { NarrationControls } from "@/components/NarrationControls";
import { START_FEN, isLearnerMove, positionBefore, type Course, type CourseLine } from "@/lib/courses";
import { readingTime, squaresIn } from "@/lib/narration";
import { speak, speechIdle, stopSpeaking, useNarration } from "@/lib/narrator";
import { playSound, soundForMove } from "@/lib/sounds";

export type PlayerMode = "learn" | "review";
/** watch = a narrated walkthrough of both sides; learn = guided, you play your moves; practice = from memory. */
type Pass = "watch" | "learn" | "practice";

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
const WATCH_MIN_MS = 900;
const LEARNER_ARROW = "rgba(129,182,76,0.85)";
const OPPONENT_ARROW = "rgba(116,155,191,0.85)";
const MENTIONED = "rgba(116,155,191,0.38)";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Plays one course line on the board.
 * learn mode  = an optional narrated walkthrough, a guided pass (arrow + explanation for every
 *               move), then a practice pass from memory.
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
  const [paused, setPaused] = useState(false);
  const [watchStep, setWatchStep] = useState(0); // bumps to advance a paused walkthrough by one move
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const done = useRef(false);
  const narration = useNarration();
  const narrate = narration.on;

  const orientation = course.color;
  const opponentName = course.color === "white" ? "Black" : "White";
  const learnerTotal = useMemo(() => line.moves.filter((_, i) => isLearnerMove(course, i)).length, [course, line]);
  const learnerDone = line.moves.slice(0, ply).filter((_, i) => isLearnerMove(course, i)).length;
  const expected = line.moves[ply];
  const learnerTurn = pass !== "watch" && ply < line.moves.length && isLearnerMove(course, ply);

  // Never keep talking after the lesson is closed.
  useEffect(() => () => stopSpeaking(), []);

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
    stopSpeaking();
    setPass(next);
    setPly(0);
    setFen(START_FEN);
    setLastMove(null);
    setWrongHere(0);
    setFeedback(null);
    setPaused(false);
  }, []);

  // The walkthrough: show each move with an arrow, explain it (aloud if the narrator is on), play it.
  useEffect(() => {
    if (pass !== "watch") return;
    if (ply >= line.moves.length) {
      timer.current = setTimeout(() => {
        setBanner("Your turn: play the line yourself, with the arrow to guide you.");
        restart("learn");
      }, 1200);
      return () => clearTimeout(timer.current);
    }
    const m = line.moves[ply];
    const mine = isLearnerMove(course, ply);
    setFeedback({ kind: "note", text: `${mine ? "You play" : `${opponentName} plays`} ${m.san}.${m.note ? ` ${m.note}` : ""}` });
    if (paused) return;
    let cancelled = false;
    (async () => {
      const spoken = `${mine ? "You play" : `${opponentName} plays`} ${m.san}.${m.note ? ` ${m.note}` : ""}`;
      const least = wait(WATCH_MIN_MS);
      await (narrate ? speak(spoken, narration) : wait(readingTime(m.note ?? "", narration.rate)));
      await least;
      if (!cancelled) applyMove(ply);
    })();
    return () => {
      cancelled = true;
      stopSpeaking();
    };
    // watchStep: "next move" while paused re-runs this with paused still true but a step requested.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pass, ply, paused, line, course, narrate, applyMove, restart, opponentName]);

  // Drive the guided and practice passes: opponent moves, known moves, and the end of each pass.
  useEffect(() => {
    if (pass === "watch") return;
    clearTimeout(timer.current);
    let cancelled = false;
    if (ply >= line.moves.length) {
      if (pass === "learn") {
        // A final opponent move's explanation would otherwise never be shown.
        const last = line.moves[line.moves.length - 1];
        const lastNote = !isLearnerMove(course, line.moves.length - 1) && last?.note ? `${opponentName} played ${last.san}: ${last.note}` : null;
        if (lastNote) setFeedback({ kind: "note", text: lastNote });
        (async () => {
          if (lastNote && narrate) await speak(lastNote, narration);
          await wait(900);
          if (cancelled) return;
          setBanner("Now play the whole line from memory.");
          restart("practice");
        })();
      } else if (!done.current) {
        done.current = true;
        playSound("correct");
        timer.current = setTimeout(() => onComplete({ mistakes }), 600);
      }
      return () => {
        cancelled = true;
        clearTimeout(timer.current);
      };
    }
    if (!isLearnerMove(course, ply)) {
      (async () => {
        // In the guided pass, let the narrator finish explaining your move first.
        if (pass === "learn" && narrate) await speechIdle();
        await wait(OPPONENT_DELAY);
        if (cancelled) return;
        applyMove(ply);
        const note = line.moves[ply].note;
        setFeedback(note ? { kind: "note", text: `${line.moves[ply].san}: ${note}` } : null);
      })();
    } else if (pass === "learn" && known?.has(positionBefore(line, ply))) {
      timer.current = setTimeout(() => {
        applyMove(ply);
        setFeedback({ kind: "known", text: `${line.moves[ply].san}: you already know this from another line.` });
      }, KNOWN_DELAY);
    } else if (pass === "learn") {
      // The opponent's last move and why, then your move and why.
      const prev = ply > 0 && !isLearnerMove(course, ply - 1) ? line.moves[ply - 1] : null;
      const m = line.moves[ply];
      const before = prev?.note ? `${opponentName} played ${prev.san}: ${prev.note} ` : "";
      const text = `${before}Now play ${m.san}.${m.note ? ` ${m.note}` : ""}`;
      setFeedback({ kind: "note", text });
      if (narrate) void speak(text, narration);
    }
    return () => {
      cancelled = true;
      clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ply, pass, course, line, known, applyMove, restart, onComplete, mistakes, narrate, opponentName]);

  // One step of a paused walkthrough.
  useEffect(() => {
    if (!watchStep || pass !== "watch" || ply >= line.moves.length) return;
    stopSpeaking();
    applyMove(ply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchStep]);

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

  const watching = pass === "watch" && ply < line.moves.length ? line.moves[ply] : null;
  const arrows: Arrow[] = watching
    ? [[watching.uci.slice(0, 2) as Square, watching.uci.slice(2, 4) as Square, isLearnerMove(course, ply) ? LEARNER_ARROW : OPPONENT_ARROW]]
    : learnerTurn && expected && (pass === "learn" || wrongHere > 0)
      ? [[expected.uci.slice(0, 2) as Square, expected.uci.slice(2, 4) as Square, pass === "learn" ? LEARNER_ARROW : "rgba(247,198,49,0.85)"]]
      : [];

  // In the walkthrough and the guided pass, light up the squares the explanation talks about.
  const highlights = useMemo(() => {
    const m = pass === "watch" ? watching : pass === "learn" && learnerTurn ? expected : null;
    if (!m?.note) return {};
    const skip = new Set([m.uci.slice(0, 2), m.uci.slice(2, 4)]);
    return Object.fromEntries(squaresIn(m.note).filter((sq) => !skip.has(sq)).map((sq) => [sq, MENTIONED]));
  }, [pass, watching, learnerTurn, expected]);

  // Kittu: thinking on your turn, proud/happy when you're right, unimpressed then worried when you're not.
  const mood: KittuMood =
    feedback?.kind === "wrong"
      ? wrongHere > 1
        ? "worried"
        : "unimpressed"
      : feedback?.kind === "right"
        ? ply % 4 === 1
          ? "proud"
          : "happy"
        : feedback?.kind === "known"
          ? "smug"
          : learnerTurn && pass === "practice"
            ? "thinking"
            : "neutral";
  const quip = feedback?.kind === "wrong" || (feedback?.kind === "right" && pass === "practice") ? kittuSays(mood, ply + mistakes) : undefined;

  const percent =
    pass === "watch"
      ? Math.round((ply / line.moves.length) * 100)
      : Math.round((((pass === "practice" ? learnerTotal : 0) + learnerDone) / (mode === "learn" ? 2 * learnerTotal : learnerTotal)) * 100);
  const canWatch = mode === "learn" && pass === "learn" && ply <= 1 && learnerDone === 0;

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="mx-auto w-full max-w-[min(78vh,660px)] lg:flex-1">
        <div className="mb-3 h-4 overflow-hidden rounded-full bg-[#3c3a37]">
          <div className={`h-full rounded-full transition-[width] duration-500 ${pass === "watch" ? "bg-[#749bbf]" : "bg-brand"}`} style={{ width: `${Math.max(3, percent)}%` }} />
        </div>
        <div key={shake} className={shake ? "animate-shake" : ""}>
          <Board fen={fen} orientation={orientation} onMove={learnerTurn ? onMove : undefined} lastMove={lastMove} arrows={arrows} highlights={highlights} id="lesson" />
        </div>
      </div>

      <div className="flex w-full flex-col gap-3 lg:w-[360px]">
        <div className="card p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="text-xs font-bold uppercase tracking-wide text-muted">
              {pass === "watch" ? "Watch" : pass === "learn" ? "Learn" : mode === "learn" ? "Practice from memory" : "Review"} ·{" "}
              {pass === "watch" ? `move ${Math.min(ply + 1, line.moves.length)}/${line.moves.length}` : `${learnerDone}/${learnerTotal} moves`}
            </div>
            <NarrationControls />
          </div>
          <h2 className="mt-1 text-lg font-extrabold">{line.name}</h2>
          {banner && pass !== "watch" && <p className="mt-2 rounded-md bg-brand/15 px-3 py-2 text-sm font-semibold text-brand-light">{banner}</p>}
          {canWatch && (
            <button className="btn-primary mt-3 w-full justify-center" onClick={() => restart("watch")}>
              <Play size={18} /> Watch the lesson first
            </button>
          )}
          {pass === "watch" && (
            <div className="mt-3 flex gap-2">
              <button className="btn-secondary flex-1 justify-center" onClick={() => setPaused((p) => !p)}>
                {paused ? <Play size={16} /> : <Pause size={16} />} {paused ? "Resume" : "Pause"}
              </button>
              <button className="btn-secondary" onClick={() => setWatchStep((n) => n + 1)} aria-label="Next move" title="Next move" disabled={ply >= line.moves.length}>
                <StepForward size={16} />
              </button>
              <button
                className="btn-secondary"
                onClick={() => {
                  setBanner("Your turn: play the line yourself, with the arrow to guide you.");
                  restart("learn");
                }}
                title="Skip to playing it yourself"
              >
                <SkipForward size={16} /> Play it
              </button>
            </div>
          )}
        </div>

        <KittuBubble
          mood={mood}
          quip={quip}
          tone={feedback?.kind === "wrong" ? "bad" : feedback?.kind === "right" ? "good" : "white"}
        >
          {feedback?.text ??
            (learnerTurn
              ? pass === "learn"
                ? "Your move."
                : "Your move: what's the repertoire move here?"
              : "Watch the opponent's move…")}
        </KittuBubble>

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
