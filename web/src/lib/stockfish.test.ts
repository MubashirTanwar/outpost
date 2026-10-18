import assert from "node:assert/strict";
import { test } from "node:test";

/** A scripted stand-in for the Stockfish worker: answers the handshake, then replays `script` on "go". */
let script: string[] = [];
class FakeWorker {
  onmessage: ((e: { data: string }) => void) | null = null;
  postMessage(cmd: string) {
    const say = (lines: string[]) => setTimeout(() => lines.forEach((l) => this.onmessage?.({ data: l })), 0);
    if (cmd === "uci") say(["uciok"]);
    else if (cmd === "isready") say(["readyok"]);
    else if (cmd.startsWith("go")) say(script);
  }
  terminate() {}
}
(globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
const { BrowserEngine } = await import("./stockfish.ts");

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

test("only complete depths are reported, and bound scores are ignored", async () => {
  script = [
    "info depth 1 multipv 1 score cp 30 pv e2e4",
    "info depth 1 multipv 2 score cp 20 pv d2d4",
    "info depth 2 multipv 1 score cp 90 upperbound pv g1f3", // a bound: not an evaluation
    "info depth 2 multipv 1 score cp 35 pv e2e4 e7e5",
    "info depth 2 multipv 2 score cp 25 pv d2d4 d7d5",
    "info depth 3 multipv 1 score cp 40 pv e2e4 e7e5 g1f3", // depth 3 never completes
    "bestmove e2e4",
  ];
  const seen: number[][] = [];
  const final = await new BrowserEngine().analyse(START, { depth: 3, multipv: 2, onInfo: (l) => seen.push(l.map((x) => x.depth ?? 0)) });
  // Each report has both lines from the same depth.
  assert.deepEqual(seen, [[1, 1], [2, 2]]);
  assert.deepEqual(final.map((l) => l.cp), [40, 25]);
  assert.ok(!final.some((l) => l.cp === 90));
});

test("fewer legal moves than lines asked for still reports", async () => {
  // White is in check from the queen on b2 and has one legal move, Kxb2.
  script = ["info depth 1 multipv 1 score cp 500 pv a1b1", "bestmove a1b1"];
  const seen: number[] = [];
  await new BrowserEngine().analyse("k7/8/8/8/8/8/1q6/K7 w - - 0 1", { multipv: 3, onInfo: (l) => seen.push(l.length) });
  assert.deepEqual(seen, [1]);
});
