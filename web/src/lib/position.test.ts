import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_SETUP, START_SETUP, boardResult, placementFromFen, placementToFen, possibleCastling, setupFromFen, setupToFen, validateSetup } from "./position.ts";

test("FEN round trip and the starting position", () => {
  const fen = "r3k2r/pp3ppp/2n5/3q4/8/2N5/PP3PPP/R3K2R b Kq - 0 1";
  assert.equal(placementToFen(placementFromFen(fen)), fen.split(" ")[0]);
  assert.equal(setupToFen(setupFromFen(fen)), "r3k2r/pp3ppp/2n5/3q4/8/2N5/PP3PPP/R3K2R b Kq - 0 1");
  assert.equal(setupToFen(START_SETUP), "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  assert.equal(placementToFen({}), "8/8/8/8/8/8/8/8");
});

test("castling rights only where king and rook are home", () => {
  const p = placementFromFen("4k2r/8/8/8/8/8/8/R3K3");
  assert.deepEqual(possibleCastling(p), { K: false, Q: true, k: true, q: false });
  // Rights that aren't possible are dropped from the FEN.
  assert.equal(setupToFen({ placement: p, turn: "w", castling: { K: true, Q: true, k: true, q: true } }).split(" ")[2], "Qk");
});

test("validation catches positions an engine can't handle", () => {
  assert.deepEqual(validateSetup(START_SETUP), []);
  assert.deepEqual(validateSetup(EMPTY_SETUP), ["White needs exactly one king (has 0).", "Black needs exactly one king (has 0)."]);
  const two = setupFromFen("4k3/8/8/8/8/8/8/K3K3 w - - 0 1");
  assert.match(validateSetup(two)[0], /White needs exactly one king \(has 2\)/);
  assert.match(validateSetup(setupFromFen("4k2P/8/8/8/8/8/8/4K3 w - - 0 1")).join(), /first or last rank/);
  // Black is in check from the rook, but it's White's move.
  assert.match(validateSetup(setupFromFen("4k3/8/8/8/8/8/8/4KR2 w - - 0 1")).join(), /^$/);
  assert.match(validateSetup(setupFromFen("4k3/8/8/8/8/8/8/R3K3 w - - 0 1")).join(), /^$/);
  assert.match(validateSetup(setupFromFen("4k3/8/8/8/8/8/8/4R1K1 w - - 0 1")).join(), /Black is in check but it's White's move/);
  assert.deepEqual(validateSetup(setupFromFen("4k3/8/8/8/8/8/8/4R1K1 b - - 0 1")), []);
});

test("boardResult reads mate and draws off the board", () => {
  assert.equal(boardResult("r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4"), "1-0");
  assert.equal(boardResult("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3"), "0-1");
  assert.equal(boardResult("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"), "½-½");
  assert.equal(boardResult("8/8/8/4k3/8/8/8/4K3 w - - 0 1"), "½-½");
  assert.equal(boardResult("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"), null);
});
