"use client";

import { Chess, type Square } from "chess.js";
import { Eye, Lightbulb, SkipForward } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Board, type Arrow } from "@/components/Board";
import { kittuSays } from "@/components/Kittu";
import { KittuBubble } from "@/components/KittuBubble";
import { getPuzzles, recordAttempt } from "@/lib/client";
import { prettyMotif, uciToMove } from "@/lib/format";
import { playSound, soundForMove } from "@/lib/sounds";
import type { Puzzle } from "@/lib/types";

type Status = "solving" | "wrong" | "solved" | "failed";

export default function PuzzlesPage({ params }: { params: { username: string } }) {
  const username = decodeURIComponent(params.username);
  const [puzzles, setPuzzles] = useState<Puzzle[] | null>(null);
  const [motif, setMotif] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [fen, setFen] = useState("");
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<Status>("solving");
  const [mistakes, setMistakes] = useState(0);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [hint, setHint] = useState(false);
  const [score, setScore] = useState({ solved: 0, failed: 0 });
  const [shake, setShake] = useState(0);

  useEffect(() => {
    getPuzzles(username, motif ?? undefined).then((p) => {
      setPuzzles(p);
      setIdx(0);
    });
  }, [username, motif]);

  const puzzle = puzzles?.[idx];
  const motifs = useMemo(() => Array.from(new Set((puzzles ?? []).flatMap((p) => p.motifs))), [puzzles]);
  const orientation = puzzle ? (puzzle.fen.split(" ")[1] === "w" ? "white" : "black") : "white";

  const load = useCallback((p: Puzzle | undefined) => {
    if (!p) return;
    setFen(p.fen);
    setStep(0);
    setStatus("solving");
    setMistakes(0);
    setLastMove(null);
    setHint(false);
  }, []);

  useEffect(() => load(puzzle), [puzzle, load]);

  const finish = (solved: boolean) => {
    if (!puzzle) return;
    setStatus(solved ? "solved" : "failed");
    setScore((s) => (solved ? { ...s, solved: s.solved + 1 } : { ...s, failed: s.failed + 1 }));
    playSound(solved ? "correct" : "wrong");
    void recordAttempt(username, puzzle, solved);
  };

  const onMove = (from: Square, to: Square, promotion?: string) => {
    if (!puzzle || (status !== "solving" && status !== "wrong")) return false;
    const chess = new Chess(fen);
    let mv;
    try {
      mv = chess.move({ from, to, promotion });
    } catch {
      return false;
    }
    const expected = puzzle.solution[step];
    const uci = from + to + (mv.promotion ?? "");
    // Any mating move is accepted, not just the engine's.
    if (uci !== expected && !chess.isCheckmate()) {
      setMistakes((m) => m + 1);
      setStatus("wrong");
      setShake((s) => s + 1);
      playSound("wrong");
      if (mistakes + 1 >= 2) finish(false);
      return false;
    }
    setFen(chess.fen());
    setLastMove({ from, to });
    playSound(soundForMove(mv));
    const next = step + 1;
    if (next >= puzzle.solution.length || chess.isCheckmate()) {
      if (mistakes === 0) finish(true);
      else setStatus("failed");
      return true;
    }
    setStatus("solving");
    // Opponent's reply.
    setTimeout(() => {
      const reply = uciToMove(puzzle.solution[next]);
      const m2 = chess.move(reply);
      setFen(chess.fen());
      setLastMove(reply);
      playSound(soundForMove(m2));
      setStep(next + 1);
    }, 450);
    return true;
  };

  const showSolution = () => {
    if (!puzzle) return;
    const chess = new Chess(puzzle.fen);
    let mv = null;
    for (const u of puzzle.solution) mv = chess.move(uciToMove(u));
    setFen(chess.fen());
    if (mv) setLastMove({ from: mv.from, to: mv.to });
    if (status === "solving" || status === "wrong") finish(false);
  };

  const hintArrow: Arrow[] =
    hint && puzzle && step < puzzle.solution.length
      ? [[puzzle.solution[step].slice(0, 2) as Square, puzzle.solution[step].slice(2, 4) as Square, "rgba(129,182,76,0.8)"]]
      : [];

  if (puzzles === null) return <div className="p-8 text-soft">Loading puzzles…</div>;
  if (!puzzles.length)
    return (
      <div className="mx-auto max-w-xl p-8">
        <div className="card p-6">
          <h2 className="text-xl font-extrabold">No puzzles yet</h2>
          <p className="mt-2 text-soft">
            Puzzles are built from the mistakes in your own games. Run a{" "}
            <Link className="text-brand underline" href={`/u/${encodeURIComponent(username)}`}>
              day review
            </Link>{" "}
            first.
          </p>
        </div>
      </div>
    );

  return (
    <div className="mx-auto flex max-w-[1150px] flex-col gap-5 p-3 lg:flex-row lg:p-5">
      <div className="mx-auto w-full max-w-[min(85vh,680px)] lg:flex-1">
        {/* Re-keyed on each wrong try so the shake animation replays. */}
        <div key={shake} className={shake ? "animate-shake" : ""}>
          <Board fen={fen || puzzle!.fen} orientation={orientation} onMove={onMove} lastMove={lastMove} arrows={hintArrow} id="puzzle" />
        </div>
      </div>

      <div className="card flex w-full flex-col p-5 lg:w-[380px]">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-extrabold">Your Puzzles</h2>
          <span className="text-sm text-muted">
            {idx + 1} / {puzzles.length}
          </span>
        </div>
        <div className="mt-1 flex gap-3 text-sm">
          <span className="text-brand">✓ {score.solved}</span>
          <span className="text-[#fa412d]">✗ {score.failed}</span>
        </div>

        <div className="mt-4">
          <KittuBubble
            mood={status === "solved" ? "starry" : status === "failed" ? "sad" : status === "wrong" ? "unimpressed" : "thinking"}
            quip={kittuSays(status === "solved" ? "starry" : status === "failed" ? "sad" : status === "wrong" ? "unimpressed" : "thinking", idx)}
            tone={status === "solved" ? "good" : status === "failed" || status === "wrong" ? "bad" : "white"}
          >
            {status === "solving" && <>{orientation === "white" ? "White" : "Black"} to move. Find the best move.</>}
            {status === "wrong" && <>That&apos;s not it. One more try.</>}
            {status === "solved" && <>Solved! {puzzle!.best_san} was the move.</>}
            {status === "failed" && (
              <>
                In the game you played <b>{puzzle!.played}</b>. Best was <b>{puzzle!.best_san}</b>.
              </>
            )}
          </KittuBubble>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {puzzle!.motifs.map((m) => (
            <span key={m} className="rounded bg-[#3c3a37] px-2 py-0.5 text-xs text-soft">
              {prettyMotif(m)}
            </span>
          ))}
          <span className="rounded bg-[#3c3a37] px-2 py-0.5 text-xs text-soft">{puzzle!.phase}</span>
          {puzzle!.attempt && (
            <span className="rounded bg-[#3c3a37] px-2 py-0.5 text-xs text-soft">
              seen {puzzle!.attempt.attempts}× · streak {puzzle!.attempt.streak}
            </span>
          )}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <button className="btn-secondary" onClick={() => setHint(true)} disabled={status === "solved" || status === "failed"}>
            <Lightbulb size={16} /> Hint
          </button>
          <button className="btn-secondary" onClick={showSolution}>
            <Eye size={16} /> Solution
          </button>
          <button className="btn-secondary" onClick={() => load(puzzle)}>
            Retry
          </button>
        </div>
        <button className="btn-primary mt-3" onClick={() => setIdx((i) => (i + 1) % puzzles.length)}>
          Next puzzle <SkipForward size={18} />
        </button>

        <Link
          href={`/u/${encodeURIComponent(username)}/game/${encodeURIComponent(puzzle!.game_id)}`}
          className="mt-3 text-center text-sm text-muted hover:text-white"
        >
          Open the game this came from →
        </Link>

        {motifs.length > 1 && (
          <div className="mt-6">
            <h4 className="mb-2 text-xs font-bold uppercase text-muted">Train a theme</h4>
            <div className="flex flex-wrap gap-1.5">
              <Chip active={!motif} onClick={() => setMotif(null)}>
                All
              </Chip>
              {motifs.map((m) => (
                <Chip key={m} active={motif === m} onClick={() => setMotif(m)}>
                  {prettyMotif(m)}
                </Chip>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-bold ${active ? "bg-brand text-white" : "bg-[#3c3a37] text-soft hover:text-white"}`}
    >
      {children}
    </button>
  );
}
