import type { Metadata } from "next";
import Link from "next/link";
import { SignOut } from "@/components/admin/SignOut";
import { isAdmin } from "@/lib/server/auth";
import { dbEnabled } from "@/lib/server/db";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/history", label: "History" },
  { href: "/admin/players", label: "Players" },
  { href: "/admin/records", label: "Records" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // The login page renders without the panel (middleware sends everyone else there).
  if (!(await isAdmin())) return <div className="min-h-screen bg-page">{children}</div>;
  return (
    <div className="min-h-screen bg-page">
      <header className="sticky top-0 z-20 border-b border-line bg-side/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
          <Link href="/admin" className="text-lg font-extrabold">
            Outpost <span className="text-brand-light">admin</span>
          </Link>
          <nav className="flex flex-wrap gap-1 text-sm font-bold">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="rounded-md px-2.5 py-1.5 text-soft hover:bg-[#1d1c1a] hover:text-white">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <Link href="/" className="text-sm text-muted hover:text-white">
              Open app
            </Link>
            <SignOut />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {dbEnabled() ? (
          children
        ) : (
          <p className="card p-4 text-sm text-soft">
            No database: set <code className="text-white">DATABASE_URL</code> on the server to see stats.
          </p>
        )}
      </main>
    </div>
  );
}
