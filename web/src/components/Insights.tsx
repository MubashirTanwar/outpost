"use client";

import { Brain, Clock, Crosshair, Flame, Swords, Trophy } from "lucide-react";
import Link from "next/link";
import {
  clockStats,
  conversion,
  openings,
  punishRate,
  ratingGap,
  tilt,
  type IGame,
  type Moment,
} from "@/lib/insights";

const GOOD = "text-brand-light";
const BAD = "text-[#ff8a7a]";

/** Six deeper looks at the selected range of reviewed games; every example links to its position. */
export function Insights({
  username,
  games,
}: {
  username: string;
  games: IGame[];
}) {
  if (games.length < 3) {
    return (
      <div className="card p-5 text-soft">
        Insights appear once you have a few reviewed games in this range.
      </div>
    );
  }
  const href = (m: { gameId: string; ply?: number }) =>
    `/u/${encodeURIComponent(username)}/game/${encodeURIComponent(m.gameId)}${m.ply ? `?ply=${m.ply}` : ""}`;
  const conv = conversion(games);
  const punish = punishRate(games);
  const t = tilt(games);
  const clock = clockStats(games);
  const ops = openings(games);
  const gap = ratingGap(games);
  const tiltDiff =
    t.afterLoss.accuracy != null && t.afterWin.accuracy != null
      ? t.afterLoss.accuracy - t.afterWin.accuracy
      : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
      <Card
        icon={<Trophy size={18} />}
        title="Converting winning positions"
        sub={`Games where you reached ${80}%+ winning chances`}
      >
        <Headline
          value={conv.rate}
          unit="%"
          good={conv.rate != null && conv.rate >= 75}
        >
          {conv.winning
            ? `won ${conv.converted} of ${conv.winning}`
            : "no winning positions yet"}
        </Headline>
        {conv.losing > 0 && (
          <p className="mt-1 text-sm text-soft">
            And you saved <b className="text-white">{conv.saved}</b> of{" "}
            {conv.losing} games where you were down to 20% or less.
          </p>
        )}
        <Moments
          title="Where the win slipped"
          moments={conv.thrown}
          href={href}
        />
      </Card>

      <Card
        icon={<Crosshair size={18} />}
        title="Punishing mistakes"
        sub="Your reply after the opponent's mistake or blunder"
      >
        <Headline
          value={punish.rate}
          unit="%"
          good={punish.rate != null && punish.rate >= 70}
        >
          {punish.chances
            ? `took ${punish.punished} of ${punish.chances} chances`
            : "no opponent mistakes yet"}
        </Headline>
        <Moments
          title="Chances you missed"
          moments={punish.missed}
          href={href}
        />
      </Card>

      <Card
        icon={<Flame size={18} />}
        title="Tilt"
        sub="Games played within an hour of the previous one count as one session"
      >
        {t.afterLoss.games + t.afterWin.games === 0 ? (
          <p className="text-sm text-soft">
            No back-to-back games in this range yet, so there&apos;s no tilt to
            measure.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {[t.afterLoss, t.afterWin].map((b) => (
              <div key={b.label} className="rounded-md bg-panel2 p-3">
                <div className="text-xs font-bold uppercase text-muted">
                  {b.label}
                </div>
                <div className="mt-1 text-2xl font-extrabold tabular-nums">
                  {b.accuracy ?? "–"}
                </div>
                <div className="text-xs text-muted">
                  accuracy · {b.games} games
                  {b.score != null ? ` · ${Math.round(b.score)}% score` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
        {tiltDiff != null && Math.abs(tiltDiff) >= 3 && (
          <p className="mt-2 text-sm text-soft">
            {tiltDiff < 0 ? (
              <>
                You play{" "}
                <b className={BAD}>
                  {Math.abs(tiltDiff).toFixed(1)} points worse
                </b>{" "}
                right after a loss. Take a short break before queueing again.
              </>
            ) : (
              <>
                You play{" "}
                <b className={GOOD}>{tiltDiff.toFixed(1)} points better</b>{" "}
                after a loss: losses sharpen you.
              </>
            )}
          </p>
        )}
        <Bars
          rows={t.bySlot.map((s) => ({
            label: s.label,
            value: s.accuracy,
            note: `${s.games} games`,
          }))}
          max={100}
          caption="Accuracy by game in a session"
        />
      </Card>

      <Card
        icon={<Clock size={18} />}
        title="The clock"
        sub="Mistakes and blunders per 100 of your moves"
      >
        <Bars
          rows={clock.bands.map((b) => ({
            label: b.label,
            value: b.per100,
            note: `${b.moves} moves`,
          }))}
          max={Math.max(10, ...clock.bands.map((b) => b.per100 ?? 0))}
          bad
        />
        {clock.fast.moves > 0 && clock.slow.per100 != null && (
          <p className="mt-2 text-sm text-soft">
            Moves played in under 2 seconds (after the opening):{" "}
            <b
              className={
                (clock.fast.per100 ?? 0) > clock.slow.per100 * 1.5
                  ? BAD
                  : "text-white"
              }
            >
              {clock.fast.per100}
            </b>{" "}
            per 100, vs <b className="text-white">{clock.slow.per100}</b> when
            you took your time.
          </p>
        )}
        {clock.lostOnTime > 0 && (
          <p className="mt-1 text-sm text-soft">
            Lost on time: <b className={BAD}>{clock.lostOnTime}</b> game
            {clock.lostOnTime === 1 ? "" : "s"}.
          </p>
        )}
        {clock.worst && (
          <Moments
            title="Worst time-trouble blunder"
            moments={[clock.worst]}
            href={href}
          />
        )}
      </Card>

      <Card
        icon={<Brain size={18} />}
        title="Your openings"
        sub="Score, accuracy, and your winning chances when the opening ends"
        wide
      >
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted">
                <th className="px-1 py-1.5 font-bold">Opening</th>
                <th className="px-1 py-1.5 text-right font-bold">Games</th>
                <th className="px-1 py-1.5 text-right font-bold">W-D-L</th>
                <th className="px-1 py-1.5 text-right font-bold">Score</th>
                <th className="px-1 py-1.5 text-right font-bold">Accuracy</th>
                <th className="px-1 py-1.5 text-right font-bold">
                  Out of opening
                </th>
              </tr>
            </thead>
            <tbody>
              {ops.map((o) => (
                <tr
                  key={`${o.color}${o.opening}`}
                  className="border-t border-line"
                >
                  <td className="max-w-[240px] px-1 py-2">
                    <span className="flex items-center gap-2">
                      <span
                        className={`h-3 w-3 shrink-0 rounded-sm ${o.color === "white" ? "bg-white" : "bg-[#1a1a1a] ring-1 ring-[#666]"}`}
                        title={`as ${o.color}`}
                      />
                      <span className="truncate font-semibold capitalize">
                        {o.opening}
                      </span>
                    </span>
                  </td>
                  <td className="px-1 py-2 text-right tabular-nums">
                    {o.games}
                  </td>
                  <td className="px-1 py-2 text-right tabular-nums text-soft">
                    {o.wins}-{o.draws}-{o.losses}
                  </td>
                  <td
                    className={`px-1 py-2 text-right font-bold tabular-nums ${o.score == null ? "" : o.score >= 55 ? GOOD : o.score < 45 ? BAD : ""}`}
                  >
                    {o.score == null ? "–" : `${Math.round(o.score)}%`}
                  </td>
                  <td className="px-1 py-2 text-right tabular-nums">
                    {o.accuracy ?? "–"}
                  </td>
                  <td
                    className={`px-1 py-2 text-right tabular-nums ${o.afterOpening == null ? "" : o.afterOpening >= 55 ? GOOD : o.afterOpening < 45 ? BAD : ""}`}
                  >
                    {o.afterOpening == null ? "–" : `${o.afterOpening}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        icon={<Swords size={18} />}
        title="Against stronger and weaker players"
        sub="Your score vs what the rating gap predicts"
        wide
      >
        <div className="space-y-2">
          {gap.bands.map((b) => (
            <div
              key={b.label}
              className="grid grid-cols-[104px_1fr_auto] items-center gap-3 text-sm"
            >
              <span className="text-soft">{b.label}</span>
              <div className="relative h-2.5 rounded-full bg-[#3c3a37]">
                {b.score != null && (
                  <div
                    className="h-full rounded-full bg-brand"
                    style={{ width: `${b.score}%` }}
                  />
                )}
                {b.expected != null && (
                  <div
                    className="absolute -top-1 h-[18px] w-0.5 rounded bg-white/80"
                    style={{ left: `${b.expected}%` }}
                    title={`Expected ${Math.round(b.expected)}%`}
                  />
                )}
              </div>
              <span className="whitespace-nowrap text-right tabular-nums text-muted">
                {b.games ? (
                  <>
                    <b className="text-white">{Math.round(b.score!)}%</b> ·{" "}
                    {b.games}
                  </>
                ) : (
                  "–"
                )}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">
          Green bar: your score. White tick: the score your ratings predict.
          Right: score · games.
        </p>
        {gap.overPerformance != null && (
          <p className="mt-2 text-sm text-soft">
            Overall you scored{" "}
            <b className={gap.overPerformance >= 0 ? GOOD : BAD}>
              {gap.overPerformance >= 0 ? "+" : ""}
              {gap.overPerformance} points
            </b>{" "}
            {gap.overPerformance >= 0 ? "more" : "less"} than the ratings
            predicted.
            {gap.upset && (
              <>
                {" "}
                Biggest upset:{" "}
                <Link
                  href={href({ gameId: gap.upset.gameId })}
                  className="font-bold text-brand-light hover:underline"
                >
                  beating {gap.upset.opponent} ({gap.upset.rating}, +
                  {gap.upset.gap})
                </Link>
                .
              </>
            )}
          </p>
        )}
      </Card>
    </div>
  );
}

function Card({
  icon,
  title,
  sub,
  wide,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`card min-w-0 p-4 ${wide ? "lg:col-span-2" : ""}`}>
      <h3 className="flex items-center gap-2 font-extrabold">
        <span className="text-brand-light">{icon}</span>
        {title}
      </h3>
      <p className="mb-3 text-xs text-muted">{sub}</p>
      {children}
    </section>
  );
}

function Headline({
  value,
  unit,
  good,
  children,
}: {
  value: number | null;
  unit: string;
  good: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span
        className={`text-4xl font-extrabold tabular-nums ${value == null ? "text-muted" : good ? GOOD : "text-white"}`}
      >
        {value == null ? "–" : `${value}${unit}`}
      </span>
      <span className="text-sm text-soft">{children}</span>
    </div>
  );
}

function Moments({
  title,
  moments,
  href,
}: {
  title: string;
  moments: Moment[];
  href: (m: Moment) => string;
}) {
  if (!moments.length) return null;
  return (
    <div className="mt-3">
      <div className="mb-1 text-xs font-bold uppercase text-muted">{title}</div>
      <ul className="space-y-1">
        {moments.slice(0, 3).map((m) => (
          <li key={`${m.gameId}-${m.ply}`}>
            <Link
              href={href(m)}
              className="flex items-center gap-2 rounded-md bg-panel2 px-2.5 py-1.5 text-sm hover:bg-[#363431]"
            >
              <b className="shrink-0 text-white">
                {m.moveNumber}
                {m.color === "white" ? "." : "..."} {m.san}
              </b>
              <span className="truncate text-soft">{m.detail}</span>
              <span className="ml-auto shrink-0 text-xs text-muted">
                vs {m.opponent}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Bars({
  rows,
  max,
  bad,
  caption,
}: {
  rows: { label: string; value: number | null; note: string }[];
  max: number;
  bad?: boolean;
  caption?: string;
}) {
  return (
    <div className="mt-3">
      {caption && (
        <div className="mb-1 text-xs font-bold uppercase text-muted">
          {caption}
        </div>
      )}
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div
            key={r.label}
            className="grid grid-cols-[104px_1fr_auto] items-center gap-3 text-sm"
          >
            <span className="text-soft">{r.label}</span>
            <div className="h-2.5 rounded-full bg-[#3c3a37]">
              {r.value != null && (
                <div
                  className={`h-full rounded-full ${bad ? "bg-[#ff8a7a]" : "bg-brand"}`}
                  style={{ width: `${Math.min(100, (100 * r.value) / max)}%` }}
                />
              )}
            </div>
            <span className="whitespace-nowrap text-right tabular-nums text-muted">
              <b className="text-white">{r.value ?? "–"}</b> · {r.note}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
