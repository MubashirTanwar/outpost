import Link from "next/link";
import { notFound } from "next/navigation";
import { Bars, GameLink, Section, Stat, Table, ago, fmt, td } from "@/components/admin/ui";
import { player } from "@/lib/server/adminData";

function streak(days: Record<string, number> | undefined): number {
  const keys = Object.keys(days ?? {}).sort();
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const k of keys) {
    const t = Date.parse(`${k}T00:00:00Z`);
    run = prev !== null && t - prev === 86400_000 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}

export default async function AdminPlayer({ params }: { params: { user: string } }) {
  const user = decodeURIComponent(params.user).toLowerCase();
  const d = await player(user);
  if (!d.summary && !d.games.length && !d.progress) notFound();
  const s = d.summary;
  const mine = d.games.filter((g) => g.stats?.white && g.stats.player === user);
  const trend = [...mine].reverse().slice(-40);
  const prog = d.progress;
  const learned = prog ? Object.keys(prog.lines ?? {}).length : 0;
  const drills = prog ? Object.keys(prog.drills ?? {}).length : 0;
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-extrabold">{user}</h1>
        <a href={`https://www.chess.com/member/${encodeURIComponent(user)}`} target="_blank" rel="noreferrer" className="text-sm text-muted hover:text-white">chess.com profile</a>
        <Link href={`/u/${encodeURIComponent(user)}`} target="_blank" className="text-sm text-muted hover:text-white">open in app</Link>
        <Link href={`/admin/history?user=${encodeURIComponent(user)}`} className="text-sm font-bold text-brand-light hover:underline">history</Link>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Games reviewed" value={s?.games ?? 0} sub={s ? `${s.wins} won · last active ${ago(s.last_active)}` : undefined} />
        <Stat label="Average accuracy" value={fmt(s?.accuracy, 1)} sub={`${fmt(s?.blunders_per_game, 2)} blunders per game`} />
        <Stat label="Game Rating (avg)" value={fmt(s?.game_rating)} sub={`rated ${fmt(s?.rating)} lately`} />
        <Stat label="Puzzles" value={`${s?.solved ?? 0}/${s?.puzzles ?? 0}`} sub="solved / from their games" />
        <Stat label="Course XP" value={fmt(prog?.xp ?? 0)} sub={`${learned} lines learned · ${drills} endgame drills`} />
        <Stat label="Best streak" value={`${streak(prog?.days)} days`} sub={`${Object.keys(prog?.days ?? {}).length} days with XP`} />
        <Stat label="Achievements" value={prog?.achievements?.length ?? 0} />
        <Stat label="Days reviewed" value={d.days.length} />
      </div>

      {trend.length > 1 && (
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          <Bars label={`Accuracy, last ${trend.length} games`} data={trend.map((g) => ({ x: new Date(g.end_time * 1000).toISOString().slice(5, 10), y: Math.round(g.stats![g.stats!.player_color].accuracy ?? 0) }))} />
          <Bars label={`Game Rating, last ${trend.length} games`} data={trend.map((g) => ({ x: new Date(g.end_time * 1000).toISOString().slice(5, 10), y: g.stats![g.stats!.player_color].game_rating ?? 0 }))} />
        </div>
      )}

      <Section title="Games">
        <Table head={["Played", "Opponent", "Side", "Result", "Accuracy", "Game Rating", "Rating", "Blunders", "Time", "Opening"]}>
          {d.games.map((g) => {
            const st = g.stats;
            if (!st?.white) {
              return (
                <tr key={g.game_id}>
                  <td className={td}>{new Date(g.end_time * 1000).toISOString().slice(0, 10)}</td>
                  <td className={td} colSpan={9}>{g.white} vs {g.black}</td>
                </tr>
              );
            }
            const color = st.player === user ? st.player_color : st.white.name.toLowerCase() === user ? "white" : "black";
            const me = st[color];
            const opp = st[color === "white" ? "black" : "white"];
            return (
              <tr key={g.game_id}>
                <td className={td}>
                  <GameLink user={user} id={g.game_id}>{new Date(g.end_time * 1000).toISOString().slice(0, 10)}</GameLink>
                </td>
                <td className={td}>{opp.name} <span className="text-muted">({fmt(opp.rating)})</span></td>
                <td className={td}>{color}</td>
                <td className={td}>{me.result || "–"}</td>
                <td className={td}>{fmt(me.accuracy, 1)}</td>
                <td className={td}>{fmt(me.game_rating)}</td>
                <td className={td}>{fmt(me.rating)}</td>
                <td className={td}>{me.blunders}</td>
                <td className={td}>{st.time_class || "–"}</td>
                <td className={`${td} max-w-[220px] truncate`}>{st.opening ?? st.eco ?? "–"}</td>
              </tr>
            );
          })}
        </Table>
      </Section>

      <div className="grid gap-x-6 md:grid-cols-2">
        <Section title="Puzzles by theme">
          <Table head={["Theme", "Puzzles", "Solved"]}>
            {d.puzzlesByTheme.map((p) => (
              <tr key={p.theme}>
                <td className={td}>{p.theme.replace(/_/g, " ")}</td>
                <td className={td}>{p.puzzles}</td>
                <td className={td}>{p.solved}</td>
              </tr>
            ))}
          </Table>
        </Section>
        <Section title="Days reviewed">
          <Table head={["Day", "Games", "Accuracy"]}>
            {d.days.map((x) => (
              <tr key={x.day}>
                <td className={td}>{x.day}</td>
                <td className={td}>{x.games ?? 0}</td>
                <td className={td}>{fmt(x.accuracy, 1)}</td>
              </tr>
            ))}
          </Table>
        </Section>
      </div>
      {prog?.achievements?.length ? (
        <Section title="Achievements">
          <div className="flex flex-wrap gap-1.5">
            {prog.achievements.map((a) => (
              <span key={a} className="rounded-md bg-panel2 px-2 py-1 text-xs font-bold text-soft">{a}</span>
            ))}
          </div>
        </Section>
      ) : null}
    </>
  );
}
