"use client";

import { Flame, Zap } from "lucide-react";
import Link from "next/link";
import { COURSES, lineIds } from "@/lib/courses";
import { courseSummary, dayKey, level, streak } from "@/lib/progress";
import { useNow, useProgress } from "@/lib/useProgress";

/** Duolingo-style header: streak, XP and level, daily goal, reviews due. */
export function StatsBar() {
  const p = useProgress();
  const now = useNow();
  const t = now || Date.now();
  const s = streak(p, t);
  const lv = level(p.xp);
  const today = p.days[dayKey(t)] ?? 0;
  const goal = Math.min(1, today / p.dailyGoal);
  const due = COURSES.reduce((n, c) => n + courseSummary(p, c.id, lineIds(c), t).due, 0);

  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <Pill title={`${s}-day streak`}>
        <Flame size={18} className={s > 0 ? "text-[#ff9600]" : "text-muted"} fill={s > 0 ? "#ff9600" : "none"} />
        <span className={s > 0 ? "text-[#ffb347]" : "text-muted"}>{s}</span>
      </Pill>
      <Pill title={`${p.xp} XP total`}>
        <Zap size={18} className="text-[#f7c631]" fill="#f7c631" />
        <span className="text-[#f7d55f]">{p.xp}</span>
      </Pill>
      <Pill title={`Level ${lv.level}: ${lv.into}/${lv.needed} XP to the next level`}>
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#749bbf] text-[11px] font-extrabold text-white">{lv.level}</span>
        <span className="h-1.5 w-12 overflow-hidden rounded-full bg-[#3c3a37]">
          <span className="block h-full bg-[#749bbf]" style={{ width: `${(lv.into / lv.needed) * 100}%` }} />
        </span>
      </Pill>
      <Pill title={`Daily goal: ${today}/${p.dailyGoal} XP`}>
        <svg width="20" height="20" viewBox="0 0 36 36" className="-rotate-90">
          <circle cx="18" cy="18" r="15" fill="none" stroke="#3c3a37" strokeWidth="5" />
          <circle cx="18" cy="18" r="15" fill="none" stroke="#81b64c" strokeWidth="5" strokeDasharray={`${goal * 94.2} 94.2`} strokeLinecap="round" />
        </svg>
        <span className={goal >= 1 ? "text-brand-light" : "text-soft"}>
          {today}/{p.dailyGoal}
        </span>
      </Pill>
      {due > 0 && (
        <Link href="/courses/review" className="flex items-center gap-1.5 rounded-full bg-[#ffa459] px-3 py-1.5 text-sm font-extrabold text-[#2b1a0a] hover:brightness-110">
          {due} review{due === 1 ? "" : "s"} due
        </Link>
      )}
    </div>
  );
}

function Pill({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <span title={title} className="flex items-center gap-1.5 rounded-full bg-panel px-3 py-1.5 text-sm font-extrabold">
      {children}
    </span>
  );
}
