"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { LinePlayer, type LineResult } from "@/components/LinePlayer";
import { COURSES, allLines, type Course, type CourseLine } from "@/lib/courses";
import { isDue, lineKey, recordReview } from "@/lib/progress";
import { updateProgress, useProgress, useProgressReady } from "@/lib/useProgress";

interface Item {
  course: Course;
  line: CourseLine;
}

const SHUFFLE_SIZE = 5;
const SESSION_MAX = 15;

/**
 * A review session: every line that's due (optionally for one course), most overdue first.
 * With ?shuffle=1 it's Chessly-style "drill shuffle": random learned lines, due or not.
 */
function ReviewSession() {
  const search = useSearchParams();
  const courseFilter = search.get("course");
  const shuffle = search.get("shuffle") === "1";
  const p = useProgress();
  const ready = useProgressReady();
  const [queue, setQueue] = useState<Item[] | null>(null);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<{ item: Item; mistakes: number; xp: number }[]>([]);

  // Build the queue once, after progress has loaded.
  useEffect(() => {
    if (queue !== null || !ready) return;
    const now = Date.now();
    const items: (Item & { due: number })[] = [];
    for (const course of COURSES) {
      if (courseFilter && course.id !== courseFilter) continue;
      for (const { line } of allLines(course)) {
        const lp = p.lines[lineKey(course.id, line.id)];
        if (!lp || lp.stage === 0) continue;
        if (shuffle || isDue(lp, now)) items.push({ course, line, due: lp.due });
      }
    }
    if (shuffle) items.sort(() => Math.random() - 0.5);
    else items.sort((a, b) => a.due - b.due);
    setQueue(items.slice(0, shuffle ? SHUFFLE_SIZE : SESSION_MAX));
  }, [p, ready, queue, courseFilter, shuffle]);

  const current = queue?.[index];
  const onComplete = useCallback(
    ({ mistakes }: LineResult) => {
      if (!current) return;
      let xp = 0;
      updateProgress((prev) => {
        const out = recordReview(prev, lineKey(current.course.id, current.line.id), mistakes, Date.now());
        xp = out.xp;
        return out.progress;
      });
      setResults((r) => [...r, { item: current, mistakes, xp }]);
      setTimeout(() => setIndex((i) => i + 1), 700);
    },
    [current],
  );

  const back = courseFilter ? `/courses/${courseFilter}` : "/courses";

  if (queue === null) return <div className="p-8 text-soft">Loading…</div>;
  if (!queue.length)
    return (
      <div className="mx-auto mt-16 max-w-md text-center">
        <div className="text-6xl">✅</div>
        <h2 className="mt-3 text-2xl font-extrabold">Nothing due right now</h2>
        <p className="mt-1 text-soft">You&apos;re all caught up. Learn a new line or try a drill shuffle.</p>
        <Link href={back} className="btn-primary mt-6">
          Back to courses
        </Link>
      </div>
    );

  if (!current) {
    const xp = results.reduce((n, r) => n + r.xp, 0);
    const perfect = results.filter((r) => r.mistakes === 0).length;
    return (
      <div className="animate-pop mx-auto mt-12 max-w-md text-center">
        <div className="text-6xl">🏁</div>
        <h2 className="mt-3 text-3xl font-extrabold text-brand-light">Session complete</h2>
        <p className="mt-2 text-soft">
          {results.length} lines reviewed · {perfect} perfect · <span className="font-extrabold text-[#f7c631]">+{xp} XP</span>
        </p>
        <div className="mt-6 space-y-1.5 text-left">
          {results.map((r, i) => (
            <div key={i} className="flex items-center justify-between rounded-md bg-panel px-3 py-2 text-sm">
              <span>
                <span className="text-muted">{r.item.course.name} · </span>
                {r.item.line.name}
              </span>
              <span className={r.mistakes ? "text-[#ffa459]" : "text-brand-light"}>{r.mistakes ? `${r.mistakes} mistake${r.mistakes > 1 ? "s" : ""}` : "perfect"}</span>
            </div>
          ))}
        </div>
        <Link href={back} className="btn-primary mt-8">
          Continue
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1100px] p-3 lg:p-6">
      <div className="mb-3 flex items-center gap-3">
        <Link href={back} className="text-muted hover:text-white" aria-label="End session">
          <X size={26} />
        </Link>
        <div className="text-sm font-bold text-muted">
          {shuffle ? "Drill shuffle" : "Review"} · {index + 1} of {queue.length} · {current.course.name}
        </div>
      </div>
      <LinePlayer key={`${current.course.id}/${current.line.id}/${index}`} course={current.course} line={current.line} mode="review" onComplete={onComplete} />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <ReviewSession />
    </Suspense>
  );
}
