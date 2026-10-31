"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { StatsBar } from "@/components/StatsBar";
import { COURSES, lineIds, type Course } from "@/lib/courses";
import { ACHIEVEMENTS, courseSummary } from "@/lib/progress";
import { useNow, useProgress } from "@/lib/useProgress";

export default function CoursesPage() {
  const p = useProgress();
  const now = useNow() || Date.now();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = COURSES.filter((c) => !q || `${c.name} ${c.description}`.toLowerCase().includes(q));

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold">Opening Courses</h1>
          <p className="text-soft">Learn every line, then lock it in with spaced repetition.</p>
        </div>
        <StatsBar />
      </div>

      {COURSES.length === 0 ? (
        <div className="card mt-8 p-6 text-soft">
          <h2 className="text-lg font-extrabold text-white">No courses imported yet</h2>
          <p className="mt-2">
            Courses come from your course database and stay on this machine. Import them with{" "}
            <code className="rounded bg-panel2 px-1.5">python courses/import_db.py path/to/chess.db</code>, then restart the app.
          </p>
        </div>
      ) : (
        <label className="relative mt-6 block">
          <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input w-full pl-10" placeholder={`Search ${COURSES.length} courses`} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      )}

      {(["white", "black"] as const).filter((color) => shown.some((c) => c.color === color)).map((color) => (
        <section key={color} className="mt-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-muted">
            <span className={`h-3 w-3 rounded-sm ${color === "white" ? "bg-white" : "bg-[#1a1a1a] ring-1 ring-[#666]"}`} />
            Repertoire for {color} · {shown.filter((c) => c.color === color).length}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shown.filter((c) => c.color === color).map((c) => (
              <CourseCard key={c.id} course={c} summary={courseSummary(p, c.id, lineIds(c), now)} />
            ))}
          </div>
        </section>
      ))}

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-muted">Achievements</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {ACHIEVEMENTS.map((a) => {
            const got = p.achievements.includes(a.id);
            return (
              <div key={a.id} className={`card flex flex-col items-center p-4 text-center ${got ? "" : "opacity-40 grayscale"}`}>
                <span className="text-3xl">{a.icon}</span>
                <span className="mt-1 text-sm font-extrabold">{a.title}</span>
                <span className="text-xs text-muted">{a.text}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function CourseCard({ course, summary }: { course: Course; summary: ReturnType<typeof courseSummary> }) {
  const R = 26;
  const C = 2 * Math.PI * R;
  return (
    <Link href={`/courses/${course.id}`} className="card group flex flex-col p-5 transition hover:-translate-y-0.5 hover:bg-[#2d2b28]">
      <div className="flex items-start gap-4">
        <svg width="64" height="64" viewBox="0 0 64 64" className="shrink-0 -rotate-90">
          <circle cx="32" cy="32" r={R} fill="none" stroke="#3c3a37" strokeWidth="7" />
          <circle cx="32" cy="32" r={R} fill="none" stroke="#81b64c" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(summary.learned / summary.total) * C} ${C}`} />
          <circle cx="32" cy="32" r={R} fill="none" stroke="#f7c631" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(summary.mastered / summary.total) * C} ${C}`} />
          <text x="32" y="37" textAnchor="middle" fill="#fff" fontSize="15" fontWeight="800" transform="rotate(90 32 32)">
            {summary.percent}%
          </text>
        </svg>
        <div className="min-w-0">
          <h3 className="text-lg font-extrabold leading-tight group-hover:text-brand-light">{course.name}</h3>
          <p className="mt-1 line-clamp-3 text-sm text-soft">{course.tagline}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-xs font-bold text-muted">
        <span>{course.stats.chapters} chapters</span>
        <span>{course.stats.lines} lines</span>
        <span className="text-brand-light">{summary.learned} learned</span>
        <span className="text-[#f7d55f]">{summary.mastered} mastered</span>
        {summary.due > 0 && <span className="text-[#ffa459]">{summary.due} due</span>}
      </div>
    </Link>
  );
}
