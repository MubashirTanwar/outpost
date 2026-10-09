import type { Classification } from "@/lib/types";
import { CLS_COLORS, CLS_LABELS, ClassificationIcon } from "./ClassificationIcon";

const ROWS: Classification[] = ["brilliant", "great", "best", "excellent", "good", "book", "inaccuracy", "mistake", "miss", "blunder"];

/** The chess.com "Game Review" table: counts per classification for two sides. */
export function ClassificationTable({
  left,
  right,
  leftLabel,
  rightLabel,
}: {
  left: Record<Classification, number>;
  right?: Record<Classification, number>;
  leftLabel?: string;
  rightLabel?: string;
}) {
  return (
    <div className="text-sm">
      {(leftLabel || rightLabel) && (
        <div className="mb-1 grid grid-cols-[1fr_3rem_2rem_3rem] items-center text-xs font-bold text-muted">
          <span />
          <span className="text-center">{leftLabel}</span>
          <span />
          <span className="text-center">{rightLabel}</span>
        </div>
      )}
      {ROWS.map((c) => (
        <div key={c} className="grid grid-cols-[1fr_3rem_2rem_3rem] items-center py-[3px]">
          <span className="font-semibold text-soft">{CLS_LABELS[c]}</span>
          <span className="text-center font-extrabold" style={{ color: CLS_COLORS[c] }}>
            {left[c] ?? 0}
          </span>
          <span className="flex justify-center">
            <ClassificationIcon cls={c} size={20} />
          </span>
          {right ? (
            <span className="text-center font-extrabold" style={{ color: CLS_COLORS[c] }}>
              {right[c] ?? 0}
            </span>
          ) : (
            <span />
          )}
        </div>
      ))}
    </div>
  );
}

export function AccuracyBadge({ value, label, light }: { value: number | null; label: string; light?: boolean }) {
  return (
    <div className="text-center">
      <div className="mb-1 text-xs font-bold text-muted">{label}</div>
      <div
        className={`rounded-md px-4 py-2 text-2xl font-extrabold ${light ? "bg-white text-[#312e2b]" : "bg-[#403d39] text-white"}`}
      >
        {value === null ? "–" : value.toFixed(1)}
      </div>
    </div>
  );
}
