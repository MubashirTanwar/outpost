import { formatEval, whiteShare } from "@/lib/format";
import { boardResult } from "@/lib/position";

/**
 * Vertical evaluation bar; `cp`/`mate` are from White's point of view. Pass `fen` so a finished
 * game shows its result (1-0, 0-1, ½-½) instead of an engine number.
 */
export function EvalBar({ cp, mate, fen, orientation = "white" }: { cp: number; mate: number | null; fen?: string; orientation?: "white" | "black" }) {
  const result = fen ? boardResult(fen) : null;
  const share = result === "1-0" ? 1 : result === "0-1" ? 0 : result ? 0.5 : whiteShare(cp, mate);
  const whiteAhead = result ? result !== "0-1" : mate !== null ? mate > 0 || (mate === 0 && cp > 0) : cp >= 0;
  const label = result ?? formatEval(cp, mate).replace("+", "");
  const flipped = orientation === "black";
  return (
    <div className="relative w-7 shrink-0 self-stretch overflow-hidden rounded-sm bg-[#403d39]" aria-label={`Evaluation ${result ?? formatEval(cp, mate)}`}>
      <div
        className="absolute left-0 right-0 bg-[#f9f9f9] transition-[height] duration-500 ease-out"
        style={{ height: `${share * 100}%`, [flipped ? "top" : "bottom"]: 0 }}
      />
      <span
        className={`absolute left-0 right-0 text-center font-bold ${result ? "text-[9px] tracking-tighter" : "text-[10px]"} ${whiteAhead ? "text-[#403d39]" : "text-[#f9f9f9]"}`}
        style={{ [whiteAhead !== flipped ? "bottom" : "top"]: 4 }}
      >
        {label}
      </span>
    </div>
  );
}
