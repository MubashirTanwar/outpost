import Link from "next/link";

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-bold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-extrabold tabular-nums text-white">{value ?? "–"}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted">{sub}</div> : null}
    </div>
  );
}

export function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-lg font-extrabold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function PlayerLink({ name }: { name: string | null | undefined }) {
  if (!name) return <span className="text-muted">–</span>;
  return (
    <Link href={`/admin/players/${encodeURIComponent(name.toLowerCase())}`} className="font-bold text-brand-light hover:underline">
      {name}
    </Link>
  );
}

export function GameLink({ user, id, children }: { user: string | null | undefined; id: string; children: React.ReactNode }) {
  if (!user) return <>{children}</>;
  return (
    <Link href={`/u/${encodeURIComponent(user)}/game/${encodeURIComponent(id)}`} className="hover:underline" target="_blank">
      {children}
    </Link>
  );
}

/** One series of vertical bars (e.g. reviews per day); each bar has a tooltip with its value. */
export function Bars({ data, label }: { data: { x: string; y: number }[]; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.y));
  const w = 100 / Math.max(1, data.length);
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-baseline justify-between text-xs text-muted">
        <span className="font-bold text-soft">{label}</span>
        <span>max {max}</span>
      </div>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-36 w-full" role="img" aria-label={label}>
        <line x1="0" y1="40" x2="100" y2="40" stroke="#3c3a37" strokeWidth="0.3" />
        {data.map((d, i) => {
          const h = (d.y / max) * 38;
          return (
            <g key={d.x}>
              <title>{`${d.x}: ${d.y}`}</title>
              <rect x={i * w + w * 0.15} y={0} width={w * 0.7} height={40} fill="transparent" />
              {d.y > 0 && <rect x={i * w + w * 0.15} y={40 - h} width={w * 0.7} height={h} rx={0.6} fill="#81b64c" />}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>{data[0]?.x}</span>
        <span>{data[data.length - 1]?.x}</span>
      </div>
    </div>
  );
}

export function Table({ head, children }: { head: React.ReactNode[]; children: React.ReactNode }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-3 py-2 font-bold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/60">{children}</tbody>
      </table>
    </div>
  );
}

export const td = "whitespace-nowrap px-3 py-2 tabular-nums";

export function ago(iso: string | null | undefined): string {
  if (!iso) return "–";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}

export const fmt = (n: number | null | undefined, digits = 0) => (n == null ? "–" : Number(n).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }));
