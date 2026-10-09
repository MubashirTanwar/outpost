import { formatEval, whiteShare } from "@/lib/format";

/** Vertical evaluation bar; `cp`/`mate` are from White's point of view. */
export function EvalBar({ cp, mate, orientation = "white" }: { cp: number; mate: number | null; orientation?: "white" | "black" }) {
  const share = whiteShare(cp, mate);
  const whiteAhead = mate !== null ? mate > 0 || (mate === 0 && cp > 0) : cp >= 0;
  const flipped = orientation === "black";
  return (
    <div className="relative w-7 shrink-0 self-stretch overflow-hidden rounded-sm bg-[#403d39]" aria-label={`Evaluation ${formatEval(cp, mate)}`}>
      <div
        className="absolute left-0 right-0 bg-[#f9f9f9] transition-[height] duration-500 ease-out"
        style={{ height: `${share * 100}%`, [flipped ? "top" : "bottom"]: 0 }}
      />
      <span
        className={`absolute left-0 right-0 text-center text-[10px] font-bold ${whiteAhead ? "text-[#403d39]" : "text-[#f9f9f9]"}`}
        style={{ [whiteAhead !== flipped ? "bottom" : "top"]: 4 }}
      >
        {formatEval(cp, mate).replace("+", "")}
      </span>
    </div>
  );
}
