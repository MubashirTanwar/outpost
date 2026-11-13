import { GameLink, PlayerLink, Section, Table, fmt, td } from "@/components/admin/ui";
import { records, type RecordRow } from "@/lib/server/adminData";

const BOARDS: { key: string; title: string; unit: string; digits?: number }[] = [
  { key: "accuracy", title: "Highest accuracy (30+ moves)", unit: "%", digits: 1 },
  { key: "overperf", title: "Biggest overperformance (Game Rating above rating)", unit: "" },
  { key: "brilliant", title: "Most brilliant moves in a game", unit: "" },
  { key: "blunder", title: "Biggest single blunder (winning chances lost)", unit: "%", digits: 1 },
  { key: "longest", title: "Longest game", unit: " plies" },
  { key: "mostGames", title: "Most games reviewed", unit: "" },
  { key: "xp", title: "Most course XP", unit: " XP" },
  { key: "solved", title: "Most puzzles solved", unit: "" },
  { key: "streak", title: "Longest training streak", unit: " days" },
];

function Board({ rows, unit, digits }: { rows: RecordRow[]; unit: string; digits?: number }) {
  if (!rows.length) return <p className="card p-4 text-sm text-muted">No data yet.</p>;
  return (
    <Table head={["#", "Player", "Value", ""]}>
      {rows.map((r, i) => (
        <tr key={i}>
          <td className={`${td} text-muted`}>{i + 1}</td>
          <td className={td}><PlayerLink name={r.username} /></td>
          <td className={`${td} font-bold text-white`}>
            {r.game_id ? <GameLink user={r.username} id={r.game_id}>{fmt(r.value, digits ?? 0)}{unit}</GameLink> : `${fmt(r.value, digits ?? 0)}${unit}`}
          </td>
          <td className="px-3 py-2 text-muted">{r.detail ?? ""}</td>
        </tr>
      ))}
    </Table>
  );
}

export default async function AdminRecords() {
  const all = await records();
  return (
    <>
      <h1 className="text-2xl font-extrabold">Records</h1>
      <div className="grid gap-x-6 lg:grid-cols-2">
        {BOARDS.map((b) => (
          <Section key={b.key} title={b.title}>
            <Board rows={all[b.key] ?? []} unit={b.unit} digits={b.digits} />
          </Section>
        ))}
      </div>
    </>
  );
}
