"use client";

import { BookOpen, Bot, Crown, LineChart, Loader2, Puzzle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Board } from "@/components/Board";
import { ClassificationIcon } from "@/components/ClassificationIcon";
import { KittuBubble } from "@/components/KittuBubble";
import { playerExists } from "@/lib/chesscom";
import { rememberUser, useRememberedUser } from "@/lib/user";

const HERO_FEN = "r1bq1rk1/pppp1Bpp/2n2n2/2b1p3/4P3/2N2N2/PPPP1PPP/R1BQK2R b KQ - 0 6";

const FEATURES = [
  { icon: LineChart, title: "Day Review", text: "Every game you played today, reviewed move by move: brilliant, best, mistake, blunder." },
  { icon: Bot, title: "Coach Kittu", text: "A sassy AI cat coach (LangGraph agents) who remembers your patterns across games. Roasts your moves, never you." },
  { icon: Puzzle, title: "Your Puzzles", text: "Every mistake you make becomes a puzzle, with spaced repetition so it sticks." },
  { icon: BookOpen, title: "Opening Courses", text: "Six full repertoires, Duolingo-style: learn every line, earn XP, keep your streak." },
  { icon: Crown, title: "Endgames", text: "Lucena, Philidor, basic mates: play them out against Stockfish." },
];

export default function Home() {
  const router = useRouter();
  const remembered = useRememberedUser();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async (username: string) => {
    const u = username.trim();
    if (!u) return;
    setBusy(true);
    setError(null);
    try {
      if (!(await playerExists(u))) {
        setError(`No chess.com player called "${u}".`);
        return;
      }
    } catch {
      // chess.com unreachable from the browser: let the backend try instead.
    } finally {
      setBusy(false);
    }
    rememberUser(u, true);
    router.push(`/u/${encodeURIComponent(u)}`);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 md:py-16">
      <div className="grid items-center gap-10 md:grid-cols-2">
        <div className="mx-auto w-full max-w-[460px]">
          <Board fen={HERO_FEN} badge={{ square: "f7", cls: "brilliant" }} lastMove={{ from: "c4", to: "f7" }} id="hero" />
          <div className="mt-4">
            <KittuBubble mood="smug" quip="Hi, I'm Kittu. I'll be judging your moves.">
              Enter your chess.com username and I&apos;ll review your games, roast your blunders and teach you to stop making them.
            </KittuBubble>
          </div>
        </div>
        <div>
          <h1 className="text-4xl font-extrabold leading-tight md:text-5xl">
            Outpost.
            <br />
            <span className="text-brand">Your chess training base.</span>
          </h1>
          <p className="mt-4 text-lg text-soft">
            Enter your chess.com username. Get a full review of every game you played today, find out what keeps costing
            you points, and train on puzzles made from your own mistakes.
          </p>
          <form
            className="mt-7 flex flex-col gap-3 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              go(name);
            }}
          >
            <input
              className="input flex-1 text-lg"
              placeholder="chess.com username"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <button className="btn-primary" disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="animate-spin" size={20} /> : null}
              Review my games
            </button>
          </form>
          {error && <p className="mt-2 text-sm text-[#fa412d]">{error}</p>}
          {remembered && (
            <button onClick={() => go(remembered)} className="mt-3 text-sm text-muted underline-offset-2 hover:text-white hover:underline">
              Continue as <b>{remembered}</b>
            </button>
          )}
          <div className="mt-6 flex flex-wrap gap-2">
            {(["brilliant", "great", "best", "inaccuracy", "mistake", "blunder"] as const).map((c) => (
              <ClassificationIcon key={c} cls={c} size={26} />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <div key={title} className="card p-5">
            <Icon className="text-brand" size={26} />
            <h3 className="mt-3 font-extrabold">{title}</h3>
            <p className="mt-1 text-sm text-soft">{text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
