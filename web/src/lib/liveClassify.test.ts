import assert from "node:assert/strict";
import { test } from "node:test";
import { newLine, play } from "./analysisLine.ts";
import { classify, winPercent } from "./classify.ts";
import { CLASSIFY_DEPTH, classifyLine, positionsToAnalyse, type CachedEval, type Judge } from "./liveClassify.ts";

// The real judge lives in review.ts (it needs the opening book); this one uses the same classify().
const seen: Parameters<Judge>[0][] = [];
const judge: Judge = (m) => {
  seen.push(m);
  const winBefore = winPercent(m.best.cp);
  const winAfter = winPercent(-m.afterBest.cp);
  const playedBest = m.best.pv[0] === m.uci;
  const loss = Math.max(0, winBefore - winAfter);
  const cls = classify({ winBefore, winAfter, playedBest, secondBestWin: null, sacrifice: false, isBook: false, onlyMove: false, isRecapture: m.isRecapture, givesMate: m.san.includes("#"), prevOpponentClass: m.prev });
  return { classification: cls, winBefore, winAfter, loss, inBook: false };
};

const deep = (cp: number, pv: string[], cp2?: number): CachedEval => ({
  depth: CLASSIFY_DEPTH,
  lines: [{ cp, mate: null, pv, depth: CLASSIFY_DEPTH }, ...(cp2 !== undefined ? [{ cp: cp2, mate: null, pv: ["a2a3"], depth: CLASSIFY_DEPTH }] : [])],
});

test("a move is judged once both its positions are searched deeply enough", () => {
  let l = newLine();
  l = play(l, "e4")!;
  l = play(l, "f6")!; // a weak reply
  const cache = new Map<string, CachedEval>();
  const get = (f: string) => cache.get(f);
  assert.deepEqual(classifyLine(l, get, judge), [null, null]);
  assert.deepEqual(positionsToAnalyse(l, get), [l.moves[0].fen, l.moves[1].fen]);

  cache.set(l.start, deep(30, ["e2e4"]));
  cache.set(l.moves[0].fen, deep(-30, ["e7e5"], -40)); // Black's view: slightly worse
  // Too shallow: still pending.
  cache.set(l.moves[1].fen, { depth: CLASSIFY_DEPTH - 4, lines: [{ cp: 250, mate: null, pv: ["d2d4"] }] });
  const v1 = classifyLine(l, get, judge);
  assert.equal(v1[0]?.classification, "best");
  assert.equal(v1[1], null);

  cache.set(l.moves[1].fen, deep(250, ["d2d4"])); // White's view after ...f6: +2.5
  const [, v] = classifyLine(l, get, judge);
  assert.ok(v && ["mistake", "blunder"].includes(v.classification), JSON.stringify(v));
  assert.equal(v!.bestSan, "e5");
  assert.ok(v!.loss > 10);
  assert.deepEqual(positionsToAnalyse(l, get), []);
});

test("checkmate needs no search, and recaptures and the previous verdict are passed on", () => {
  let l = newLine();
  for (const m of ["f3", "e5", "g4", "Qh4#"]) l = play(l, m)!;
  const cache = new Map<string, CachedEval>([[l.moves[2].fen, deep(100000 - 1, ["d8h4"])]]);
  const out = classifyLine(l, (f) => cache.get(f), judge);
  assert.equal(out[3]?.classification, "best");
  // Only the position before the mate needed a search.
  assert.deepEqual(positionsToAnalyse(l, (f) => cache.get(f)), []);

  let r = newLine("rnbqkbnr/ppp2ppp/8/3pp3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3");
  r = play(r, "exd5")!;
  r = play(r, "Qxd5")!;
  const c2 = new Map<string, CachedEval>([[r.start, deep(40, ["e4d5"])], [r.moves[0].fen, deep(-40, ["d8d5"])], [r.moves[1].fen, deep(40, ["b1c3"])]]);
  seen.length = 0;
  classifyLine(r, (f) => c2.get(f), judge);
  assert.equal(seen[1].isRecapture, true);
  assert.equal(seen[1].prev, "best");
  // Not from the starting position: no book.
  assert.deepEqual(seen[0].sans, []);
  assert.equal(seen[0].inBook, false);
});
