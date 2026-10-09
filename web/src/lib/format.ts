/** Eval formatting from White's point of view, chess.com style ("+1.4", "M3", "-M2"). */
export function formatEval(cp: number, mate: number | null): string {
  if (mate !== null) return mate === 0 ? "#" : `${mate > 0 ? "" : "-"}M${Math.abs(mate)}`;
  const v = cp / 100;
  return `${v > 0 ? "+" : ""}${v.toFixed(Math.abs(v) >= 10 ? 0 : 1)}`;
}

/** 0..1 share of the bar that is white. */
export function whiteShare(cp: number, mate: number | null): number {
  if (mate !== null) return mate > 0 || (mate === 0 && cp > 0) ? 1 : 0;
  const c = Math.max(-1000, Math.min(1000, cp));
  const win = 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
  return Math.max(0.03, Math.min(0.97, win / 100));
}

export function prettyMotif(m: string): string {
  return m.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function formatClock(seconds: number | null): string {
  if (seconds === null) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function uciToMove(uci: string) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined };
}
