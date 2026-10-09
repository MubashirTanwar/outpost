"use client";

import { Chess, type Square } from "chess.js";
import { Lightbulb, RotateCcw } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Board, type Arrow } from "@/components/Board";
import openingData from "@/data/openings.json";
import { playSound, soundForMove } from "@/lib/sounds";
import type { OpeningLine } from "@/lib/types";

const LINES = openingData as OpeningLine[];
const MASTERY_KEY = "cc-opening-mastery";

function loadMastery(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(MASTERY_KEY) || "{}");
  } catch {
    return {};
  }
}

function OpeningTrainer() {
  const search = useSearchParams();
  const [lineId, setLineId] = useState(search.get("line") ?? LINES[0].id);
  const line = LINES.find((l) => l.id === lineId) ?? LINES[0];
  const sans = useMemo(() => line.moves.split(" "), [line]);
  const [ply, setPly] = useState(0);
  const [fen, setFen] = useState(new Chess().fen());
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [errors, setErrors] = useState(0);
  const [hint, setHint] = useState(false);
  const [mastery, setMastery] = useState<Record<string, number>>({});
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => setMastery(loadMastery()), []);

  const userIsWhite = line.color === "white";
  const userTurn = (ply % 2 === 0) === userIsWhite;
  const done = ply >= sans.length;

  const playOpponent = useCallback(
    (chess: Chess, at: number) => {
      if (at >= sans.length) return;
      timer.current = setTimeout(() => {
        const mv = chess.move(sans[at]);
        setFen(chess.fen());
        setLastMove({ from: mv.from, to: mv.to });
        playSound(soundForMove(mv));
        setPly(at + 1);
      }, 450);
    },
    [sans],
  );

  const reset = useCallback(() => {
    clearTimeout(timer.current);
    const chess = new Chess();
    setFen(chess.fen());
    setPly(0);
    setLastMove(null);
    setErrors(0);
    setHint(false);
    setMessage("");
    if (!userIsWhite) playOpponent(chess, 0);
  }, [userIsWhite, playOpponent]);

  useEffect(() => {
    reset();
    return () => clearTimeout(timer.current);
  }, [lineId, reset]);

  useEffect(() => {
    if (done && sans.length) {
      playSound("end");
      setMessage(errors === 0 ? "Perfect! Line complete with no mistakes." : `Line complete with ${errors} mistake${errors > 1 ? "s" : ""}. Go again!`);
      if (errors === 0) {
        const next = { ...loadMastery(), [line.id]: (loadMastery()[line.id] ?? 0) + 1 };
        setMastery(next);
        try {
          localStorage.setItem(MASTERY_KEY, JSON.stringify(next));
        } catch {}
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  const onMove = (from: Square, to: Square, promotion?: string) => {
    if (!userTurn || done) return false;
    const chess = new Chess(fen);
    const expected = chess.move(sans[ply]);
    chess.undo();
    if (expected.from !== from || expected.to !== to) {
      setErrors((e) => e + 1);
      setHint(true);
      setMessage(`Not in the repertoire. The line continues ${expected.san}.`);
      playSound("wrong");
      return false;
    }
    const mv = chess.move({ from, to, promotion });
    setFen(chess.fen());
    setLastMove({ from, to });
    playSound(soundForMove(mv));
    setHint(false);
    setMessage("");
    setPly(ply + 1);
    playOpponent(chess, ply + 1);
    return true;
  };

  const hintArrow: Arrow[] = useMemo(() => {
    if (!hint || done || !userTurn) return [];
    const c = new Chess(fen);
    const mv = c.move(sans[ply]);
    return [[mv.from as Square, mv.to as Square, "rgba(129,182,76,0.8)"]];
  }, [hint, done, userTurn, fen, sans, ply]);

  const groups = (["white", "black"] as const).map((color) => ({ color, lines: LINES.filter((l) => l.color === color) }));

  return (
    <div className="mx-auto flex max-w-[1250px] flex-col gap-5 p-3 lg:flex-row lg:p-5">
      <div className="mx-auto w-full max-w-[min(85vh,680px)] lg:flex-1">
        <Board fen={fen} orientation={line.color} onMove={onMove} lastMove={lastMove} arrows={hintArrow} id="opening" />
      </div>

      <div className="flex w-full flex-col gap-4 lg:w-[400px]">
        <div className="card p-5">
          <div className="text-xs font-bold uppercase text-muted">
            {line.eco} · you play {line.color}
          </div>
          <h2 className="mt-1 text-xl font-extrabold">{line.name}</h2>
          <div className="mt-3 flex flex-wrap gap-x-1.5 gap-y-1 font-mono text-sm">
            {sans.slice(0, ply).map((s, i) => (
              <span key={i}>
                {i % 2 === 0 && <span className="text-muted">{i / 2 + 1}.</span>}
                {s}
              </span>
            ))}
            {!done && <span className="text-muted">… {sans.length - ply} moves to go</span>}
          </div>
          <div className={`mt-3 min-h-[1.5rem] text-sm font-semibold ${done && errors === 0 ? "text-brand" : "text-[#ffa459]"}`}>
            {message || (userTurn && !done ? "Your move." : "")}
          </div>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-soft">
            {line.ideas.map((idea) => (
              <li key={idea}>{idea}</li>
            ))}
          </ul>
          <div className="mt-4 flex gap-2">
            <button className="btn-secondary" onClick={reset}>
              <RotateCcw size={16} /> Restart
            </button>
            <button className="btn-secondary" onClick={() => setHint(true)} disabled={done}>
              <Lightbulb size={16} /> Hint
            </button>
            <span className="ml-auto self-center text-xs text-muted">Mastered {mastery[line.id] ?? 0}×</span>
          </div>
        </div>

        <div className="card max-h-[50vh] overflow-y-auto p-3">
          {groups.map((g) => (
            <div key={g.color} className="mb-3">
              <h4 className="mb-1 px-2 text-xs font-bold uppercase text-muted">As {g.color}</h4>
              {g.lines.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setLineId(l.id)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${l.id === line.id ? "bg-[#4b4847] text-white" : "text-soft hover:bg-[#3a3835]"}`}
                >
                  <span className="w-9 text-xs text-muted">{l.eco}</span>
                  <span className="flex-1 font-semibold">{l.name}</span>
                  {(mastery[l.id] ?? 0) > 0 && <span className="text-xs text-brand">★{mastery[l.id]}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <OpeningTrainer />
    </Suspense>
  );
}
