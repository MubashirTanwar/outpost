"use client";

import { Chess, type Square } from "chess.js";
import Link from "next/link";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import { Board } from "@/components/Board";
import { CLS_LABELS, ClassificationIcon } from "@/components/ClassificationIcon";
import { linkify, type RefContext } from "@/lib/linkify";
import type { WorstMoment } from "@/lib/types";

export type { RefContext };

/** A link with a floating preview card on hover (or focus), rendered in a portal so it's never clipped. */
function HoverCard({ href, label, children }: { href: string; label: React.ReactNode; children: React.ReactNode }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const anchor = useRef<HTMLAnchorElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const width = 260;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      // Open below the link, or above it if there isn't room.
      const top = r.bottom + 340 > window.innerHeight ? Math.max(8, r.top - 348) : r.bottom + 8;
      setPos({ left, top });
    }, 120);
  };
  const hide = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPos(null), 150);
  };
  return (
    <>
      <Link
        ref={anchor}
        href={href}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="rounded px-0.5 font-bold text-[#8fc8ff] underline decoration-dotted underline-offset-4 hover:bg-[#8fc8ff]/10 hover:text-white"
      >
        {label}
      </Link>
      {pos &&
        createPortal(
          <div
            className="animate-pop fixed z-[100] w-[260px] rounded-xl border border-line bg-[#1f1e1b] p-3 text-left text-sm text-soft shadow-2xl"
            style={pos}
            onMouseEnter={show}
            onMouseLeave={hide}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

function gameHref(ctx: RefContext, gameId: string, ply?: number) {
  const q = new URLSearchParams();
  if (ply) q.set("ply", String(ply));
  if (ctx.day) q.set("day", ctx.day);
  return `/u/${encodeURIComponent(ctx.username)}/game/${encodeURIComponent(gameId)}${q.toString() ? `?${q}` : ""}`;
}

export function MoveRef({ ctx, moment, label, showBest }: { ctx: RefContext; moment: WorstMoment; label: React.ReactNode; showBest?: boolean }) {
  const fen = moment.fen_before;
  const orientation = fen.split(" ")[1] === "w" ? "white" : "black";
  const arrows: [Square, Square, string][] = [];
  try {
    const c = new Chess(fen);
    const played = c.move(moment.san);
    arrows.push([played.from as Square, played.to as Square, "rgba(250,65,45,0.85)"]);
    c.undo();
    const best = c.move(moment.best_san);
    arrows.push([best.from as Square, best.to as Square, "rgba(129,182,76,0.9)"]);
  } catch {}
  return (
    <HoverCard href={gameHref(ctx, moment.game_id, moment.ply)} label={label}>
      <div>
        <Board fen={fen} orientation={orientation} arrows={arrows} id={`ref-${moment.game_id}-${moment.ply}`} />
      </div>
      <span className="mt-2 flex items-center gap-1.5 font-bold text-white">
        <ClassificationIcon cls={moment.classification} size={16} />
        {moment.move_number}
        {orientation === "white" ? "." : "..."} {moment.san}
        <span className="font-normal text-muted">{CLS_LABELS[moment.classification].toLowerCase()}</span>
      </span>
      <span className="mt-0.5 block text-xs">
        vs {moment.opponent} · best was <b className="text-brand-light">{moment.best_san}</b>
        {showBest ? "" : ` (−${moment.win_loss.toFixed(0)}%)`}
      </span>
      <span className="mt-1 block text-[11px] text-muted">
        <span className="text-[#fa412d]">red</span> = played · <span className="text-brand-light">green</span> = best · click to open
      </span>
    </HoverCard>
  );
}

const RESULT_COLOR = { win: "text-brand-light", loss: "text-[#ff8a7a]", draw: "text-soft" } as const;

export function GameRef({ ctx, game, label }: { ctx: RefContext; game: RefContext["games"][number]; label: React.ReactNode }) {
  const moments = ctx.moments.filter((m) => m.game_id === game.id);
  return (
    <HoverCard href={gameHref(ctx, game.id)} label={label}>
      <span className="flex items-center justify-between font-bold text-white">
        vs {game.opponent}
        <span className={`text-xs font-extrabold uppercase ${RESULT_COLOR[game.result]}`}>{game.result}</span>
      </span>
      <span className="mt-1 block text-xs">
        {game.time_class} · you had {game.color} · {game.opening ?? game.eco ?? "unknown opening"}
      </span>
      <span className="mt-2 flex gap-3 text-xs">
        <span>
          Your accuracy <b className="text-white">{game.accuracy?.toFixed(1) ?? "–"}</b>
        </span>
        <span>
          Theirs <b className="text-white">{game.opponent_accuracy?.toFixed(1) ?? "–"}</b>
        </span>
      </span>
      <span className="mt-2 flex flex-wrap gap-2 text-xs">
        {(["brilliant", "great", "inaccuracy", "mistake", "miss", "blunder"] as const).map((c) =>
          game.counts[c] ? (
            <span key={c} className="flex items-center gap-1">
              <ClassificationIcon cls={c} size={13} /> {game.counts[c]}
            </span>
          ) : null,
        )}
      </span>
      {moments.length > 0 && (
        <span className="mt-2 block text-[11px] text-muted">
          Key moment: move {moments[0].move_number} {moments[0].san} (best {moments[0].best_san})
        </span>
      )}
    </HoverCard>
  );
}

/** Markdown with game:/move: links rendered as hover-preview references. */
export function RefMarkdown({ children, ctx }: { children: string; ctx: RefContext }) {
  return (
    <div className="prose-coach">
      <ReactMarkdown
        urlTransform={(url) => url}
        components={{
          a: ({ href, children: label }) => {
            if (href?.startsWith("move:")) {
              const [, gameId, ply, best] = href.split(":");
              const moment = ctx.moments.find((m) => m.game_id === gameId && m.ply === Number(ply));
              if (moment) return <MoveRef ctx={ctx} moment={moment} label={label} showBest={best === "best"} />;
              return <Link href={gameHref(ctx, gameId, Number(ply))}>{label}</Link>;
            }
            if (href?.startsWith("game:")) {
              const game = ctx.games.find((g) => g.id === href.slice(5));
              if (game) return <GameRef ctx={ctx} game={game} label={label} />;
            }
            return (
              <a href={href} target="_blank" rel="noreferrer" className="text-[#8fc8ff] underline">
                {label}
              </a>
            );
          },
        }}
      >
        {linkify(children, ctx)}
      </ReactMarkdown>
    </div>
  );
}
