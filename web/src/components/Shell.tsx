"use client";

import { BookOpen, Bot, Crown, Home, LineChart, Puzzle, Swords, TrendingUp, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { getHealth, type Health } from "@/lib/api";
import { isMuted, setMuted } from "@/lib/sounds";
import { useRememberedUser } from "@/lib/user";

export function Shell({ children }: { children: React.ReactNode }) {
  const user = useRememberedUser();
  const path = usePathname();
  const [health, setHealth] = useState<Health | null | undefined>(undefined);
  const [muted, setMutedState] = useState(false);

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

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <nav className="flex shrink-0 items-center gap-1 overflow-x-auto bg-side px-2 py-2 md:sticky md:top-0 md:h-screen md:w-[150px] md:flex-col md:items-stretch md:px-0 md:py-3">
        <Link href="/" className="mb-0 px-3 py-1 md:mb-3">
          <Logo />
        </Link>
        {links.map(({ href, label, icon: Icon, needsUser }) => {
          const active =
            label === "Home" ? path === "/" : label === "Review" ? path === href || path.includes("/game/") : href !== "/" && path.startsWith(href);
          const disabled = needsUser && !user;
          return (
            <Link
              key={label}
              href={href}
              aria-disabled={disabled}
              title={disabled ? "Enter your chess.com username first" : label}
              className={`flex items-center gap-2.5 whitespace-nowrap rounded px-3 py-2 text-[15px] font-bold md:rounded-none ${
                active ? "bg-[#1d1c1a] text-white" : "text-soft hover:bg-[#1d1c1a] hover:text-white"
              } ${disabled ? "opacity-40" : ""}`}
            >
              <Icon size={20} />
              <span className="hidden sm:inline">{label}</span>
            </Link>
          );
        })}
        <div className="ml-auto flex items-center gap-2 px-3 md:ml-0 md:mt-auto md:flex-col md:items-start">
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
          {health !== undefined && (
            <span
              className="hidden text-[11px] leading-tight text-muted md:block"
              title={health ? `graph: ${health.graph}, llm: ${health.llm}` : "No backend: reviews run in your browser"}
            >
              <span className={`mr-1 inline-block h-2 w-2 rounded-full ${health ? "bg-brand" : "bg-[#f7c631]"}`} />
              {health ? `Backend · ${health.llm === "none" ? "no AI" : health.llm}` : "Browser mode"}
            </span>
          )}
        </div>
      </nav>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
