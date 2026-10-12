"use client";

import { type Square } from "chess.js";
import { Chess } from "chess.js";
import { BookOpen, Clock, Crown, Puzzle, RotateCcw, Target } from "lucide-react";
import Link from "next/link";
import { Board } from "@/components/Board";
import { CLS_LABELS, ClassificationIcon } from "@/components/ClassificationIcon";
import { gameHref, type RefContext } from "@/components/GameRefs";
import type { CoachReport as Report } from "@/lib/api";

const PLAN_ICON = { puzzles: Puzzle, course: BookOpen, endgame: Crown, habit: Clock, review: RotateCcw } as const;

export function refContext(report: Report): RefContext {
  return { username: report.username, games: report.games, moments: report.moments };
}

/** The exact facts behind a coach answer: rating change, the positions that went wrong, what to study. */
export function CoachReport({ report }: { report: Report }) {
  if (!report.record.games) return null;
  const ctx = refContext(report);
  const { record } = report;
  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="rounded-md bg-[#3c3a37] px-2.5 py-1 font-bold">
          {record.wins}W <span className="text-muted">·</span> {record.losses}L <span className="text-muted">·</span> {record.draws}D
        </span>
        {report.avg_accuracy !== null && (
          <span className="rounded-md bg-[#3c3a37] px-2.5 py-1">
            accuracy <b className="text-white">{report.avg_accuracy}</b>
          </span>
        )}
        {report.rating.map((r) => (
          <span key={r.time_class} className="rounded-md bg-[#3c3a37] px-2.5 py-1 capitalize">
            {r.time_class} {r.start} → {r.end}{" "}
            <b className={r.change > 0 ? "text-brand-light" : r.change < 0 ? "text-[#ff8a7a]" : "text-soft"}>
              {r.change > 0 ? "+" : ""}
              {r.change}
            </b>
          </span>
        ))}
      </div>

      {report.moments.length > 0 && (
        <div>
          <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase text-muted">
            <Target size={13} /> Positions you got wrong
          </h4>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {report.moments.slice(0, 6).map((m) => (
              <PositionCard key={`${m.game_id}-${m.ply}`} ctx={ctx} moment={m} />
            ))}
          </div>
        </div>
      )}

      {report.plan.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-xs font-bold uppercase text-muted">What to study</h4>
          <ol className="flex flex-col gap-1.5">
            {report.plan.map((p, i) => {
              const Icon = PLAN_ICON[p.kind as keyof typeof PLAN_ICON] ?? Target;
              const body = (
                <>
                  <Icon size={18} className="mt-0.5 shrink-0 text-brand-light" />
                  <span>
                    <span className="font-bold text-white">{p.title}</span>
                    <span className="block text-xs text-soft">{p.why}</span>
                  </span>
                </>
              );
              return (
                <li key={i}>
                  {p.link ? (
                    <Link href={p.link} className="flex gap-2.5 rounded-md bg-[#2b2a27] p-2.5 hover:bg-[#363431]">
                      {body}
                    </Link>
                  ) : (
                    <div className="flex gap-2.5 rounded-md bg-[#2b2a27] p-2.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}

function PositionCard({ ctx, moment }: { ctx: RefContext; moment: Report["moments"][number] }) {
  const orientation = moment.fen_before.split(" ")[1] === "w" ? "white" : "black";
  const arrows: [Square, Square, string][] = [];
  try {
    const c = new Chess(moment.fen_before);
    const played = c.move(moment.san);
    arrows.push([played.from as Square, played.to as Square, "rgba(250,65,45,0.85)"]);
    c.undo();
    const best = c.move(moment.best_san);
    arrows.push([best.from as Square, best.to as Square, "rgba(129,182,76,0.9)"]);
  } catch {}
  return (
    <Link href={gameHref(ctx, moment.game_id, moment.ply)} className="group rounded-md bg-[#2b2a27] p-1.5 hover:bg-[#363431]" title="Open this moment in the review">
      <div className="pointer-events-none">
        <Board fen={moment.fen_before} orientation={orientation} arrows={arrows} id={`coach-${moment.game_id}-${moment.ply}`} />
      </div>
      <div className="mt-1.5 flex items-center gap-1 text-xs font-bold text-white">
        <ClassificationIcon cls={moment.classification} size={14} />
        {moment.move_number}
        {orientation === "white" ? "." : "..."} {moment.san}
        <span className="ml-auto font-normal text-muted">{CLS_LABELS[moment.classification].toLowerCase()}</span>
      </div>
      <div className="text-[11px] text-soft">
        vs {moment.opponent} · best <b className="text-brand-light">{moment.best_san}</b> · {Math.round(moment.win_before)}% → {Math.round(moment.win_after)}%
      </div>
    </Link>
  );
}
