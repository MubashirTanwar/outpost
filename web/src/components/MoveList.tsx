"use client";

import { useEffect, useRef } from "react";
import type { MoveReview } from "@/lib/types";
import { ClassificationIcon } from "./ClassificationIcon";

/** chess.com-style two-column move list. `current` is the ply shown on the board (0 = start). */
export function MoveList({ moves, current, onSelect }: { moves: MoveReview[]; current: number; onSelect: (ply: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Scroll only this list (scrollIntoView would also scroll every ancestor panel).
    const box = ref.current;
    const el = box?.querySelector<HTMLElement>(`[data-ply="${current}"]`);
    if (!box || !el) return;
    const top = el.offsetTop; // the list is the offsetParent (it is position: relative)
    if (top < box.scrollTop) box.scrollTop = top - 8;
    else if (top + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + el.offsetHeight - box.clientHeight + 8;
  }, [current]);

  const rows: [MoveReview, MoveReview | undefined][] = [];
  for (let i = 0; i < moves.length; i += 2) rows.push([moves[i], moves[i + 1]]);

  const cell = (m?: MoveReview) =>
    m ? (
      <button
        data-ply={m.ply}
        onClick={() => onSelect(m.ply)}
        className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-[13px] font-semibold ${
          current === m.ply ? "bg-[#4b4847] text-white" : "text-soft hover:bg-[#3a3835]"
        }`}
      >
        <ClassificationIcon cls={m.classification} size={15} />
        <span>{m.san}</span>
      </button>
    ) : (
      <span />
    );

  return (
    <div ref={ref} className="relative max-h-72 overflow-y-auto">
      {rows.map(([w, b], i) => (
        <div key={i} className={`grid grid-cols-[2.5rem_1fr_1fr] items-center gap-1 px-2 py-0.5 ${i % 2 ? "bg-[#2a2926]" : ""}`}>
          <span className="text-xs font-semibold text-muted">{i + 1}.</span>
          {cell(w)}
          {cell(b)}
        </div>
      ))}
    </div>
  );
}
