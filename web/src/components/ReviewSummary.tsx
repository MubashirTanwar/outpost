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

/** Game accuracy; when chess.com has reviewed the game too, its own number is shown underneath. */
export function AccuracyBadge({ value, label, light, chesscom }: { value: number | null; label: string; light?: boolean; chesscom?: number | null }) {
  return (
    <div className="text-center">
      <div className="mb-1 text-xs font-bold text-muted">{label}</div>
      <div
        className={`rounded-md px-4 py-2 text-2xl font-extrabold ${light ? "bg-white text-[#312e2b]" : "bg-[#403d39] text-white"}`}
      >
        {value === null ? "–" : value.toFixed(1)}
      </div>
      {chesscom != null && (
        <div className="mt-1 text-xs text-muted" title="chess.com's own Game Review accuracy for this game">
          chess.com <span className="font-bold text-soft">{chesscom.toFixed(1)}</span>
        </div>
      )}
    </div>
  );
}

/** The rating each side played at in this game (see lib/gameRating), next to their real rating. */
export function GameRatingRow({ white, black, whiteActual, blackActual }: { white: number | null; black: number | null; whiteActual?: number | null; blackActual?: number | null }) {
  if (white === null && black === null) return null;
  const cell = (v: number | null, actual: number | null | undefined, light: boolean) => (
    <div className="w-[96px] text-center">
      <div className={`rounded-md px-3 py-1.5 text-xl font-extrabold tabular-nums ${light ? "bg-white text-[#312e2b]" : "bg-[#403d39] text-white"}`}>{v ?? "–"}</div>
      {actual ? (
        <div className="mt-1 text-xs text-muted">
          rated <span className="font-bold text-soft">{actual}</span>
        </div>
      ) : null}
    </div>
  );
  return (
    <div className="flex items-start justify-center gap-6" title="Estimated from each side's average centipawn loss; short games lean on the player's real rating.">
      {cell(white, whiteActual, true)}
      <span className="pt-2.5 text-xs font-bold text-muted">Game Rating</span>
      {cell(black, blackActual, false)}
    </div>
  );
}
