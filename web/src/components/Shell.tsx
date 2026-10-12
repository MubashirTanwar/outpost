"use client";

import { BookOpen, Bot, Crown, Home, LineChart, Menu, Puzzle, Swords, TrendingUp, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { getHealth, type Health } from "@/lib/api";
import { isMuted, setMuted } from "@/lib/sounds";
import { useRememberedUser } from "@/lib/user";

/** Bottom tabs on phones; everything else sits under "More". */
const MOBILE_TABS = ["Review", "Puzzles", "Coach", "Courses"];

export function Shell({ children }: { children: React.ReactNode }) {
  const user = useRememberedUser();
  const path = usePathname();
  const [health, setHealth] = useState<Health | null | undefined>(undefined);
  const [muted, setMutedState] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    getHealth().then(setHealth);
    setMutedState(isMuted());
  }, []);

  const u = user ? `/u/${encodeURIComponent(user)}` : null;
  const links = [
    { href: "/", label: "Home", icon: Home },
    { href: u ?? "/", label: "Review", icon: LineChart, needsUser: true },
    { href: u ? `${u}/puzzles` : "/", label: "Puzzles", icon: Puzzle, needsUser: true },
    { href: u ? `${u}/progress` : "/", label: "Progress", icon: TrendingUp, needsUser: true },
    { href: "/courses", label: "Courses", icon: BookOpen },
    { href: "/endgames", label: "Endgames", icon: Crown },
    { href: "/analysis", label: "Analysis", icon: Swords },
    { href: u ? `${u}/coach` : "/", label: "Coach", icon: Bot, needsUser: true },
  ];

  const isActive = (label: string, href: string) =>
    label === "Home" ? path === "/" : label === "Review" ? path === href || path.includes("/game/") : href !== "/" && path.startsWith(href);
  const navClass = (active: boolean, disabled?: boolean) =>
    `${active ? "bg-[#1d1c1a] text-white" : "text-soft hover:bg-[#1d1c1a] hover:text-white"} ${disabled ? "opacity-40" : ""}`;
  const muteButton = (
    <button
      onClick={() => {
        setMuted(!muted);
        setMutedState(!muted);
      }}
      className="flex items-center gap-2 text-sm text-muted hover:text-white"
      aria-label={muted ? "Unmute sounds" : "Mute sounds"}
    >
      {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
      <span className="hidden md:inline">{muted ? "Muted" : "Sound on"}</span>
    </button>
  );
  const status = health !== undefined && (
    <span
      className="text-[11px] leading-tight text-muted"
      title={health ? `graph: ${health.graph}, llm: ${health.llm}` : "No backend: reviews run in your browser"}
    >
      <span className={`mr-1 inline-block h-2 w-2 rounded-full ${health ? "bg-brand" : "bg-[#f7c631]"}`} />
      <span className="hidden md:inline">{health ? `Backend · ${health.llm === "none" ? "no AI" : health.llm}` : "Browser mode"}</span>
    </span>
  );
  const tabs = links.filter((l) => MOBILE_TABS.includes(l.label));
  const more = links.filter((l) => !MOBILE_TABS.includes(l.label));
  const moreActive = more.some((l) => isActive(l.label, l.href));

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Desktop: sidebar */}
      <nav className="sticky top-0 hidden h-screen w-[150px] shrink-0 flex-col bg-side py-3 md:flex">
        <Link href="/" className="mb-3 px-3 py-1">
          <Logo />
        </Link>
        {links.map(({ href, label, icon: Icon, needsUser }) => {
          const disabled = needsUser && !user;
          return (
            <Link
              key={label}
              href={href}
              aria-disabled={disabled}
              title={disabled ? "Enter your chess.com username first" : label}
              className={`flex items-center gap-2.5 whitespace-nowrap px-3 py-2 text-[15px] font-bold ${navClass(isActive(label, href), disabled)}`}
            >
              <Icon size={20} />
              {label}
            </Link>
          );
        })}
        <div className="mt-auto flex flex-col items-start gap-2 px-3">
          {muteButton}
          {status}
        </div>
      </nav>

      {/* Mobile: top bar */}
      <header className="sticky top-0 z-40 flex h-12 items-center justify-between border-b border-black/30 bg-side px-3 md:hidden">
        <Link href="/">
          <Logo />
        </Link>
        <div className="flex items-center gap-3">
          {status}
          {muteButton}
        </div>
      </header>

      <main className="min-w-0 flex-1 pb-[calc(60px+env(safe-area-inset-bottom))] md:pb-0">{children}</main>

      {/* Mobile: bottom tab bar */}
      {moreOpen && <button className="fixed inset-0 z-40 bg-black/40 md:hidden" aria-label="Close menu" onClick={() => setMoreOpen(false)} />}
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-black/30 bg-side pb-[env(safe-area-inset-bottom)] md:hidden">
        {moreOpen && (
          <div className="absolute bottom-full right-2 mb-2 flex w-48 flex-col overflow-hidden rounded-xl border border-line bg-[#1f1e1b] shadow-2xl">
            {more.map(({ href, label, icon: Icon, needsUser }) => {
              const disabled = needsUser && !user;
              return (
                <Link
                  key={label}
                  href={href}
                  aria-disabled={disabled}
                  onClick={() => setMoreOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 text-[15px] font-bold ${navClass(isActive(label, href), disabled)}`}
                >
                  <Icon size={20} />
                  {label}
                </Link>
              );
            })}
          </div>
        )}
        <div className="grid h-[60px] grid-cols-5">
          {tabs.map(({ href, label, icon: Icon, needsUser }) => {
            const active = isActive(label, href);
            const disabled = needsUser && !user;
            return (
              <Link
                key={label}
                href={href}
                aria-disabled={disabled}
                onClick={() => setMoreOpen(false)}
                className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold ${
                  active ? "text-brand-light" : "text-muted"
                } ${disabled ? "opacity-40" : ""}`}
              >
                <Icon size={22} />
                {label}
              </Link>
            );
          })}
          <button
            onClick={() => setMoreOpen(!moreOpen)}
            aria-expanded={moreOpen}
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold ${moreOpen || moreActive ? "text-brand-light" : "text-muted"}`}
          >
            <Menu size={22} />
            More
          </button>
        </div>
      </nav>
    </div>
  );
}
