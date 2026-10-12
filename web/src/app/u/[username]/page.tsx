"use client";

import { ChevronLeft, ChevronRight, Crown, BookOpen, Puzzle as PuzzleIcon, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Board } from "@/components/Board";
import { ClassificationIcon, CLS_LABELS } from "@/components/ClassificationIcon";
import { Kittu, kittuSays, type KittuMood } from "@/components/Kittu";
import { RefMarkdown } from "@/components/GameRefs";
import { Progress } from "@/components/Progress";
import { ClassificationTable } from "@/components/ReviewSummary";
import { api, getHealth } from "@/lib/api";
import { fetchDayGames, localDay, playerResult, tzOffset } from "@/lib/chesscom";
import { reviewDay } from "@/lib/client";
import { prettyMotif } from "@/lib/format";
import { playSound } from "@/lib/sounds";
import type { DayOverview, GameMeta, Profile } from "@/lib/types";
import { rememberUser } from "@/lib/user";

const RESULT_STYLE = { win: "bg-brand", loss: "bg-[#fa412d]", draw: "bg-[#989795]" } as const;

function shiftDay(day: string, delta: number) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return localDay(d);
}

function cacheKey(user: string, day: string) {
  return `cc-day:${user.toLowerCase()}:${day}`;
}

export default function Dashboard({ params }: { params: { username: string } }) {
  const username = decodeURIComponent(params.username);
  const [day, setDay] = useState(localDay());
  const [games, setGames] = useState<GameMeta[] | null>(null);
  const [gamesError, setGamesError] = useState<string | null>(null);
  const [overview, setOverview] = useState<DayOverview | null>(null);
  const [progress, setProgress] = useState<{ stage: string; value: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    rememberUser(username);
  }, [username]);

  useEffect(() => {
    getHealth().then((h) => h && api.profile(username).then(setProfile).catch(() => {}));
  }, [username, overview]);

  useEffect(() => {
    setGames(null);
    setGamesError(null);
    setError(null);
    setProgress(null);
    try {
      const cached = localStorage.getItem(cacheKey(username, day));
      setOverview(cached ? JSON.parse(cached) : null);
    } catch {
      setOverview(null);
    }
    let cancelled = false;
    fetchDayGames(username, day)
      // chess.com unreachable from the browser? Ask the backend instead.
      .catch(() => api.games(username, day, tzOffset(day)).then((d) => d.games))
      .then((g: GameMeta[]) => !cancelled && setGames(g))
      .catch((e) => !cancelled && setGamesError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [username, day]);

  // The running review, cancelled when the day changes or the page is left so a late result
  // never shows up under a different day.
  const runCtrl = useRef<AbortController | null>(null);
  useEffect(() => () => runCtrl.current?.abort(), [username, day]);

  const run = useCallback(async () => {
    runCtrl.current?.abort();
    const ctrl = new AbortController();
    runCtrl.current = ctrl;
    setError(null);
    setProgress({ stage: "Starting", value: 0 });
    try {
      const result = await reviewDay(username, day, (stage, value) => !ctrl.signal.aborted && setProgress({ stage, value }), ctrl.signal);
      try {
        localStorage.setItem(cacheKey(username, day), JSON.stringify(result));
      } catch {}
      if (ctrl.signal.aborted) return;
      setOverview(result);
      playSound("notify");
    } catch (e) {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!ctrl.signal.aborted) setProgress(null);
    }
  }, [username, day]);

  const s = overview?.summary;
  const today = localDay();

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-md bg-[#4b4847] text-2xl font-extrabold uppercase">
          {username[0]}
        </div>
        <div>
          <h1 className="text-2xl font-extrabold">{username}</h1>
          <a className="text-sm text-muted hover:text-white" href={`https://www.chess.com/member/${username}`} target="_blank" rel="noreferrer">
            chess.com profile ↗
          </a>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button className="btn-secondary px-2" onClick={() => setDay(shiftDay(day, -1))} aria-label="Previous day">
            <ChevronLeft size={18} />
          </button>
          <input type="date" className="input py-1.5" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} />
          <button className="btn-secondary px-2" onClick={() => setDay(shiftDay(day, 1))} disabled={day >= today} aria-label="Next day">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {/* Run card */}
          <div className="card p-5">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex-1">
                <h2 className="text-xl font-extrabold">Day Review</h2>
                <p className="text-sm text-soft">
                  {games === null
                    ? "Loading games…"
                    : `${games.length} game${games.length === 1 ? "" : "s"} on ${new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}`}
                </p>
              </div>
              <button className="btn-primary" onClick={run} disabled={!!progress || games?.length === 0}>
                <Sparkles size={20} /> {overview ? "Re-run review" : "Review my day"}
              </button>
            </div>
            {progress && (
              <div className="mt-4">
                <Progress stage={progress.stage} value={progress.value} />
              </div>
            )}
            {error && <p className="mt-3 text-sm text-[#fa412d]">{error}</p>}
            {gamesError && <p className="mt-3 text-sm text-[#fa412d]">Couldn&apos;t load games: {gamesError}</p>}
          </div>

          {/* Overview */}
          {s && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Games" value={s.games} />
                <Stat label="Record" value={`${s.wins}-${s.draws}-${s.losses}`} sub="W-D-L" />
                <Stat label="Accuracy" value={s.avg_accuracy?.toFixed(1) ?? "–"} accent />
                <Stat label="Blunders" value={s.counts.blunder} danger={s.counts.blunder > 0} />
              </div>

              {overview?.lesson && (
                <div className="card p-5">
                  <div className="mb-3 flex items-center gap-3 text-sm font-bold text-muted">
                    <Kittu mood={dayMood(s)} size={56} />
                    <div>
                      <div className="text-white">Kittu</div>
                      <div className="font-extrabold italic text-soft">“{kittuSays(dayMood(s), s.games)}”</div>
                    </div>
                    <span className="ml-auto rounded bg-[#3c3a37] px-2 py-0.5 text-[11px]">{overview.lesson_source}</span>
                  </div>
                  <RefMarkdown ctx={{ username, day, games: s.per_game, moments: s.worst_moments }}>{overview.lesson}</RefMarkdown>
                </div>
              )}

              {s.worst_moments.length > 0 && (
                <div className="card p-5">
                  <h3 className="mb-3 text-lg font-extrabold">Key moments</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {s.worst_moments.slice(0, 4).map((w) => (
                      <Link
                        key={`${w.game_id}-${w.ply}`}
                        href={`/u/${encodeURIComponent(username)}/game/${encodeURIComponent(w.game_id)}?ply=${w.ply}&day=${day}`}
                        className="group rounded-md bg-panel2 p-3 hover:bg-[#2d2b28]"
                      >
                        <div className="pointer-events-none">
                          <Board
                            id={`km-${w.game_id}-${w.ply}`}
                            fen={w.fen_before}
                            orientation={w.fen_before.split(" ")[1] === "w" ? "white" : "black"}
                            notation={false}
                          />
                        </div>
                        <div className="mt-2 flex items-center gap-2 text-sm">
                          <ClassificationIcon cls={w.classification} size={18} />
                          <span className="font-bold">
                            {w.move_number}. {w.san}
                          </span>
                          <span className="text-muted">best {w.best_san}</span>
                          <span className="ml-auto text-xs text-muted">vs {w.opponent}</span>
                        </div>
                        {w.motifs.filter((m) => !m.endsWith("_phase")).length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {w.motifs.filter((m) => !m.endsWith("_phase")).map((m) => (
                              <span key={m} className="rounded bg-[#3c3a37] px-1.5 py-0.5 text-[11px] text-soft">
                                {prettyMotif(m)}
                              </span>
                            ))}
                          </div>
                        )}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Games */}
          <div className="card overflow-hidden">
            <h3 className="border-b border-line px-5 py-3 font-extrabold">Games</h3>
            {games?.length === 0 && <p className="px-5 py-6 text-sm text-muted">No games on this day. Pick another date.</p>}
            {(games ?? []).map((g) => {
              const res = playerResult(g);
              const pg = s?.per_game.find((p) => p.id === g.id);
              const opp = g.player_color === "white" ? g.black : g.white;
              const oppRating = g.player_color === "white" ? g.black_rating : g.white_rating;
              return (
                <Link
                  key={g.id}
                  href={`/u/${encodeURIComponent(username)}/game/${encodeURIComponent(g.id)}?day=${day}`}
                  className="flex items-center gap-3 border-b border-line/60 px-5 py-3 last:border-0 hover:bg-[#2d2b28]"
                >
                  <span className={`h-3 w-3 rounded-sm ${g.player_color === "white" ? "bg-white" : "bg-[#1a1a1a] ring-1 ring-[#666]"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-bold">
                      {opp} <span className="font-normal text-muted">({oppRating ?? "?"})</span>
                    </div>
                    <div className="truncate text-xs text-muted">
                      {g.time_class} · {g.opening ?? g.eco ?? "Unknown opening"}
                    </div>
                  </div>
                  {pg && (
                    <div className="hidden items-center gap-2 text-xs sm:flex">
                      {(["brilliant", "great", "mistake", "blunder"] as const).map((c) =>
                        pg.counts[c] ? (
                          <span key={c} className="flex items-center gap-0.5" title={CLS_LABELS[c]}>
                            <ClassificationIcon cls={c} size={14} /> {pg.counts[c]}
                          </span>
                        ) : null,
                      )}
                      <span className="ml-1 rounded bg-[#403d39] px-2 py-0.5 font-bold">{pg.accuracy?.toFixed(1) ?? "–"}</span>
                    </div>
                  )}
                  <span className={`rounded px-2 py-0.5 text-xs font-extrabold uppercase ${RESULT_STYLE[res]}`}>{res}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Sidebar */}
        <aside className="space-y-5">
          {s && (
            <div className="card p-5">
              <h3 className="mb-3 font-extrabold">Move quality</h3>
              <ClassificationTable left={s.counts} />
            </div>
          )}
          {overview?.plan && (
            <div className="card p-5">
              <h3 className="mb-3 font-extrabold">Training plan</h3>
              <div className="space-y-2">
                {overview.plan.puzzles.length > 0 && (
                  <PlanLink href={`/u/${encodeURIComponent(username)}/puzzles?day=${day}`} icon={<PuzzleIcon size={18} />}>
                    Solve {overview.plan.puzzles.length} puzzle{overview.plan.puzzles.length === 1 ? "" : "s"} from today&apos;s mistakes
                  </PlanLink>
                )}
                {overview.plan.opening && (
                  <PlanLink
                    href={overview.plan.opening.course_id ? `/courses/${overview.plan.opening.course_id}` : "/courses"}
                    icon={<BookOpen size={18} />}
                  >
                    {overview.plan.opening.course_id ? `Study the ${overview.plan.opening.name} course` : `Review ${overview.plan.opening.name}`}
                  </PlanLink>
                )}
                {overview.plan.endgame && (
                  <PlanLink href={`/endgames/${overview.plan.endgame.id}`} icon={<Crown size={18} />}>
                    Endgame lesson: {overview.plan.endgame.title}
                  </PlanLink>
                )}
                {overview.plan.focus.map((f) => (
                  <div key={f.motif} className="rounded-md bg-panel2 p-3 text-sm">
                    <div className="font-bold">{f.title}</div>
                    <div className="mt-0.5 text-soft">{f.drill}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {overview?.plan?.repertoire && overview.plan.repertoire.length > 0 && (
            <div className="card p-5">
              <h3 className="mb-1 font-extrabold">Repertoire check</h3>
              <p className="mb-3 text-xs text-muted">Where today&apos;s games left your opening courses</p>
              <div className="space-y-2">
                {overview.plan.repertoire.map((n) => (
                  <Link
                    key={n.game_id}
                    href={n.line_id ? `/courses/${n.course_id}/learn/${n.line_id}?mode=review` : `/courses/${n.course_id}`}
                    className="block rounded-md bg-panel2 p-3 text-sm hover:bg-[#2d2b28]"
                  >
                    <div className="text-xs font-bold text-muted">
                      vs {n.opponent} · {n.course_name} · move {Math.ceil(n.ply / 2)}
                    </div>
                    {n.kind === "you_deviated" ? (
                      <div className="mt-0.5">
                        You played <b className="text-[#ffa459]">{n.played}</b>; the course plays <b className="text-brand-light">{n.expected}</b>.
                        <span className="text-muted"> Review “{n.line_name}”</span>
                      </div>
                    ) : (
                      <div className="mt-0.5">
                        Your opponent played <b>{n.played}</b>, which the course doesn&apos;t cover yet.
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}
          {overview && overview.patterns.today_motifs.length > 0 && (
            <div className="card p-5">
              <h3 className="mb-3 font-extrabold">Today&apos;s patterns</h3>
              <div className="flex flex-wrap gap-2">
                {overview.patterns.today_motifs.map((m) => (
                  <span key={m.motif} className={`rounded-full px-3 py-1 text-xs font-bold ${m.recurring ? "bg-[#fa412d]/20 text-[#ff8a7a]" : "bg-[#3c3a37] text-soft"}`}>
                    {prettyMotif(m.motif)} ×{m.count}
                    {m.recurring ? " · recurring" : ""}
                  </span>
                ))}
              </div>
            </div>
          )}
          {profile && profile.games_analyzed > 0 && (
            <div className="card p-5">
              <h3 className="mb-1 font-extrabold">All-time weaknesses</h3>
              <p className="mb-3 text-xs text-muted">From {profile.games_analyzed} analyzed games in your knowledge graph</p>
              {profile.motifs.slice(0, 5).map((m) => (
                <div key={m.motif} className="mb-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-semibold">{profile.motif_info[m.motif]?.title ?? prettyMotif(m.motif)}</span>
                    <span className="text-muted">{m.count}×</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded bg-[#3c3a37]">
                    <div className="h-full rounded bg-[#ffa459]" style={{ width: `${(m.count / profile.motifs[0].count) * 100}%` }} />
                  </div>
                </div>
              ))}
              {profile.recurring_positions.length > 0 && (
                <p className="mt-3 text-xs text-soft">
                  You went wrong in the same position {profile.recurring_positions[0].times} times. Best there:{" "}
                  <b>{profile.recurring_positions[0].best_san}</b>.
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Kittu's verdict on the whole day. */
function dayMood(s: NonNullable<DayOverview["summary"]>): KittuMood {
  if (s.counts.blunder >= 3) return "shocked";
  const acc = s.avg_accuracy ?? 0;
  if (acc >= 85) return "starry";
  if (acc >= 75) return "proud";
  if (acc >= 60) return "unimpressed";
  return "worried";
}

function Stat({ label, value, sub, accent, danger }: { label: string; value: React.ReactNode; sub?: string; accent?: boolean; danger?: boolean }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-bold uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-3xl font-extrabold ${accent ? "text-brand" : danger ? "text-[#fa412d]" : ""}`}>{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

function PlanLink({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-md bg-panel2 p-3 text-sm font-semibold hover:bg-[#2d2b28]">
      <span className="text-brand">{icon}</span>
      {children}
    </Link>
  );
}
