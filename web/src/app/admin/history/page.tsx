import Link from "next/link";
import { GameLink, PlayerLink, Table, ago, td } from "@/components/admin/ui";
import { history, type Activity } from "@/lib/server/adminData";
import type { ReviewStats } from "@/lib/reviewStats";

const KINDS = ["all", "review", "day", "puzzle", "progress", "pasted"] as const;

function describe(a: Activity): React.ReactNode {
  const d = a.detail as Record<string, unknown>;
  switch (a.kind) {
    case "review": {
      const s = d.stats as ReviewStats | null;
      if (!s?.white) return `${d.white} vs ${d.black}`;
      const me = s[s.player_color];
      const opp = s[s.player_color === "white" ? "black" : "white"];
      return (
        <GameLink user={a.username} id={a.ref}>
          vs {opp.name} · {me.result || "?"} · {me.accuracy ?? "–"}% · Game Rating {me.game_rating ?? "–"}
          {s.time_class ? ` · ${s.time_class}` : ""}
        </GameLink>
      );
    }
    case "day":
      return `reviewed ${a.ref} (${d.games ?? 0} games)`;
    case "puzzle":
      return `${d.solved ? "solved" : "missed"} a ${d.theme ?? ""} puzzle (attempt ${d.attempts ?? 1})`;
    case "progress":
      return `course progress saved · ${d.xp ?? 0} XP`;
    case "pasted":
      return `pasted ${d.white} vs ${d.black}`;
  }
}

export default async function AdminHistory({ searchParams }: { searchParams: { before?: string; kind?: string; user?: string } }) {
  const kind = KINDS.includes(searchParams.kind as never) && searchParams.kind !== "all" ? searchParams.kind : undefined;
  const rows = await history({ before: searchParams.before, kind, username: searchParams.user, limit: 60 });
  const link = (k: string) => `/admin/history?${new URLSearchParams({ ...(k !== "all" ? { kind: k } : {}), ...(searchParams.user ? { user: searchParams.user } : {}) })}`;
  return (
    <>
      <h1 className="text-2xl font-extrabold">History{searchParams.user ? ` · ${searchParams.user}` : ""}</h1>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {KINDS.map((k) => (
          <Link key={k} href={link(k)} className={`rounded-md px-2.5 py-1 text-sm font-bold ${(kind ?? "all") === k ? "bg-brand text-white" : "bg-panel2 text-soft hover:text-white"}`}>
            {k}
          </Link>
        ))}
      </div>
      <div className="mt-4">
        <Table head={["When", "Player", "What", ""]}>
          {rows.map((a, i) => (
            <tr key={`${a.kind}-${a.ref}-${i}`}>
              <td className={td} title={a.at}>{ago(a.at)}</td>
              <td className={td}><PlayerLink name={a.username} /></td>
              <td className="px-3 py-2">{describe(a)}</td>
              <td className={`${td} text-xs uppercase text-muted`}>{a.kind}</td>
            </tr>
          ))}
        </Table>
        {rows.length === 0 && <p className="mt-3 text-sm text-muted">Nothing yet.</p>}
        {rows.length === 60 && (
          <Link href={`${link(kind ?? "all")}&before=${encodeURIComponent(rows[rows.length - 1].at)}`} className="btn-secondary mt-3">
            Older
          </Link>
        )}
      </div>
    </>
  );
}
