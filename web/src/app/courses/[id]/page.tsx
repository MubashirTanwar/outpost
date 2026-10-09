"use client";

import { BookOpen, Check, ChevronDown, Clock, Crown, Dumbbell, Lock, Play, RotateCcw, Shuffle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useMemo, useState } from "react";
import { StatsBar } from "@/components/StatsBar";
import { allLines, countLearnerMoves, getCourse, lineIds, type Chapter, type Course, type CourseLine } from "@/lib/courses";
import { MASTERED_STAGE, courseSummary, isDue, lineKey, lineStatus, type LineProgress, type Progress } from "@/lib/progress";
import { useNow, useProgress } from "@/lib/useProgress";

// Duolingo-style zig-zag.
const OFFSETS = [0, 44, 72, 44, 0, -44, -72, -44];

function unlocked(course: Course, chapter: Chapter, index: number, p: Progress): boolean {
  if (index === 0) return true;
  return (p.lines[lineKey(course.id, chapter.lines[index - 1].id)]?.stage ?? 0) > 0;
}

function relTime(ms: number): string {
  const h = ms / 3600_000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (h < 36) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}

export default function CoursePage({ params }: { params: { id: string } }) {
  const course = getCourse(params.id);
  const p = useProgress();
  const now = useNow() || Date.now();
  const [open, setOpen] = useState<string | null>(null);
  const [intro, setIntro] = useState<Record<string, boolean>>({});
  if (!course) notFound();

  const summary = courseSummary(p, course.id, lineIds(course), now);
  const next = useMemo(
    () =>
      allLines(course).find(({ chapter, line }) => {
        const idx = chapter.lines.indexOf(line);
        return (p.lines[lineKey(course.id, line.id)]?.stage ?? 0) === 0 && unlocked(course, chapter, idx, p);
      }),
    [course, p],
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/courses" className="text-sm text-muted hover:text-white">
          ← All courses
        </Link>
        <StatsBar />
      </div>

      <div className="card mt-4 p-5">
        <div className="text-xs font-extrabold uppercase tracking-wide text-muted">Repertoire for {course.color}</div>
        <h1 className="mt-1 text-3xl font-extrabold">{course.name}</h1>
        <p className="mt-2 text-soft">{course.description}</p>
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-[#3c3a37]">
          <div className="relative h-full">
            <div className="absolute inset-y-0 left-0 bg-brand transition-all" style={{ width: `${(summary.learned / summary.total) * 100}%` }} />
            <div className="absolute inset-y-0 left-0 bg-[#f7c631] transition-all" style={{ width: `${(summary.mastered / summary.total) * 100}%` }} />
          </div>
        </div>
        <div className="mt-1.5 flex justify-between text-xs font-bold text-muted">
          <span>
            {summary.learned}/{summary.total} lines learned · {summary.mastered} mastered
          </span>
          <span>{summary.percent}%</span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {next && (
            <Link href={`/courses/${course.id}/learn/${next.line.id}`} className="btn-primary">
              <Play size={20} fill="white" /> {summary.learned ? "Continue" : "Start course"}
            </Link>
          )}
          {summary.due > 0 && (
            <Link href={`/courses/review?course=${course.id}`} className="btn-secondary !bg-[#ffa459] !text-[#2b1a0a]">
              <Clock size={16} /> Review {summary.due} due
            </Link>
          )}
          <Link href={`/courses/review?course=${course.id}&shuffle=1`} className={`btn-secondary ${summary.learned ? "" : "pointer-events-none opacity-40"}`}>
            <Shuffle size={16} /> Drill shuffle
          </Link>
          <Link href={`/courses/${course.id}/quiz`} className="btn-secondary">
            <Dumbbell size={16} /> Quiz
          </Link>
        </div>
      </div>

      {course.chapters.map((chapter, ci) => (
        <section key={chapter.id} className="mt-8">
          <button
            className="flex w-full items-center gap-3 rounded-xl bg-brand px-5 py-4 text-left shadow-btn"
            onClick={() => setIntro((s) => ({ ...s, [chapter.id]: !s[chapter.id] }))}
          >
            <div className="flex-1">
              <div className="text-xs font-extrabold uppercase text-white/75">Chapter {ci + 1}</div>
              <div className="text-lg font-extrabold">{chapter.title}</div>
            </div>
            <BookOpen size={22} />
            <ChevronDown size={18} className={`transition ${intro[chapter.id] ? "rotate-180" : ""}`} />
          </button>
          {intro[chapter.id] && <p className="mt-2 rounded-lg bg-panel p-4 text-sm leading-relaxed text-soft">{chapter.intro}</p>}

          <div className="mt-6 flex flex-col items-center gap-5">
            {chapter.lines.map((line, i) => (
              <PathNode
                key={line.id}
                course={course}
                line={line}
                lp={p.lines[lineKey(course.id, line.id)]}
                locked={!unlocked(course, chapter, i, p)}
                isNext={next?.line.id === line.id}
                offset={OFFSETS[i % OFFSETS.length]}
                open={open === line.id}
                onToggle={() => setOpen(open === line.id ? null : line.id)}
                now={now}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function PathNode({
  course,
  line,
  lp,
  locked,
  isNext,
  offset,
  open,
  onToggle,
  now,
}: {
  course: Course;
  line: CourseLine;
  lp: LineProgress | undefined;
  locked: boolean;
  isNext: boolean;
  offset: number;
  open: boolean;
  onToggle: () => void;
  now: number;
}) {
  const status = lineStatus(lp);
  const due = isDue(lp, now);
  const color = status === "mastered" ? "#f7c631" : status === "learning" ? "#81b64c" : locked ? "#4b4847" : "#81b64c";
  const shadow = status === "mastered" ? "#b8901a" : status === "learning" || !locked ? "#45753c" : "#2b2926";
  const ring = lp ? Math.min(1, lp.stage / MASTERED_STAGE) : 0;
  const href = `/courses/${course.id}/learn/${line.id}`;

  return (
    <div className="relative flex flex-col items-center" style={{ transform: `translateX(${offset}px)` }}>
      {isNext && !open && (
        <div className="animate-bounce mb-1 rounded-lg border-2 border-line bg-panel px-3 py-1 text-xs font-extrabold text-brand-light">START</div>
      )}
      <button
        onClick={onToggle}
        aria-label={line.name}
        className="relative flex h-[72px] w-[72px] items-center justify-center rounded-full transition active:translate-y-1"
        style={{ background: color, boxShadow: `0 6px 0 0 ${shadow}` }}
      >
        {status === "learning" && (
          <svg className="absolute -inset-2 -rotate-90" viewBox="0 0 88 88">
            <circle cx="44" cy="44" r="41" fill="none" stroke="#3c3a37" strokeWidth="5" />
            <circle cx="44" cy="44" r="41" fill="none" stroke="#a3d160" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${ring * 257.6} 257.6`} />
          </svg>
        )}
        {status === "mastered" ? (
          <Crown size={32} fill="#fff6d5" className="text-white" />
        ) : status === "learning" ? (
          <Check size={34} strokeWidth={3.5} className="text-white" />
        ) : locked ? (
          <Lock size={28} className="text-[#7a7774]" />
        ) : (
          <Play size={30} fill="white" className="ml-1 text-white" />
        )}
        {due && (
          <span className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-[#ffa459] ring-2 ring-page">
            <Clock size={14} className="text-[#2b1a0a]" />
          </span>
        )}
      </button>
      <span className="mt-3 max-w-[180px] text-center text-xs font-bold text-soft">{line.name}</span>

      {open && (
        <div className="animate-pop absolute top-[110px] z-20 w-72 rounded-xl p-4 shadow-2xl" style={{ background: locked ? "#3c3a37" : color, color: locked ? "#bababa" : "#1f2a12" }}>
          <div className="font-extrabold">{line.name}</div>
          <div className="mt-1 text-sm font-semibold opacity-80">
            {countLearnerMoves(course, line)} moves to learn ·{" "}
            {status === "new"
              ? locked
                ? "finish the previous lesson to unlock"
                : "new"
              : due
                ? "review due now"
                : `next review in ${relTime(lp!.due - now)}`}
          </div>
          {!locked && (
            <div className="mt-3 flex gap-2">
              {status === "new" ? (
                <Link href={href} className="flex-1 rounded-lg bg-white px-3 py-2 text-center font-extrabold text-[#2b4a14] shadow">
                  Learn · +20 XP
                </Link>
              ) : (
                <>
                  <Link href={`${href}?mode=review`} className="flex-1 rounded-lg bg-white px-3 py-2 text-center font-extrabold text-[#2b4a14] shadow">
                    Review · +10 XP
                  </Link>
                  <Link href={href} className="flex items-center rounded-lg bg-black/20 px-3 py-2 font-bold text-white" title="Learn it again with hints">
                    <RotateCcw size={16} />
                  </Link>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
