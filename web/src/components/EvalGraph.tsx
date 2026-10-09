"use client";

import type { MoveReview } from "@/lib/types";
import { whiteShare } from "@/lib/format";
import { CLS_COLORS } from "./ClassificationIcon";

/** Advantage graph across the game (white area on top of dark), click to jump to a move. */
export function EvalGraph({ moves, current, onSelect, startCp = 30 }: { moves: MoveReview[]; current: number; onSelect: (ply: number) => void; startCp?: number }) {
  const W = 600, H = 90;
  const pts = [whiteShare(startCp, null), ...moves.map((m) => whiteShare(m.eval_cp, m.eval_mate))];
  const x = (i: number) => (i / Math.max(1, pts.length - 1)) * W;
  const y = (v: number) => H - v * H;
  const line = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;
  const marked = moves.filter((m) => ["blunder", "mistake", "miss", "brilliant", "great"].includes(m.classification));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-[90px] w-full cursor-pointer rounded bg-[#403d39]"
      onClick={(e) => {
        const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        onSelect(Math.round(((e.clientX - r.left) / r.width) * (pts.length - 1)));
      }}
    >
      <path d={area} fill="#f9f9f9" />
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="#888" strokeWidth="0.6" strokeDasharray="3 3" />
      <line x1={x(current)} x2={x(current)} y1="0" y2={H} stroke="#81b64c" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {marked.map((m) => (
        <circle key={m.ply} cx={x(m.ply)} cy={y(pts[m.ply])} r="4" fill={CLS_COLORS[m.classification]} stroke="#222" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}
