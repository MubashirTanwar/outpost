"use client";

import { ChevronLeft, ChevronRight, Star, X } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useCallback, useState } from "react";
import { DemoBoard } from "@/components/DemoBoard";
import { DrillPlayer } from "@/components/DrillPlayer";
import { Kittu, kittuSays } from "@/components/Kittu";
import { KittuBubble } from "@/components/KittuBubble";
import { ALL_LESSONS, findLesson } from "@/lib/endgames";
import { recordDrill } from "@/lib/progress";
import { updateProgress, useProgress } from "@/lib/useProgress";

type Phase = { kind: "theory"; card: number } | { kind: "drill"; index: number; result: { stars: number; xp: number } | null } | { kind: "done" };

export default function EndgameLessonPage({ params }: { params: { lessonId: string } }) {
  const found = findLesson(params.lessonId);
  if (!found) notFound();
  const { stage, lesson } = found;
  const p = useProgress();
  const [phase, setPhase] = useState<Phase>({ kind: "theory", card: 0 });
  const [earned, setEarned] = useState<Record<string, number>>({});

  const drillIndex = phase.kind === "drill" ? phase.index : -1;
  const onDone = useCallback(
    ({ stars }: { ok: boolean; stars: number }) => {
      const drill = lesson.drills[drillIndex];
      if (!drill) return;
      let xp = 0;
      updateProgress((prev) => {
        const out = recordDrill(prev, drill.id, stars, Date.now());
        xp = out.xp;
        return out.progress;
      });
      setEarned((e) => ({ ...e, [drill.id]: Math.max(e[drill.id] ?? 0, stars) }));
      setPhase({ kind: "drill", index: drillIndex, result: { stars, xp } });
    },
    [lesson, drillIndex],
  );

  const next = ALL_LESSONS[ALL_LESSONS.findIndex((l) => l.id === lesson.id) + 1];
  const steps = lesson.theory.length + lesson.drills.length;
  const step = phase.kind === "theory" ? phase.card : phase.kind === "drill" ? lesson.theory.length + phase.index + (phase.result ? 1 : 0) : steps;

  return (
    <div className="mx-auto max-w-[1100px] p-3 lg:p-6">
      <div className="mb-3 flex items-center gap-3">
        <Link href="/endgames" className="text-muted hover:text-white" aria-label="Back to the endgame map">
          <X size={26} />
        </Link>
        <div className="h-4 flex-1 overflow-hidden rounded-full bg-[#3c3a37]">
          <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${(step / steps) * 100}%` }} />
        </div>
        <span className="text-sm font-bold text-muted">{stage.title.split("·")[0]}</span>
      </div>

      <h1 className="mb-4 text-2xl font-extrabold">{lesson.title}</h1>

      {phase.kind === "theory" && (() => {
        const card = lesson.theory[phase.card];
        const orientation = card.demo ? (card.demo.fen.split(" ")[1] === "w" ? "white" : "black") : lesson.drills[0].side;
        return (
          <div className="flex flex-col gap-5 lg:flex-row">
            <div className="mx-auto w-full max-w-[min(72vh,600px)] lg:flex-1">
              {card.demo ? (
                <DemoBoard key={phase.card} fen={card.demo.fen} moves={card.demo.moves} orientation={orientation} />
              ) : (
                <div className="flex aspect-square items-center justify-center rounded-lg bg-panel">
                  <Kittu mood="thinking" size={220} />
                </div>
              )}
            </div>
            <div className="flex w-full flex-col gap-4 lg:w-[380px]">
              <div className="text-xs font-extrabold uppercase tracking-wide text-muted">
                Theory {phase.card + 1} / {lesson.theory.length}
              </div>
              <KittuBubble mood={phase.card === 0 ? "smug" : "proud"} quip={phase.card === 0 ? "Pay attention. There will be a test." : undefined}>
                <span className="text-[15px] leading-relaxed">{card.text}</span>
              </KittuBubble>
              <div className="flex gap-2">
                <button className="btn-secondary" disabled={phase.card === 0} onClick={() => setPhase({ kind: "theory", card: phase.card - 1 })}>
                  <ChevronLeft size={18} /> Back
                </button>
                <button
                  className="btn-primary flex-1"
                  onClick={() =>
                    setPhase(phase.card + 1 < lesson.theory.length ? { kind: "theory", card: phase.card + 1 } : { kind: "drill", index: 0, result: null })
                  }
                >
                  {phase.card + 1 < lesson.theory.length ? "Next" : `Start the drills (${lesson.drills.length})`} <ChevronRight size={18} />
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {phase.kind === "drill" && (
        <div>
          <div className="mb-3 flex items-center gap-2 text-sm font-bold text-muted">
            Drill {phase.index + 1} of {lesson.drills.length}
            {lesson.drills.map((d) => (
              <span key={d.id} className="flex">
                {[1, 2, 3].map((i) => (
                  <Star key={i} size={12} className="text-[#f7c631]" fill={(earned[d.id] ?? p.drills?.[d.id]?.stars ?? 0) >= i ? "#f7c631" : "none"} />
                ))}
              </span>
            ))}
          </div>
          {phase.result ? (
            <div className="animate-pop mx-auto mt-6 max-w-md text-center">
              <div className="mx-auto w-fit">
                <Kittu mood={phase.result.stars === 3 ? "starry" : "proud"} size={130} />
              </div>
              <div className="mt-2 flex justify-center gap-1">
                {[1, 2, 3].map((i) => (
                  <Star key={i} size={36} className="text-[#f7c631]" fill={phase.result!.stars >= i ? "#f7c631" : "none"} />
                ))}
              </div>
              <p className="mt-2 font-extrabold italic text-soft">“{kittuSays(phase.result.stars === 3 ? "starry" : "proud", phase.index)}”</p>
              <p className="mt-1 font-extrabold text-[#f7c631]">+{phase.result.xp} XP</p>
              <div className="mt-6 flex flex-col gap-3">
                <button
                  className="btn-primary"
                  onClick={() => setPhase(phase.index + 1 < lesson.drills.length ? { kind: "drill", index: phase.index + 1, result: null } : { kind: "done" })}
                >
                  {phase.index + 1 < lesson.drills.length ? "Next variation" : "Finish lesson"}
                </button>
                <button className="btn-secondary" onClick={() => setPhase({ kind: "drill", index: phase.index, result: null })}>
                  {phase.result.stars === 3 ? "Play it again" : "Try for 3 stars"}
                </button>
              </div>
            </div>
          ) : (
            <DrillPlayer key={lesson.drills[phase.index].id} drill={lesson.drills[phase.index]} onDone={onDone} />
          )}
        </div>
      )}

      {phase.kind === "done" && (
        <div className="animate-pop mx-auto mt-6 max-w-md text-center">
          <div className="mx-auto w-fit animate-bounce">
            <Kittu mood="party" size={140} />
          </div>
          <h2 className="mt-3 text-3xl font-extrabold text-brand-light">Lesson complete!</h2>
          <p className="mt-1 text-soft">
            {lesson.drills.reduce((n, d) => n + (p.drills?.[d.id]?.stars ?? 0), 0)} / {lesson.drills.length * 3} stars in {lesson.title}
          </p>
          <div className="mt-6 flex flex-col gap-3">
            {next ? (
              <Link href={`/endgames/${next.id}`} className="btn-primary">
                Next lesson: {next.title}
              </Link>
            ) : (
              <Link href="/endgames" className="btn-primary">
                Back to the map
              </Link>
            )}
            <button className="btn-secondary" onClick={() => setPhase({ kind: "theory", card: 0 })}>
              Review the theory
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
