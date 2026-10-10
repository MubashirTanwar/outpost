"use client";

import type { EngineLine } from "./types";

// Single-threaded WASM build copied into public/ by scripts/copy-stockfish.mjs.
export const STOCKFISH_URL = "/stockfish/stockfish-17.1-lite-single-03e3232.js";

type Listener = (line: string) => void;

/**
 * Minimal UCI client for Stockfish running in a Web Worker. Searches are serialised; each caller
 * cancels its own with an AbortSignal.
 */
export class BrowserEngine {
  private worker: Worker;
  private listeners = new Set<Listener>();
  private ready: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor() {
    this.worker = new Worker(STOCKFISH_URL);
    this.worker.onmessage = (e: MessageEvent) => {
      const line = typeof e.data === "string" ? e.data : String(e.data);
      this.listeners.forEach((l) => l(line));
    };
    this.ready = this.waitFor("uciok", () => this.send("uci")).then(() =>
      this.waitFor("readyok", () => this.send("isready")),
    );
  }

  send(cmd: string) {
    this.worker.postMessage(cmd);
  }

  private waitFor(token: string, start: () => void): Promise<void> {
    return new Promise((resolve) => {
      const l: Listener = (line) => {
        if (line.startsWith(token)) {
          this.listeners.delete(l);
          resolve();
        }
      };
      this.listeners.add(l);
      start();
    });
  }

  /**
   * Analyse a position. `onInfo` streams intermediate lines (for live eval bars);
   * the promise resolves with the final lines, scores from the side to move's view.
   *
   * Searches run one at a time. Abort `signal` to cancel just this search: if it is still waiting
   * in the queue it never starts (resolves []), and if it is running it is stopped. Other callers'
   * searches are never touched. `skill` (0-20, default 20) applies to this search only.
   */
  analyse(
    fen: string,
    opts: {
      depth?: number;
      movetime?: number;
      multipv?: number;
      skill?: number;
      signal?: AbortSignal;
      onInfo?: (lines: EngineLine[]) => void;
    } = {},
  ): Promise<EngineLine[]> {
    const run = async () => {
      await this.ready;
      if (opts.signal?.aborted) return [];
      const multipv = opts.multipv ?? 1;
      const lines: EngineLine[] = [];
      this.send(`setoption name Skill Level value ${Math.max(0, Math.min(20, opts.skill ?? 20))}`);
      this.send(`setoption name MultiPV value ${multipv}`);
      this.send(`position fen ${fen}`);
      return new Promise<EngineLine[]>((resolve) => {
        const onAbort = () => this.send("stop");
        const l: Listener = (line) => {
          if (line.startsWith("info") && line.includes(" pv ")) {
            const parsed = parseInfo(line);
            if (parsed) {
              lines[parsed.idx] = parsed.line;
              if (!opts.signal?.aborted) opts.onInfo?.(lines.filter(Boolean));
            }
          } else if (line.startsWith("bestmove")) {
            this.listeners.delete(l);
            opts.signal?.removeEventListener("abort", onAbort);
            if (!lines.length) {
              const best = line.split(" ")[1];
              resolve(best && best !== "(none)" ? [{ cp: 0, mate: null, pv: [best] }] : []);
            } else resolve(lines.filter(Boolean));
          }
        };
        this.listeners.add(l);
        opts.signal?.addEventListener("abort", onAbort, { once: true });
        this.send(opts.movetime ? `go movetime ${opts.movetime}` : `go depth ${opts.depth ?? 14}`);
      });
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  terminate() {
    this.worker.terminate();
    this.listeners.clear();
  }
}

function parseInfo(line: string): { idx: number; line: EngineLine } | null {
  const tok = line.split(" ");
  const get = (k: string) => {
    const i = tok.indexOf(k);
    return i >= 0 ? tok[i + 1] : undefined;
  };
  const scoreIdx = tok.indexOf("score");
  const pvIdx = tok.indexOf("pv");
  if (scoreIdx < 0 || pvIdx < 0) return null;
  const kind = tok[scoreIdx + 1];
  const val = parseInt(tok[scoreIdx + 2], 10);
  const mate = kind === "mate" ? val : null;
  const cp = kind === "mate" ? (val > 0 ? 100000 - val : -100000 - val) : val;
  return {
    idx: parseInt(get("multipv") ?? "1", 10) - 1,
    line: { cp, mate, pv: tok.slice(pvIdx + 1), depth: parseInt(get("depth") ?? "0", 10) },
  };
}

let shared: BrowserEngine | null = null;

export function getBrowserEngine(): BrowserEngine {
  if (!shared) shared = new BrowserEngine();
  return shared;
}
