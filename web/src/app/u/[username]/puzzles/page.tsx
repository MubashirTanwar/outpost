"use client";

import { SkipForward } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Kittu } from "@/components/Kittu";
import { PuzzlePlayer } from "@/components/PuzzlePlayer";
import { getPuzzles, recordAttempt } from "@/lib/client";
import { prettyMotif } from "@/lib/format";
import type { Puzzle } from "@/lib/types";

export default function PuzzlesPage({ params }: { params: { username: string } }) {
  const username = decodeURIComponent(params.username);
  const [puzzles, setPuzzles] = useState<Puzzle[] | null>(null);
  const [motif, setMotif] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [finished, setFinished] = useState<boolean | null>(null);
  const [score, setScore] = useState({ solved: 0, failed: 0 });

  useEffect(() => {
    getPuzzles(username, motif ?? undefined).then((p) => {
      setPuzzles(p);
      setIdx(0);
      setFinished(null);
    });
  }, [username, motif]);

  const puzzle = puzzles?.[idx];
  const motifs = useMemo(() => Array.from(new Set((puzzles ?? []).flatMap((p) => p.motifs))), [puzzles]);

  const onFinish = useCallback(
    (solved: boolean) => {
      if (!puzzle) return;
      setFinished(solved);
      setScore((s) => (solved ? { ...s, solved: s.solved + 1 } : { ...s, failed: s.failed + 1 }));
      void recordAttempt(username, puzzle, solved);
    },
    [puzzle, username],
  );

  const next = () => {
    setFinished(null);
    setIdx((i) => (i + 1) % (puzzles?.length || 1));
  };

  if (puzzles === null) return <div className="p-8 text-soft">Loading puzzles…</div>;
  if (!puzzles.length)
    return (
      <div className="mx-auto max-w-xl p-8">
        <div className="card flex items-center gap-4 p-6">
          <Kittu mood="unimpressed" size={90} />
          <div>
            <h2 className="text-xl font-extrabold">No puzzles yet</h2>
            <p className="mt-2 text-soft">
              Puzzles are built from the mistakes in your own games. Run a{" "}
              <Link className="text-brand underline" href={`/u/${encodeURIComponent(username)}`}>
                day review
              </Link>{" "}
              first. I&apos;m sure you made some.
            </p>
          </div>
        </div>
      </div>
    );

  return (
    <div className="mx-auto max-w-[1150px] p-3 lg:p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-extrabold">Your Puzzles</h1>
        <span className="text-sm text-muted">
          {idx + 1} / {puzzles.length}
        </span>
        <span className="text-sm font-bold text-brand">✓ {score.solved}</span>
        <span className="text-sm font-bold text-[#fa412d]">✗ {score.failed}</span>
        <div className="ml-auto flex items-center gap-2">
          {finished !== null && (
            <button className="btn-primary py-2 text-base" onClick={next}>
              Next puzzle <SkipForward size={18} />
            </button>
          )}
          {finished === null && (
            <button className="btn-secondary" onClick={next}>
              Skip
            </button>
          )}
        </div>
      </div>

      {puzzle && <PuzzlePlayer key={puzzle.id} puzzle={puzzle} onFinish={onFinish} />}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link href={`/u/${encodeURIComponent(username)}/game/${encodeURIComponent(puzzle!.game_id)}`} className="text-sm text-muted hover:text-white">
          Open the game this came from →
        </Link>
        {puzzle!.attempt && (
          <span className="text-xs text-muted">
            Seen {puzzle!.attempt.attempts}× · streak {puzzle!.attempt.streak}
          </span>
        )}
      </div>

      {motifs.length > 1 && (
        <div className="mt-5">
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
