"use client";

import { Chess, type Square } from "chess.js";
import { Check, X } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Board, type Arrow } from "@/components/Board";
import { Kittu, kittuSays } from "@/components/Kittu";
import { START_FEN, allLines, getCourse, isLearnerMove, type Course } from "@/lib/courses";
import { lineKey, recordQuiz } from "@/lib/progress";
import { playSound } from "@/lib/sounds";
import { updateProgress, useProgress, useProgressReady } from "@/lib/useProgress";

interface Question {
  id: string;
  fen: string;
  prompt: string;
  options: string[];
  answer: string;
  explanation: string;
  arrow?: [string, string];
}

const SESSION = 8;

function shuffled<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Authored idea questions plus "find the repertoire move" questions from lines you've learned. */
function buildQuestions(course: Course, learned: Set<string>): Question[] {
  const authored: Question[] = course.chapters.flatMap((ch) =>
    ch.quizzes.map((q) => ({
      id: q.id,
      fen: q.fen,
      prompt: q.question,
      options: shuffled([q.answer, ...q.wrong]),
      answer: q.answer,
      explanation: q.explanation,
    })),
  );
  const pool = allLines(course).filter(({ line }) => learned.has(line.id));
  const source = pool.length ? pool : allLines(course).slice(0, 3);
  const generated: Question[] = [];
  const seen = new Set<string>();
  // Up to 3 positions per line until the session is full.
  const picks = shuffled(source.flatMap((s) => [s, s, s]));
  for (const { line } of picks) {
    if (generated.length >= SESSION) break;
    const plies = line.moves.map((_, i) => i).filter((i) => isLearnerMove(course, i) && i >= 2 && !seen.has(`${line.id}@${i}`));
    if (!plies.length) continue;
    const i = plies[Math.floor(Math.random() * plies.length)];
    seen.add(`${line.id}@${i}`);
    const fen = i === 0 ? START_FEN : line.moves[i - 1].fen;
    const correct = line.moves[i];
    const others = shuffled(new Chess(fen).moves().filter((m) => m !== correct.san)).slice(0, 3);
    generated.push({
      id: `${line.id}@move${i}`,
      fen,
      prompt: `${line.name}: what's the repertoire move here?`,
      options: shuffled([correct.san, ...others]),
      answer: correct.san,
      explanation: correct.note ?? `${correct.san} is the move in this line.`,
      arrow: [correct.uci.slice(0, 2), correct.uci.slice(2, 4)],
    });
  }
  return shuffled([...shuffled(authored).slice(0, 4), ...generated]).slice(0, SESSION);
}

export default function QuizPage({ params }: { params: { id: string } }) {
  const course = getCourse(params.id);
  if (!course) notFound();
  const p = useProgress();
  const ready = useProgressReady();
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState({ right: 0, xp: 0 });

  useEffect(() => {
    if (!ready || questions) return;
    const learned = new Set(allLines(course).map((l) => l.line.id).filter((id) => (p.lines[lineKey(course.id, id)]?.stage ?? 0) > 0));
    setQuestions(buildQuestions(course, learned));
  }, [ready, questions, course, p]);

  const q = questions?.[index];
  const arrows = useMemo<Arrow[]>(() => (picked && q?.arrow ? [[q.arrow[0] as Square, q.arrow[1] as Square, "rgba(129,182,76,0.85)"]] : []), [picked, q]);

  const choose = (opt: string) => {
    if (!q || picked) return;
    setPicked(opt);
    const correct = opt === q.answer;
    playSound(correct ? "correct" : "wrong");
    let xp = 0;
    updateProgress((prev) => {
      const out = recordQuiz(prev, `${course.id}/${q.id}`, correct, Date.now());
      xp = out.xp;
      return out.progress;
    });
    setScore((s) => ({ right: s.right + (correct ? 1 : 0), xp: s.xp + xp }));
  };

  if (!questions) return <div className="p-8 text-soft">Loading…</div>;

  if (!q)
    return (
      <div className="animate-pop mx-auto mt-14 max-w-md text-center">
        <div className="mx-auto w-fit">
          <Kittu mood={score.right >= questions.length * 0.75 ? "starry" : "unimpressed"} size={130} />
        </div>
        <h2 className="mt-3 text-3xl font-extrabold text-brand-light">
          {score.right}/{questions.length} correct
        </h2>
        <p className="mt-1 font-extrabold text-[#f7c631]">+{score.xp} XP</p>
        <div className="mt-8 flex flex-col gap-3">
          <button
            className="btn-primary"
            onClick={() => {
              setQuestions(null);
              setIndex(0);
              setPicked(null);
              setScore({ right: 0, xp: 0 });
            }}
          >
            Another round
          </button>
          <Link href={`/courses/${course.id}`} className="btn-secondary">
            Back to the course
          </Link>
        </div>
      </div>
    );

  return (
    <div className="mx-auto max-w-[1100px] p-3 lg:p-6">
      <div className="mb-3 flex items-center gap-3">
        <Link href={`/courses/${course.id}`} className="text-muted hover:text-white" aria-label="Quit quiz">
          <X size={26} />
        </Link>
        <div className="h-4 flex-1 overflow-hidden rounded-full bg-[#3c3a37]">
          <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${(index / questions.length) * 100}%` }} />
        </div>
        <span className="text-sm font-bold text-muted">
          {index + 1}/{questions.length}
        </span>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row">
        <div className="mx-auto w-full max-w-[min(72vh,600px)] lg:flex-1">
          <Board fen={q.fen} orientation={course.color} arrows={arrows} id="quiz" />
        </div>
        <div className="flex w-full flex-col gap-3 lg:w-[400px]">
          <h2 className="text-xl font-extrabold">{q.prompt}</h2>
          {q.options.map((opt) => {
            const isAnswer = opt === q.answer;
            const state = !picked ? "idle" : isAnswer ? "right" : opt === picked ? "wrong" : "dim";
            return (
              <button
                key={opt}
                onClick={() => choose(opt)}
                disabled={!!picked}
                className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left font-bold transition ${
                  state === "right"
                    ? "border-brand bg-brand/20 text-brand-light"
                    : state === "wrong"
                      ? "border-[#fa412d] bg-[#fa412d]/15 text-[#ff8a7a]"
                      : state === "dim"
                        ? "border-line opacity-50"
                        : "border-line bg-panel hover:border-[#5c5a57] hover:bg-[#2d2b28]"
                }`}
              >
                <span className="flex-1">{opt}</span>
                {state === "right" && <Check size={20} />}
                {state === "wrong" && <X size={20} />}
              </button>
            );
          })}
          {picked && (
            <div className={`animate-pop rounded-xl p-4 ${picked === q.answer ? "bg-[#e6f4d9] text-[#3d6b1f]" : "bg-[#fde4e1] text-[#a1271a]"}`}>
              <div className="flex items-center gap-2">
                <Kittu mood={picked === q.answer ? "proud" : "unimpressed"} size={48} />
                <div>
                  <div className="font-extrabold">{picked === q.answer ? "Correct!" : `Answer: ${q.answer}`}</div>
                  <div className="text-xs font-bold italic">{kittuSays(picked === q.answer ? "proud" : "unimpressed", index)}</div>
                </div>
              </div>
              <p className="mt-1 text-sm font-semibold">{q.explanation}</p>
              <button
                className="btn-primary mt-3 w-full"
                onClick={() => {
                  setPicked(null);
                  setIndex((i) => i + 1);
                }}
              >
                Continue
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
