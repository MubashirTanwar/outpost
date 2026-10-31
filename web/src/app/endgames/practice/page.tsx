"use client";

import { Chess } from "chess.js";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, useState } from "react";
import { DrillPlayer } from "@/components/DrillPlayer";
import { GOAL_TEXT, type Drill } from "@/lib/endgames";
import { recordDrill } from "@/lib/progress";
import { updateProgress } from "@/lib/useProgress";

/** Practise one endgame position from your own games against Stockfish. */
function Practice() {
  const search = useSearchParams();
  const [result, setResult] = useState<{ stars: number; xp: number } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const drill = useMemo<Drill | null>(() => {
    const fen = search.get("fen") ?? "";
    const goal = search.get("goal") === "draw" ? "draw" : "win";
    const side = search.get("side") === "black" ? "black" : "white";
    try {
      const c = new Chess(fen);
      if ((c.turn() === "w") !== (side === "white")) return null;
    } catch {
      return null;
    }
    const hint =
      goal === "win"
        ? "You were better here. Activate your king, push your passed pawn, and don't let the advantage slip."
        : "Hold the balance: keep your king active, your rook behind or beside the pawns, and avoid passive defence.";
    return { id: search.get("id") ?? `practice-${fen}`, fen, goal, side, hint, known: false };
  }, [search]);

  const onDone = useCallback(
    ({ stars }: { ok: boolean; stars: number }) => {
      if (!drill) return;
      let xp = 0;
      updateProgress((prev) => {
        const out = recordDrill(prev, drill.id, stars, Date.now());
        xp = out.xp;
        return out.progress;
      });
      setResult({ stars, xp });
    },
    [drill],
  );

  if (!drill) return <div className="p-6 text-soft">That position couldn&apos;t be loaded. Go back and pick another.</div>;
  return (
    <div className="mx-auto max-w-[1100px] p-3 lg:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Link href="/endgames" className="text-sm text-muted hover:text-white">
          ← Endgame Academy
        </Link>
        <span className="text-sm text-muted">From your game {search.get("from") ?? ""}</span>
      </div>
      <h1 className="mb-3 text-xl font-extrabold">
        {GOAL_TEXT[drill.goal]} <span className="text-muted">· you play {drill.side}</span>
      </h1>
      <DrillPlayer key={attempt} drill={drill} onDone={onDone} />
      {result && (
        <div className="card mt-4 flex flex-wrap items-center gap-3 p-4">
          <span className="text-lg font-extrabold text-[#f7c631]">{"★".repeat(result.stars)}</span>
          <span className="text-soft">+{result.xp} XP. Done with this one.</span>
          <button className="btn-secondary ml-auto" onClick={() => { setResult(null); setAttempt((a) => a + 1); }}>
            Play it again
          </button>
          <Link href="/endgames" className="btn-primary">
            More positions
          </Link>
        </div>
      )}
    </div>
  );
}

export default function PracticePage() {
  return (
    <Suspense fallback={<div className="p-6 text-muted">Loading…</div>}>
      <Practice />
    </Suspense>
  );
}
