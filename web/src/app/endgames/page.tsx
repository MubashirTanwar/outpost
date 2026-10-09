"use client";

import { Lock, Star } from "lucide-react";
import Link from "next/link";
import { Kittu } from "@/components/Kittu";
import { StatsBar } from "@/components/StatsBar";
import { ALL_DRILLS, STAGES, type EndgameLesson } from "@/lib/endgames";
import { useProgress } from "@/lib/useProgress";
import type { Progress } from "@/lib/progress";

const LEVEL_STYLE = {
  beginner: "bg-brand/25 text-brand-light",
  intermediate: "bg-[#749bbf]/25 text-[#a9c5e0]",
  advanced: "bg-[#fa412d]/20 text-[#ff8a7a]",
} as const;

function lessonStars(lesson: EndgameLesson, p: Progress) {
  const earned = lesson.drills.reduce((n, d) => n + (p.drills?.[d.id]?.stars ?? 0), 0);
  return { earned, total: lesson.drills.length * 3, done: lesson.drills.every((d) => (p.drills?.[d.id]?.stars ?? 0) > 0) };
}

export default function EndgamesPage() {
  const p = useProgress();
  const earned = ALL_DRILLS.reduce((n, d) => n + (p.drills?.[d.id]?.stars ?? 0), 0);
  const total = ALL_DRILLS.length * 3;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Kittu mood="proud" size={72} />
          <div>
            <h1 className="text-3xl font-extrabold">Endgame Academy</h1>
            <p className="text-soft">Theory first, then the variations, played against Stockfish.</p>
          </div>
        </div>
        <StatsBar />
      </div>

      <div className="card mt-5 p-4">
        <div className="flex justify-between text-sm font-bold">
          <span>Total stars</span>
          <span className="text-[#f7c631]">
            {earned} / {total} ★
          </span>
        </div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-[#3c3a37]">
          <div className="h-full rounded-full bg-[#f7c631] transition-all" style={{ width: `${(earned / total) * 100}%` }} />
        </div>
      </div>

      {STAGES.map((stage, si) => {
        // A stage opens once every lesson of the previous stage has at least one star.
        const prev = STAGES[si - 1];
        const locked = !!prev && !prev.lessons.every((l) => lessonStars(l, p).done);
        return (
          <section key={stage.id} className="mt-8">
            <div className={`rounded-xl px-5 py-4 ${locked ? "bg-[#3c3a37]" : "bg-brand shadow-btn"}`}>
              <div className="flex items-center gap-2 text-lg font-extrabold">
                {locked && <Lock size={18} />} {stage.title}
              </div>
              <p className={`mt-1 text-sm ${locked ? "text-muted" : "text-white/85"}`}>{stage.intro}</p>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {stage.lessons.map((lesson) => {
                const s = lessonStars(lesson, p);
                const body = (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-extrabold">{lesson.title}</h3>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${LEVEL_STYLE[lesson.level]}`}>{lesson.level}</span>
                    </div>
                    <p className="mt-1 text-sm text-soft">{lesson.summary}</p>
                    <div className="mt-3 flex items-center justify-between text-xs font-bold text-muted">
                      <span>
                        {lesson.theory.length} theory cards · {lesson.drills.length} drills
                      </span>
                      <span className={`flex items-center gap-1 ${s.earned ? "text-[#f7c631]" : ""}`}>
                        <Star size={14} fill={s.earned ? "#f7c631" : "none"} /> {s.earned}/{s.total}
                      </span>
                    </div>
                  </>
                );
                return locked ? (
                  <div key={lesson.id} className="card p-4 opacity-50" title="Finish the previous stage first">
                    {body}
                  </div>
                ) : (
                  <Link key={lesson.id} href={`/endgames/${lesson.id}`} className={`card p-4 transition hover:-translate-y-0.5 hover:bg-[#2d2b28] ${s.done ? "ring-2 ring-[#f7c631]/40" : ""}`}>
                    {body}
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
