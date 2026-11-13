import Link from "next/link";
import { PlayerLink, Table, ago, fmt, td } from "@/components/admin/ui";
import { players } from "@/lib/server/adminData";

const COLS: { key: string; label: string }[] = [
  { key: "games", label: "Games" },
  { key: "accuracy", label: "Accuracy" },
  { key: "game_rating", label: "Game Rating" },
  { key: "rating", label: "Rating" },
  { key: "xp", label: "XP" },
  { key: "puzzles", label: "Puzzles solved" },
  { key: "active", label: "Last active" },
];

export default async function AdminPlayers({ searchParams }: { searchParams: { sort?: string; q?: string } }) {
  const sort = COLS.some((c) => c.key === searchParams.sort) ? searchParams.sort! : "active";
  const rows = await players({ sort, q: searchParams.q, limit: 500 });
  const href = (s: string) => `/admin/players?${new URLSearchParams({ sort: s, ...(searchParams.q ? { q: searchParams.q } : {}) })}`;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">Players <span className="text-base font-bold text-muted">{rows.length}</span></h1>
        <form className="flex gap-2">
          <input name="q" defaultValue={searchParams.q} placeholder="Search username" className="input w-56 py-1.5" />
          <input type="hidden" name="sort" value={sort} />
          <button className="btn-secondary">Search</button>
        </form>
      </div>
      <div className="mt-4">
        <Table
          head={[
            "Player",
            ...COLS.map((c) => (
              <Link key={c.key} href={href(c.key)} className={sort === c.key ? "text-brand-light" : "hover:text-white"}>
                {c.label}
                {sort === c.key ? " ↓" : ""}
              </Link>
            )),
            "W",
            "Blunders/game",
            "Days",
          ]}
        >
          {rows.map((p) => (
            <tr key={p.username}>
              <td className={td}><PlayerLink name={p.username} /></td>
              <td className={td}>{p.games}</td>
              <td className={td}>{fmt(p.accuracy, 1)}</td>
              <td className={td}>{fmt(p.game_rating)}</td>
              <td className={td}>{fmt(p.rating)}</td>
              <td className={td}>{fmt(p.xp)}</td>
              <td className={td}>{p.solved}/{p.puzzles}</td>
              <td className={td} title={p.last_active ?? ""}>{ago(p.last_active)}</td>
              <td className={td}>{p.wins}</td>
              <td className={td}>{fmt(p.blunders_per_game, 2)}</td>
              <td className={td}>{p.days}</td>
            </tr>
          ))}
        </Table>
      </div>
    </>
  );
}
