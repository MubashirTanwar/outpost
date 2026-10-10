"use client";

import { Chess, type Square } from "chess.js";
import { RotateCcw, Undo2, X } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Board, type Arrow } from "@/components/Board";
import { kittuSays, type KittuMood } from "@/components/Kittu";
import { KittuBubble } from "@/components/KittuBubble";
import { getCourse } from "@/lib/courses";
import { bookReply, buildRepertoire, expectedMove } from "@/lib/repertoire";
import { playSound, soundForMove } from "@/lib/sounds";
import { getBrowserEngine } from "@/lib/stockfish";

const LEVELS = [
  { id: "easy", label: "Kitten", skill: 2, ms: 150 },
  { id: "medium", label: "House cat", skill: 8, ms: 300 },
  { id: "hard", label: "Lion", skill: 20, ms: 700 },
] as const;

type Note = { mood: KittuMood; quip?: string; text: string; tone: "white" | "good" | "bad" };

/**
 * Play your repertoire against Kittu. While the game is in the course, the bot answers with
 * course moves (a random line each time); once it's out of the course, Stockfish takes over.
 */
export default function PracticePage({ params }: { params: { id: string } }) {
  const course = getCourse(params.id);
  if (!course) notFound();
  const rep = useMemo(() => buildRepertoire(course), [course]);
  const me = course.color === "white" ? "w" : "b";
  const game = useRef(new Chess());
  const [fen, setFen] = useState(game.current.fen());
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [level, setLevel] = useState<(typeof LEVELS)[number]>(LEVELS[1]);
  const [inBook, setInBook] = useState(true);
  const [bookMoves, setBookMoves] = useState(0);
  const [deviations, setDeviations] = useState(0);
  const [hint, setHint] = useState<Arrow[]>([]);
  const [thinking, setThinking] = useState(false);
  const [note, setNote] = useState<Note>({ mood: "smug", quip: "Let's see if you actually studied.", text: "Play your repertoire. I'll throw different lines at you.", tone: "white" });

  const sync = () => setFen(game.current.fen());

  const endCheck = useCallback(() => {
    const g = game.current;
    if (!g.isGameOver()) return false;
    const won = g.isCheckmate() && g.turn() !== me;
    playSound(won ? "end" : "wrong");
    setNote(
      g.isCheckmate()
        ? won
          ? { mood: "party", quip: kittuSays("party", bookMoves), text: "Checkmate! You beat me. This time.", tone: "good" }
          : { mood: "smug", quip: "Heh.", text: "Checkmate. Kittu wins. New game?", tone: "bad" }
        : { mood: "neutral", text: "It's a draw.", tone: "white" },
    );
    return true;
  }, [me, bookMoves]);

  const botMove = useCallback(async () => {
    const g = game.current;
    if (g.isGameOver()) return;
    setThinking(true);
    const book = inBook ? bookReply(rep, g.fen()) : null;
    let uci = book?.uci;
    if (!uci) {
      const engine = getBrowserEngine();
      const [line] = await engine.analyse(g.fen(), { movetime: level.ms, skill: level.skill });
      uci = line?.pv[0];
    } else {
      await new Promise((r) => setTimeout(r, 450));
    }
    setThinking(false);
    if (!uci) return;
    const mv = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    sync();
    setLastMove({ from: mv.from, to: mv.to });
    playSound(soundForMove(mv));
    if (endCheck()) return;
    if (inBook && !book) {
      setInBook(false);
      setNote({ mood: "thinking", quip: "Off the map now.", text: `${mv.san} isn't in the course. From here you're on your own: play good chess.`, tone: "white" });
    } else if (inBook && !expectedMove(rep, g.fen())) {
      setInBook(false);
      setNote({ mood: "proud", quip: kittuSays("proud", bookMoves), text: `That's the end of the course line after ${mv.san}. Play the middlegame from here.`, tone: "good" });
    }
  }, [inBook, rep, level, endCheck, bookMoves]);

  // The bot moves first when you play Black.
  useEffect(() => {
    if (game.current.turn() !== me && game.current.history().length === 0) void botMove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onMove = (from: Square, to: Square, promotion?: string) => {
    const g = game.current;
    if (thinking || g.isGameOver() || g.turn() !== me) return false;
    const before = g.fen();
    let mv;
    try {
      mv = g.move({ from, to, promotion });
    } catch {
      return false;
    }
    sync();
    setLastMove({ from, to });
    setHint([]);
    playSound(soundForMove(mv));
    const expected = inBook ? expectedMove(rep, before) : null;
    if (expected) {
      if (expected.uci === mv.from + mv.to + (mv.promotion ?? "")) {
        setBookMoves((n) => n + 1);
        setNote({ mood: bookMoves % 3 === 2 ? "proud" : "happy", text: `${mv.san} ✓ That's the course move.`, tone: "good" });
      } else {
        setDeviations((n) => n + 1);
        setNote({
          mood: "unimpressed",
          quip: kittuSays("unimpressed", deviations),
          text: `Your course plays ${expected.san} here. Take it back and try again, or play on.`,
          tone: "bad",
        });
        const e = expected.uci;
        setHint([[e.slice(0, 2) as Square, e.slice(2, 4) as Square, "rgba(129,182,76,0.8)"]]);
        setInBook(false);
        return true;
      }
    }
    if (!endCheck()) void botMove();
    return true;
  };

  const takeBack = () => {
    const g = game.current;
    if (thinking || g.history().length === 0) return;
    g.undo();
    if (g.turn() !== me && g.history().length) g.undo();
    sync();
    setLastMove(null);
    setHint([]);
    // Back inside the course? Then the bot uses the book again.
    const back = !!expectedMove(rep, g.fen()) || g.history().length === 0;
    setInBook(back);
    setNote({ mood: "thinking", text: back ? "Taken back. Your move." : "Taken back.", tone: "white" });
  };

  const newGame = () => {
    game.current = new Chess();
    sync();
    setLastMove(null);
    setHint([]);
    setInBook(true);
    setBookMoves(0);
    setDeviations(0);
    setNote({ mood: "smug", quip: "Again? Fine.", text: "New game. Different lines this time, probably.", tone: "white" });
    if (me === "b") setTimeout(() => void botMove(), 300);
  };

  return (
    <div className="mx-auto max-w-[1150px] p-3 lg:p-6">
      <div className="mb-3 flex items-center gap-3">
        <Link href={`/courses/${course.id}`} className="text-muted hover:text-white" aria-label="Back to the course">
          <X size={26} />
        </Link>
        <h1 className="text-xl font-extrabold">Practice vs Kittu · {course.name}</h1>
      </div>
      <div className="flex flex-col gap-5 lg:flex-row">
        <div className="mx-auto w-full max-w-[min(80vh,660px)] lg:flex-1">
          <Board fen={fen} orientation={course.color} onMove={onMove} lastMove={lastMove} arrows={hint} id="practice" />
        </div>
        <div className="flex w-full flex-col gap-3 lg:w-[360px]">
          <KittuBubble mood={thinking ? "thinking" : note.mood} quip={note.quip} tone={note.tone}>
            {thinking ? "Kittu is thinking…" : note.text}
          </KittuBubble>
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <Stat label="In book" value={inBook ? "yes" : "no"} color={inBook ? "text-brand-light" : "text-muted"} />
            <Stat label="Course moves" value={String(bookMoves)} color="text-brand-light" />
            <Stat label="Deviations" value={String(deviations)} color={deviations ? "text-[#ffa459]" : "text-soft"} />
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary flex-1" onClick={takeBack} disabled={thinking}>
              <Undo2 size={16} /> Take back
            </button>
            <button className="btn-secondary flex-1" onClick={newGame}>
              <RotateCcw size={16} /> New game
            </button>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-bold uppercase text-muted">Kittu&apos;s strength after the course</div>
            <div className="grid grid-cols-3 gap-2">
              {LEVELS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setLevel(l)}
                  className={`rounded-lg px-2 py-2 text-sm font-bold ${level.id === l.id ? "bg-brand text-white" : "bg-[#3c3a37] text-soft hover:text-white"}`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-md bg-panel p-2">
      <div className="text-[11px] font-bold uppercase text-muted">{label}</div>
      <div className={`text-lg font-extrabold ${color}`}>{value}</div>
    </div>
  );
}
