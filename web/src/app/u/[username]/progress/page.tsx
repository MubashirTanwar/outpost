"use client";

import { ArrowDownRight, ArrowUpRight, BarChart3, Table2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BarChart, Legend, LineChart, SERIES_COLORS, type LineSeries } from "@/components/Charts";
import { Kittu, type KittuMood } from "@/components/Kittu";
import { StatsBar } from "@/components/StatsBar";
import { getHistory } from "@/lib/client";
import { COURSES, lineIds } from "@/lib/courses";
import { ALL_DRILLS, STAGES } from "@/lib/endgames";
import { courseSummary } from "@/lib/progress";
import { buckets, inRange, ratingSeries, rollingAverage, summarize, toRow, type HistoryRow } from "@/lib/stats";
import { useNow, useProgress } from "@/lib/useProgress";
import { rememberUser } from "@/lib/user";

const RANGES = [30, 90, 365] as const;
// Color follows the time control, never its rank, so filtering doesn't repaint lines.
const TIME_CLASS_COLOR: Record<string, string> = { rapid: SERIES_COLORS[0], blitz: SERIES_COLORS[1], bullet: SERIES_COLORS[2] };
const ROLLING = 10;

const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function ProgressPage({ params }: { params: { username: string } }) {
  const username = decodeURIComponent(params.username);
  const router = useRouter();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<(typeof RANGES)[number]>(90);
  const [view, setView] = useState<"charts" | "table">("charts");
  const tick = useNow();
  const now = tick || Date.now();

  useEffect(() => {
    rememberUser(username);
    getHistory(username, 365)
      .then((games) => setRows(games.map(toRow)))
      .catch((e) => setError(String(e.message ?? e)));
  }, [username]);

  const current = useMemo(() => (rows ? inRange(rows, days, now) : []), [rows, days, now]);
  const previous = useMemo(() => (rows ? inRange(rows, days, now, 1) : []), [rows, days, now]);
  const cur = summarize(current);
  const prev = summarize(previous);
  const openGame = (id: string) => router.push(`/u/${encodeURIComponent(username)}/game/${encodeURIComponent(id)}`);

  const ratings = ratingSeries(current).filter((s) => TIME_CLASS_COLOR[s.timeClass]);
  const ratingLines: LineSeries[] = ratings.map((s) => ({
    name: cap(s.timeClass),
    color: TIME_CLASS_COLOR[s.timeClass],
    points: s.points.map((p) => ({ t: p.t, y: p.rating, id: p.id })),
  }));
  const main = ratings[0];
  const ratingDelta = main && main.points.length > 1 ? main.points[main.points.length - 1].rating - main.points[0].rating : null;

  const withAcc = current.filter((r) => r.accuracy != null);
  const rolling = rollingAverage(withAcc.map((r) => r.accuracy), ROLLING);
  const accuracyLines: LineSeries[] = [
    {
      name: "Game",
      color: SERIES_COLORS[0],
      dots: true,
      faint: true,
      points: withAcc.map((r) => ({ t: r.t, y: r.accuracy!, id: r.id, label: `vs ${r.opponent} · ${r.result ?? ""}` })),
    },
    { name: `${ROLLING}-game average`, color: SERIES_COLORS[0], points: withAcc.map((r, i) => ({ t: r.t, y: rolling[i]! })) },
  ];

  const blunderBars = buckets(current, days, now).map((b) => ({
    key: String(b.start),
    label: days <= 31 ? fmtDate(b.start) : `Week of ${fmtDate(b.start)}`,
    value: b.perGame,
    detail: b.games ? `${b.games} game${b.games === 1 ? "" : "s"} · ${b.mistakes} mistakes` : undefined,
  }));

  const kittu = kittuTake(cur.accuracy, prev.accuracy, cur.games);

  return (
    <div className="mx-auto max-w-[1100px] p-3 lg:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">
          Progress <span className="text-muted">· {username}</span>
        </h1>
        <StatsBar />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-panel p-1" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setDays(r)}
              aria-pressed={days === r}
              className={`rounded-md px-3 py-1.5 text-sm font-bold ${days === r ? "bg-[#3c3a37] text-white" : "text-muted hover:text-white"}`}
            >
              {r === 365 ? "1 year" : `${r} days`}
            </button>
          ))}
        </div>
        <div className="ml-auto flex rounded-lg bg-panel p-1" role="group" aria-label="View">
          {(
            [
              ["charts", BarChart3, "Charts"],
              ["table", Table2, "Table"],
            ] as const
          ).map(([v, Icon, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-bold ${view === v ? "bg-[#3c3a37] text-white" : "text-muted hover:text-white"}`}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg bg-[#3a1d1a] p-3 text-sm text-[#ff9b8f]">Couldn&apos;t load your games: {error}</div>}
      {rows === null && !error && <div className="card p-6 text-muted">Loading your reviewed games…</div>}

      {rows !== null && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Reviewed games" value={String(cur.games)} sub={cur.games ? `${cur.results.win}W · ${cur.results.loss}L · ${cur.results.draw}D` : "none yet"} />
            <Tile
              label="Accuracy"
              value={cur.accuracy == null ? "–" : cur.accuracy.toFixed(1)}
              delta={cur.accuracy != null && prev.accuracy != null ? cur.accuracy - prev.accuracy : null}
              sub="vs previous period"
            />
            <Tile
              label={main ? `${cap(main.timeClass)} rating` : "Rating"}
              value={main ? String(main.points[main.points.length - 1].rating) : "–"}
              delta={ratingDelta}
              digits={0}
              sub="change in range"
            />
            <Tile
              label="Blunders / game"
              value={cur.blundersPerGame == null ? "–" : cur.blundersPerGame.toFixed(2)}
              delta={cur.blundersPerGame != null && prev.blundersPerGame != null ? cur.blundersPerGame - prev.blundersPerGame : null}
              lowerIsBetter
              digits={2}
              sub="vs previous period"
            />
          </div>

          {cur.games > 0 && (
            <div className="card mb-4 flex items-center gap-3 p-3">
              <Kittu mood={kittu.mood} size={56} />
              <p className="text-[15px] text-soft">{kittu.text}</p>
            </div>
          )}

          {rows.length === 0 ? (
            <div className="card p-6 text-soft">
              No reviewed games yet. Review a day on your{" "}
              <Link href={`/u/${encodeURIComponent(username)}`} className="font-bold text-brand-light hover:underline">
                dashboard
              </Link>{" "}
              and your numbers show up here.
            </div>
          ) : view === "charts" ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard title="Rating" note="One line per time control. Click a point to open that game.">
                {ratingLines.length > 1 && <Legend items={ratingLines.map((s) => ({ name: s.name, color: s.color }))} />}
                <LineChart series={ratingLines} onPick={openGame} ariaLabel="Rating over time by time control" />
              </ChartCard>
              <ChartCard title="Accuracy" note="Each reviewed game, with a rolling average.">
                <Legend
                  items={[
                    { name: "Game", color: SERIES_COLORS[0], dot: true },
                    { name: `${ROLLING}-game average`, color: SERIES_COLORS[0] },
                  ]}
                />
                <LineChart series={accuracyLines} yDomain={[Math.min(50, ...withAcc.map((r) => r.accuracy!)), 100]} yFormat={(v) => v.toFixed(0)} onPick={openGame} ariaLabel="Accuracy per game" />
              </ChartCard>
              <ChartCard title="Blunders per game" note={days <= 31 ? "Daily average." : "Weekly average."} wide>
                <BarChart data={blunderBars} color={SERIES_COLORS[0]} ariaLabel="Blunders per game over time" />
              </ChartCard>
            </div>
          ) : (
            <GameTable rows={[...current].reverse()} username={username} />
          )}
        </>
      )}

      <Training />
    </div>
  );
}

function kittuTake(acc: number | null, prevAcc: number | null, games: number): { mood: KittuMood; text: string } {
  if (acc == null || games === 0) return { mood: "neutral", text: "Play some games, then we'll talk." };
  if (prevAcc == null) return { mood: "thinking", text: `${acc.toFixed(1)} accuracy over ${games} games. Come back next period and I'll tell you if you improved.` };
  const d = acc - prevAcc;
  if (d >= 2) return { mood: "proud", text: `Accuracy up ${d.toFixed(1)} points. Don't let it go to your head. Okay, a little.` };
  if (d <= -2) return { mood: "unimpressed", text: `Accuracy down ${(-d).toFixed(1)} points. Tired? Tilted? Both? Do some puzzles.` };
  return { mood: "smug", text: "Holding steady. Steady is fine. Steady is also how you stay the same rating forever." };
}

function Tile({
  label,
  value,
  sub,
  delta,
  digits = 1,
  lowerIsBetter = false,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: number | null;
  digits?: number;
  lowerIsBetter?: boolean;
}) {
  const shown = delta != null && Math.abs(delta) >= 10 ** -digits / 2;
  const good = shown && (lowerIsBetter ? delta! < 0 : delta! > 0);
  return (
    <div className="card p-3">
      <div className="text-xs font-bold uppercase text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-extrabold text-white">{value}</span>
        {shown && (
          <span className={`flex items-center text-sm font-bold ${good ? "text-brand-light" : "text-[#ff7769]"}`}>
            {delta! > 0 ? <ArrowUpRight size={15} aria-hidden /> : <ArrowDownRight size={15} aria-hidden />}
            {delta! > 0 ? "+" : "−"}
            {Math.abs(delta!).toFixed(digits)}
            <span className="sr-only">{good ? " (better)" : " (worse)"}</span>
          </span>
        )}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

function ChartCard({ title, note, wide, children }: { title: string; note: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <section className={`card min-w-0 p-4 ${wide ? "lg:col-span-2" : ""}`}>
      <h2 className="text-lg font-extrabold">{title}</h2>
      <p className="mb-2 text-xs text-muted">{note}</p>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function GameTable({ rows, username }: { rows: HistoryRow[]; username: string }) {
  if (!rows.length) return <div className="card p-6 text-muted">No games in this range.</div>;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-muted">
          <tr>
            {["Date", "Opponent", "Type", "Result", "Rating", "Accuracy", "Blunders", "Mistakes"].map((h) => (
              <th key={h} className="px-3 py-2 font-bold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-line hover:bg-[#2b2a27]">
              <td className="px-3 py-2 text-soft">{fmtDate(r.t)}</td>
              <td className="px-3 py-2">
                <Link href={`/u/${encodeURIComponent(username)}/game/${encodeURIComponent(r.id)}`} className="font-bold text-white hover:underline">
                  {r.opponent || "?"}
                </Link>
              </td>
              <td className="px-3 py-2 text-soft">{cap(r.timeClass)}</td>
              <td className="px-3 py-2 text-soft">{r.result ? cap(r.result) : "–"}</td>
              <td className="px-3 py-2 tabular-nums text-soft">{r.rating ?? "–"}</td>
              <td className="px-3 py-2 tabular-nums text-white">{r.accuracy == null ? "–" : r.accuracy.toFixed(1)}</td>
              <td className="px-3 py-2 tabular-nums text-soft">{r.blunders}</td>
              <td className="px-3 py-2 tabular-nums text-soft">{r.mistakes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Course and endgame progress (this device + synced). */
function Training() {
  const p = useProgress();
  const tick = useNow();
  const now = tick || Date.now();
  const stars = ALL_DRILLS.reduce((n, d) => n + (p.drills[d.id]?.stars ?? 0), 0);
  return (
    <section className="mt-6">
      <h2 className="mb-3 text-xl font-extrabold">Training</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="card p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="font-extrabold">Opening courses</h3>
            <Link href="/courses" className="text-sm text-muted hover:text-white">
              All courses
            </Link>
          </div>
          <div className="flex flex-col gap-3">
            {COURSES.map((c) => {
              const s = courseSummary(p, c.id, lineIds(c), now);
              return (
                <Link key={c.id} href={`/courses/${c.id}`} className="group block">
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-bold text-soft group-hover:text-white">{c.name}</span>
                    <span className="text-muted">
                      {s.learned}/{s.total} learned · {s.mastered} mastered{s.due ? ` · ${s.due} due` : ""}
                    </span>
                  </div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-[#3c3a37]">
                    <div className="h-full bg-brand" style={{ width: `${(s.mastered / s.total) * 100}%` }} />
                    <div className="h-full bg-brand-dark" style={{ width: `${((s.learned - s.mastered) / s.total) * 100}%` }} />
                  </div>
                </Link>
              );
            })}
          </div>
          <div className="mt-3">
            <Legend
              items={[
                { name: "Mastered", color: "#81b64c" },
                { name: "Learning", color: "#45753c" },
              ]}
            />
          </div>
        </div>
        <div className="card p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="font-extrabold">Endgames</h3>
            <span className="text-sm text-muted">
              {stars}/{ALL_DRILLS.length * 3} stars
            </span>
          </div>
          <div className="flex flex-col gap-3">
            {STAGES.map((stage) => {
              const drills = stage.lessons.flatMap((l) => l.drills);
              const got = drills.reduce((n, d) => n + (p.drills[d.id]?.stars ?? 0), 0);
              const pct = drills.length ? got / (drills.length * 3) : 0;
              return (
                <Link key={stage.id} href="/endgames" className="group block">
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-bold text-soft group-hover:text-white">{stage.title}</span>
                    <span className="text-muted">
                      {got}/{drills.length * 3} ★
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[#3c3a37]">
                    <div className="h-full bg-brand" style={{ width: `${pct * 100}%` }} />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
