"use client";

import { History, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { backfillStatus, startBackfill, stopBackfill, type BackfillState } from "@/lib/client";

const POLL_MS = 2000;

/**
 * "Analyse my last N days": reviews every recent game in the background (on the backend when there
 * is one) so the progress charts fill up. `onGamesAdded` fires as reviewed games land.
 */
export function BackfillCard({ username, days = 30, onGamesAdded, compact }: { username: string; days?: number; onGamesAdded: () => void; compact?: boolean }) {
  const [state, setState] = useState<BackfillState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastStage = useRef("");
  const added = useRef(onGamesAdded);
  added.current = onGamesAdded;

  const refresh = useCallback(async () => {
    try {
      const s = await backfillStatus(username);
      setState(s);
      // A new "game i of n" stage means the previous game was saved: refresh the charts.
      if (s && s.stage !== lastStage.current && /game \d+ of/.test(lastStage.current)) added.current();
      if (s?.status === "done" && lastStage.current !== "Done") added.current();
      lastStage.current = s?.stage ?? "";
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [username]);

  const running = state?.status === "queued" || state?.status === "running";
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [running, refresh]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setState(await startBackfill(username, days));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const r = state?.result;
  return (
    <div className={`card flex flex-wrap items-center gap-3 ${compact ? "p-3" : "p-4"}`}>
      <History size={22} className="shrink-0 text-brand-light" />
      <div className="min-w-0 flex-1">
        {running ? (
          <>
            <div className="mb-1 flex justify-between gap-2 text-sm">
              <span className="font-bold text-white">{state!.stage}</span>
              <span className="tabular-nums text-muted">{Math.round(state!.progress * 100)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[#3c3a37]">
              <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${Math.max(2, state!.progress * 100)}%` }} />
            </div>
            <p className="mt-1 text-xs text-muted">
              {state!.inBrowser
                ? "Running in this tab: you can use the rest of the app, but keep the tab open."
                : "Running on your backend: you can leave this page, it keeps going."}
            </p>
          </>
        ) : (
          <>
            <div className="font-bold text-white">Analyse my last {days} days</div>
            <p className="text-sm text-soft">
              {state?.status === "done" && r
                ? `Done: ${r.analysed} game${r.analysed === 1 ? "" : "s"} analysed, ${r.already_reviewed} already reviewed (${r.games} in total).`
                : state?.status === "cancelled"
                  ? "Stopped. Start again to pick up where it left off."
                  : state?.status === "error"
                    ? `It stopped with an error: ${state.error}`
                    : "Reviews every game you played in that time, in the background, so these charts fill up. Games already reviewed are skipped."}
            </p>
          </>
        )}
        {error && <p className="mt-1 text-xs text-[#ff7769]">{error}</p>}
      </div>
      {running ? (
        <button className="btn-secondary" onClick={() => stopBackfill(username).then(refresh)}>
          <Square size={14} /> Stop
        </button>
      ) : (
        <button className="btn-primary" onClick={start} disabled={busy}>
          {state?.status === "done" ? "Run again" : "Start"}
        </button>
      )}
    </div>
  );
}
