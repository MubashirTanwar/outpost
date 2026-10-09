"use client";

import { X, Zap } from "lucide-react";
import Link from "next/link";
import { notFound, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, useState } from "react";
import { Kittu, kittuSays } from "@/components/Kittu";
import { LinePlayer, type LineResult } from "@/components/LinePlayer";
import { allLines, findLine, getCourse, knownPositions } from "@/lib/courses";
import { INTERVALS_H, lineKey, recordLearned, recordReview } from "@/lib/progress";
import { updateProgress, useProgress } from "@/lib/useProgress";

function LessonPage({ params }: { params: { id: string; lineId: string } }) {
  const course = getCourse(params.id);
  const found = course ? findLine(course, params.lineId) : undefined;
  if (!course || !found) notFound();
  const router = useRouter();
  const search = useSearchParams();
  const p = useProgress();
  const key = lineKey(course.id, found.line.id);
  const alreadyLearned = (p.lines[key]?.stage ?? 0) > 0;
  const mode = search.get("mode") === "review" && alreadyLearned ? "review" : "learn";
  const [result, setResult] = useState<{ xp: number; mistakes: number } | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Snapshot of what's already known when the lesson starts (don't change mid-lesson).
  const known = useMemo(() => {
    const learned = new Set(
      allLines(course)
        .map((l) => l.line.id)
        .filter((id) => id !== found.line.id && (p.lines[lineKey(course.id, id)]?.stage ?? 0) > 0),
    );
    return knownPositions(course, learned);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course, found.line.id, attempt]);

  const onComplete = useCallback(
    ({ mistakes }: LineResult) => {
      let gained = 0;
      updateProgress((prev) => {
        const out = mode === "learn" && (prev.lines[key]?.stage ?? 0) === 0 ? recordLearned(prev, key, Date.now()) : recordReview(prev, key, mistakes, Date.now());
        gained = out.xp;
        return out.progress;
      });
      setResult({ xp: gained, mistakes });
    },
    [mode, key],
  );

  const lp = p.lines[key];
  const nextLine = useMemo(() => {
    const lines = allLines(course);
    const idx = lines.findIndex((l) => l.line.id === found.line.id);
    return lines.slice(idx + 1).find((l) => (p.lines[lineKey(course.id, l.line.id)]?.stage ?? 0) === 0);
  }, [course, found.line.id, p]);

  return (
    <div className="mx-auto max-w-[1100px] p-3 lg:p-6">
      <div className="mb-3 flex items-center gap-3">
        <Link href={`/courses/${course.id}`} className="text-muted hover:text-white" aria-label="Quit lesson">
          <X size={26} />
        </Link>
        <div className="text-sm font-bold text-muted">
          {course.name} · {found.chapter.title}
        </div>
      </div>

      {result ? (
        <div className="animate-pop mx-auto mt-10 max-w-md text-center">
          <div className="mx-auto w-fit animate-bounce">
            <Kittu mood={result.mistakes === 0 ? "party" : "smug"} size={140} />
          </div>
          <p className="font-extrabold italic text-soft">“{kittuSays(result.mistakes === 0 ? "party" : "smug", result.mistakes + result.xp)}”</p>
          <h2 className="mt-3 text-3xl font-extrabold text-brand-light">
            {mode === "learn" ? "Lesson complete!" : result.mistakes === 0 ? "Perfect review!" : "Review complete"}
          </h2>
          <p className="mt-1 text-soft">{found.line.name}</p>
          <div className="mt-6 grid grid-cols-3 gap-3">
            <ResultTile label="XP earned" value={`+${result.xp}`} color="#f7c631" icon={<Zap size={16} fill="#f7c631" />} />
            <ResultTile label="Mistakes" value={String(result.mistakes)} color={result.mistakes ? "#ffa459" : "#81b64c"} />
            <ResultTile label="Next review" value={lp ? formatInterval(INTERVALS_H[lp.stage - 1]) : "–"} color="#749bbf" />
          </div>
          <div className="mt-8 flex flex-col gap-3">
            {nextLine ? (
              <button className="btn-primary" onClick={() => router.push(`/courses/${course.id}/learn/${nextLine.line.id}`)}>
                Next lesson: {nextLine.line.name}
              </button>
            ) : (
              <Link className="btn-primary" href={`/courses/${course.id}`}>
                Back to the course
              </Link>
            )}
            <button
              className="btn-secondary"
              onClick={() => {
                setResult(null);
                setAttempt((a) => a + 1);
                router.replace(`/courses/${course.id}/learn/${found.line.id}?mode=review`);
              }}
            >
              Drill it again
            </button>
            <Link className="text-sm text-muted hover:text-white" href={`/courses/${course.id}`}>
              Back to the course map
            </Link>
          </div>
        </div>
      ) : (
        <LinePlayer key={`${found.line.id}-${mode}-${attempt}`} course={course} line={found.line} mode={mode} known={known} onComplete={onComplete} />
      )}
    </div>
  );
}

function formatInterval(hours: number): string {
  return hours >= 24 ? `${Math.round(hours / 24)}d` : `${hours}h`;
}

function ResultTile({ label, value, color, icon }: { label: string; value: string; color: string; icon?: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border-2" style={{ borderColor: color }}>
      <div className="py-1 text-[11px] font-extrabold uppercase text-[#1f1e1b]" style={{ background: color }}>
        {label}
      </div>
      <div className="flex items-center justify-center gap-1 py-3 text-xl font-extrabold" style={{ color }}>
        {icon}
        {value}
      </div>
    </div>
  );
}

export default function Page(props: { params: { id: string; lineId: string } }) {
  return (
    <Suspense>
      <LessonPage {...props} />
    </Suspense>
  );
}
