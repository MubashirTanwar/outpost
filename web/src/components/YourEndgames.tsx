"use client";

import { ChevronDown, Swords } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Board } from "@/components/Board";
import { ClassificationIcon } from "@/components/ClassificationIcon";
import { getInsightSources } from "@/lib/client";
import { summarizeEndgames, type EndgameSummary, type PracticePosition } from "@/lib/endgamePractice";
import { toIGame } from "@/lib/insights";
import type { Classification } from "@/lib/types";
import { useRememberedUser } from "@/lib/user";

export function practiceHref(p: PracticePosition): string {
  const q = new URLSearchParams({ fen: p.fen, side: p.side, goal: p.goal, id: p.id, from: `vs ${p.opponent}, move ${p.moveNumber}` });
  return `/endgames/practice?${q}`;
}

/** The endgames you actually reach, by type, with positions from your games to practise. */
export function YourEndgames() {
  const user = useRememberedUser();
  const [summary, setSummary] = useState<EndgameSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    getInsightSources(user, 365)
      .then((src) => setSummary(summarizeEndgames(src.flatMap((s) => toIGame(s) ?? []))))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [user]);

  const total = useMemo(() => summary?.reduce((n, s) => n + s.games, 0) ?? 0, [summary]);

  return (
    <section className="mt-8">
      <div className="rounded-xl bg-[#749bbf] px-5 py-4 text-[#0f1d2b] shadow-btn">
        <div className="text-lg font-extrabold">Endgames from your games</div>
        <p className="mt-1 text-sm font-semibold opacity-80">
          The endings you actually reach, how they go, and the exact positions to practise against Stockfish: where you went wrong, or where the endgame began.
        </p>
      </div>
      {!user ? (
        <p className="card mt-3 p-4 text-sm text-soft">
          Enter your chess.com username on the <Link href="/" className="font-bold text-brand-light hover:underline">home page</Link> first.
        </p>
      ) : error ? (
        <p className="card mt-3 p-4 text-sm text-[#ff8a7a]">Couldn&apos;t load your games: {error}</p>
      ) : summary === null ? (
        <p className="card mt-3 p-4 text-sm text-muted">Looking through your reviewed games…</p>
      ) : total === 0 ? (
        <p className="card mt-3 p-4 text-sm text-soft">
          None of your reviewed games reached an endgame yet. Run &quot;Analyse my last 30 days&quot; on your{" "}
          <Link href={`/u/${encodeURIComponent(user)}/progress`} className="font-bold text-brand-light hover:underline">Progress</Link> page.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-muted">{total} of your reviewed games reached an endgame.</p>
          {summary.map((s) => (
            <div key={s.type} className="card overflow-hidden">
              <button className="flex w-full items-center gap-3 p-4 text-left" onClick={() => setOpen(open === s.type ? null : s.type)} aria-expanded={open === s.type}>
                <div className="min-w-0 flex-1">
                  <div className="font-extrabold">
                    {s.type} <span className="font-normal text-muted">· {s.games} games</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    <span className="text-brand-light">{s.wins}W</span> · {s.draws}D · <span className="text-[#ff8a7a]">{s.losses}L</span> ·{" "}
                    {s.mistakes} mistake{s.mistakes === 1 ? "" : "s"} · {s.details.slice(0, 2).map((d) => `${d.detail} (${d.games})`).join(", ")}
                  </div>
                </div>
                <span className="shrink-0 rounded-md bg-panel2 px-2.5 py-1 text-xs font-bold text-soft">{s.positions.length} to practise</span>
                <ChevronDown size={18} className={`shrink-0 transition ${open === s.type ? "rotate-180" : ""}`} />
              </button>
              {open === s.type && (
                <div className="grid gap-3 border-t border-line p-3 sm:grid-cols-2 lg:grid-cols-3">
                  {s.positions.length === 0 && <p className="text-sm text-muted">No positions you could still win or hold.</p>}
                  {s.positions.slice(0, 12).map((p) => (
                    <PositionCard key={p.id} p={p} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function PositionCard({ p }: { p: PracticePosition }) {
  return (
    <Link href={practiceHref(p)} className="rounded-md bg-panel2 p-2 hover:bg-[#363431]">
      <div className="pointer-events-none">
        <Board fen={p.fen} orientation={p.side} notation={false} id={`eg-${p.id}`} />
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-sm font-bold">
        {p.mistake && <ClassificationIcon cls={p.mistake.classification as Classification} size={16} />}
        <span className="truncate">{p.detail}</span>
        <span className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-extrabold uppercase ${p.goal === "win" ? "bg-brand/30 text-brand-light" : "bg-[#749bbf]/30 text-[#a9c5e0]"}`}>
          {p.goal === "win" ? "Win it" : "Hold it"}
        </span>
      </div>
      <div className="mt-0.5 text-xs text-muted">
        vs {p.opponent} · move {p.moveNumber}
        {p.mistake ? (
          <>
            {" "}
            · you played <b className="text-white">{p.mistake.san}</b>
            {p.mistake.best && (
              <>
                , best was <b className="text-brand-light">{p.mistake.best}</b>
              </>
            )}
          </>
        ) : (
          " · where the endgame began"
        )}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-xs font-bold text-brand-light">
        <Swords size={14} /> Practise against Stockfish
      </div>
    </Link>
  );
}
