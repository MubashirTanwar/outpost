import { Bars, PlayerLink, Section, Stat, Table, fmt, td } from "@/components/admin/ui";
import { overview, players } from "@/lib/server/adminData";

export default async function AdminOverview() {
  const [o, top] = await Promise.all([overview(), players({ sort: "games", limit: 8 })]);
  const t = o.totals;
  const solveRate = Number(t.attempts) ? Math.round((Number(t.solved) / Number(t.puzzles || 1)) * 100) : null;
  return (
    <>
      <h1 className="text-2xl font-extrabold">Overview</h1>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Players" value={fmt(Number(t.players))} sub={`${o.active.d1} today · ${o.active.d7} this week · ${o.active.d30} this month`} />
        <Stat label="Games reviewed" value={fmt(Number(t.reviews))} sub={`${t.reviews_24h} in 24h · ${t.reviews_7d} in 7 days`} />
        <Stat label="Average accuracy" value={t.avg_accuracy ?? "–"} sub="reviewing player's side" />
        <Stat label="Puzzles" value={fmt(Number(t.puzzles))} sub={`${fmt(Number(t.solved))} solved${solveRate !== null ? ` (${solveRate}%)` : ""} · ${fmt(Number(t.attempts))} attempts`} />
        <Stat label="Course XP earned" value={fmt(Number(t.xp))} />
        <Stat label="Days reviewed" value={fmt(Number(t.days))} />
        <Stat label="Pasted games" value={fmt(Number(t.pasted))} />
        <Stat label="Database size" value={String(t.db_size ?? "–")} />
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <Bars label="Games reviewed per day (30 days)" data={o.perDay.map((d) => ({ x: d.day.slice(5), y: d.reviews }))} />
        <Bars label="Players reviewing per day (30 days)" data={o.perDay.map((d) => ({ x: d.day.slice(5), y: d.players }))} />
      </div>

      <div className="grid gap-x-6 md:grid-cols-2">
        <Section title="Time controls">
          <Table head={["Time control", "Games", "Avg accuracy"]}>
            {o.timeClasses.map((r) => (
              <tr key={r.time_class}>
                <td className={td}>{r.time_class}</td>
                <td className={td}>{fmt(r.games)}</td>
                <td className={td}>{fmt(r.accuracy, 1)}</td>
              </tr>
            ))}
          </Table>
        </Section>
        <Section title="Top openings">
          <Table head={["Opening", "Games", "Avg accuracy"]}>
            {o.openings.map((r) => (
              <tr key={r.opening}>
                <td className={`${td} max-w-[260px] truncate`}>{r.opening}</td>
                <td className={td}>{fmt(r.games)}</td>
                <td className={td}>{fmt(r.accuracy, 1)}</td>
              </tr>
            ))}
          </Table>
        </Section>
      </div>

      <Section title="Most active players" right={<a href="/admin/players" className="text-sm font-bold text-brand-light hover:underline">All players</a>}>
        <Table head={["Player", "Games", "Accuracy", "Game Rating", "Rating", "XP", "Puzzles solved"]}>
          {top.map((p) => (
            <tr key={p.username}>
              <td className={td}><PlayerLink name={p.username} /></td>
              <td className={td}>{p.games}</td>
              <td className={td}>{fmt(p.accuracy, 1)}</td>
              <td className={td}>{fmt(p.game_rating)}</td>
              <td className={td}>{fmt(p.rating)}</td>
              <td className={td}>{fmt(p.xp)}</td>
              <td className={td}>{fmt(p.solved)}</td>
            </tr>
          ))}
        </Table>
      </Section>
    </>
  );
}
