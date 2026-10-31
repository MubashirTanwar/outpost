"use client";

import { Check, ChevronDown, Clock, Crown, Dumbbell, Play, RotateCcw, Shuffle, Swords } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useMemo, useState } from "react";
import { StatsBar } from "@/components/StatsBar";
import { allLines, countLearnerMoves, getCourse, lineIds, studiesOf, type Chapter, type Course, type CourseLine } from "@/lib/courses";
import { MASTERED_STAGE, courseSummary, isDue, lineKey, lineStatus, type LineProgress, type Progress } from "@/lib/progress";
import { useNow, useProgress } from "@/lib/useProgress";

function relTime(ms: number): string {
  const h = ms / 3600_000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (h < 36) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}

function chapterSummary(course: Course, chapter: Chapter, p: Progress) {
  let learned = 0;
  let mastered = 0;
  for (const line of chapter.lines) {
    const status = lineStatus(p.lines[lineKey(course.id, line.id)]);
    if (status !== "new") learned++;
    if (status === "mastered") mastered++;
  }
  return { learned, mastered, total: chapter.lines.length };
}

/** Course -> chapters -> studies -> lines. Every line is open: learn them in any order. */
export default function CoursePage({ params }: { params: { id: string } }) {
  const course = getCourse(params.id);
  const p = useProgress();
  const now = useNow() || Date.now();
  if (!course) notFound();

  const summary = courseSummary(p, course.id, lineIds(course), now);
  const next = useMemo(() => allLines(course).find(({ line }) => (p.lines[lineKey(course.id, line.id)]?.stage ?? 0) === 0), [course, p]);
  // The chapter with the next new line starts open.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (ch: Chapter) => open[ch.id] ?? ch.id === (next?.chapter.id ?? course.chapters[0]?.id);

  return (
    <div className="mx-auto max-w-3xl px-3 py-5 sm:px-4 sm:py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/courses" className="text-sm text-muted hover:text-white">
          ← All courses
        </Link>
        <StatsBar />
      </div>

      <div className="card mt-4 p-5">
        <div className="text-xs font-extrabold uppercase tracking-wide text-muted">Repertoire for {course.color}</div>
        <h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">{course.name}</h1>
        {course.description && <p className="mt-2 text-soft">{course.description}</p>}
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs font-bold text-muted">
          <span>{course.stats.chapters} chapters</span>
          <span>{course.chapters.reduce((n, ch) => n + studiesOf(ch).length, 0)} studies</span>
          <span>{course.stats.lines} lines</span>
        </div>
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
          <Link href={`/courses/${course.id}/quiz`} className={`btn-secondary ${summary.learned ? "" : "pointer-events-none opacity-40"}`}>
            <Dumbbell size={16} /> Quiz
          </Link>
          <Link href={`/courses/${course.id}/practice`} className="btn-secondary">
            <Swords size={16} /> Practice vs Kittu
          </Link>
        </div>
      </div>

      {course.chapters.map((chapter, ci) => {
        const cs = chapterSummary(course, chapter, p);
        const expanded = isOpen(chapter);
        return (
          <section key={chapter.id} className="mt-4">
            <button
              className={`flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left sm:px-5 ${cs.learned === cs.total ? "bg-[#f7c631] text-[#2b1a0a]" : "bg-brand"} shadow-btn`}
              onClick={() => setOpen((o) => ({ ...o, [chapter.id]: !expanded }))}
              aria-expanded={expanded}
            >
              <div className="min-w-0 flex-1">
                <div className="text-xs font-extrabold uppercase opacity-75">
                  Chapter {ci + 1} · {cs.learned}/{cs.total} lines
                </div>
                <div className="text-base font-extrabold leading-snug sm:text-lg">{chapter.title.replace(/^Chapter \d+:\s*/i, "")}</div>
              </div>
              <ChevronDown size={20} className={`shrink-0 transition ${expanded ? "rotate-180" : ""}`} />
            </button>

            {expanded && (
              <div className="mt-3 space-y-3">
                {chapter.intro && <p className="rounded-lg bg-panel p-4 text-sm leading-relaxed text-soft">{chapter.intro}</p>}
                {studiesOf(chapter).map((study) => (
                  <div key={study.id} className="card overflow-hidden">
                    <h3 className="border-b border-line px-4 py-2.5 text-sm font-extrabold">{study.name}</h3>
                    <ul className="divide-y divide-line/60">
                      {study.lines.map((line) => (
                        <LineRow key={line.id} course={course} line={line} lp={p.lines[lineKey(course.id, line.id)]} isNext={next?.line.id === line.id} now={now} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function LineRow({ course, line, lp, isNext, now }: { course: Course; line: CourseLine; lp: LineProgress | undefined; isNext: boolean; now: number }) {
  const status = lineStatus(lp);
  const due = isDue(lp, now);
  const href = `/courses/${course.id}/learn/${line.id}`;
  const ring = lp ? Math.min(1, lp.stage / MASTERED_STAGE) : 0;
  return (
    <li className={`flex items-center gap-3 px-4 py-2.5 ${isNext ? "bg-brand/10" : ""}`}>
      <span
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
        style={{ background: status === "mastered" ? "#f7c631" : status === "learning" ? "#81b64c" : "#3c3a37" }}
        title={status === "mastered" ? "Mastered" : status === "learning" ? "Learning" : "New"}
      >
        {status === "learning" && (
          <svg className="absolute -inset-1 -rotate-90" viewBox="0 0 44 44">
            <circle cx="22" cy="22" r="20" fill="none" stroke="#a3d160" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${ring * 125.7} 125.7`} />
          </svg>
        )}
        {status === "mastered" ? <Crown size={18} fill="#fff6d5" className="text-white" /> : status === "learning" ? <Check size={18} strokeWidth={3.5} className="text-white" /> : <Play size={15} fill="#bababa" className="ml-0.5 text-[#bababa]" />}
        {due && <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-[#ffa459] ring-2 ring-panel" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold">{line.label ?? line.name}</div>
        <div className="text-xs text-muted">
          {countLearnerMoves(course, line)} moves
          {status !== "new" && <> · {due ? <span className="text-[#ffa459]">review due</span> : `review in ${relTime(lp!.due - now)}`}</>}
        </div>
      </div>
      {status === "new" ? (
        <Link href={href} className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-extrabold ${isNext ? "bg-brand text-white shadow-btn" : "bg-[#3c3a37] text-white hover:bg-[#4b4847]"}`}>
          Learn
        </Link>
      ) : (
        <div className="flex shrink-0 gap-1.5">
          <Link href={`${href}?mode=review`} className={`rounded-lg px-3 py-1.5 text-sm font-extrabold ${due ? "bg-[#ffa459] text-[#2b1a0a]" : "bg-[#3c3a37] text-white hover:bg-[#4b4847]"}`}>
            Review
          </Link>
          <Link href={href} className="rounded-lg bg-[#3c3a37] px-2 py-1.5 text-white hover:bg-[#4b4847]" title="Learn it again with hints" aria-label="Learn again">
            <RotateCcw size={16} />
          </Link>
        </div>
      )}
    </li>
  );
}
