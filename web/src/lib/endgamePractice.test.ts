import assert from "node:assert/strict";
import { test } from "node:test";
import { judgeDrill } from "./endgame-rules.ts";
import { Chess } from "chess.js";
import { endgameType, goalFor, practicePositions, summarizeEndgames, type EndgameGame, type EndgameMove } from "./endgamePractice.ts";

test("endgame families and details, from the player's side", () => {
  assert.deepEqual(endgameType("8/5k2/8/4P3/8/8/8/4K3 w - - 0 1", "white"), { type: "Pawn endings", detail: "King and pawns", signature: "KP vs K" });
  assert.equal(endgameType("8/5k2/8/r3P3/8/8/8/R3K3 w - - 0 1", "white").detail, "Rook vs rook");
  assert.equal(endgameType("8/5k2/8/r3P3/8/8/8/R3K3 w - - 0 1", "black").signature, "KR vs KRP");
  // Bishops on c1 (dark) and c8 (light): opposite colours. c1 and f8 are both dark: same colour.
  assert.equal(endgameType("2b5/5k2/8/4P3/8/8/8/2B1K3 w - - 0 1", "white").detail, "Opposite-colour bishops");
  assert.equal(endgameType("5b2/5k2/8/4P3/8/8/8/2B1K3 w - - 0 1", "white").detail, "Same-colour bishops");
  assert.equal(endgameType("5n2/5k2/8/4P3/8/8/8/2B1K3 w - - 0 1", "white").detail, "Bishop vs knight");
  assert.deepEqual(endgameType("5n2/5k2/8/4P3/8/8/8/R3K3 w - - 0 1", "white"), { type: "Rook vs minor piece", detail: "Your rook vs their minor piece", signature: "KRP vs KN" });
  assert.equal(endgameType("8/5k2/8/q3P3/8/8/8/Q3K3 w - - 0 1", "white").type, "Queen endings");
});

test("goal from your winning chances", () => {
  assert.equal(goalFor(85), "win");
  assert.equal(goalFor(50), "draw");
  assert.equal(goalFor(20), null);
});

const mv = (ply: number, color: "white" | "black", phase: string, extra: Partial<EndgameMove> = {}): EndgameMove => ({
  ply, move_number: Math.ceil(ply / 2), color, san: `m${ply}`, classification: "best", win_before: 60, win_after: 60, phase, best_san: "Kd4",
  fen_before: phase === "endgame" ? "8/5k2/8/r3P3/8/8/8/R3K3 w - - 0 1" : null, ...extra,
});

test("practice positions: before your first endgame mistake, or where the endgame began", () => {
  const slipped: EndgameGame = {
    id: "g1", t: 2, color: "white", result: "draw", opponent: "bob",
    moves: [mv(1, "white", "opening"), mv(41, "white", "endgame"), mv(42, "black", "endgame"), mv(43, "white", "endgame", { classification: "blunder", win_before: 82, win_after: 40, san: "Ra7" })],
  };
  const clean: EndgameGame = { id: "g2", t: 3, color: "white", result: "win", opponent: "amy", moves: [mv(1, "white", "opening"), mv(51, "white", "endgame", { win_before: 55 })] };
  const lost: EndgameGame = { id: "g3", t: 4, color: "white", result: "loss", opponent: "cy", moves: [mv(61, "white", "endgame", { win_before: 10 })] };
  const none: EndgameGame = { id: "g4", t: 5, color: "white", result: "win", opponent: "di", moves: [mv(1, "white", "opening")] };
  const ps = practicePositions([clean, slipped, lost, none]);
  assert.deepEqual(ps.map((p) => [p.gameId, p.ply, p.goal]), [["g1", 43, "win"], ["g2", 51, "draw"]]);
  assert.deepEqual(ps[0].mistake, { san: "Ra7", best: "Kd4", classification: "blunder", winBefore: 82, winAfter: 40 });
  assert.equal(ps[1].mistake, null);
  assert.equal(ps[0].id, "game-g1-43");

  const [rook] = summarizeEndgames([clean, slipped, lost, none]);
  assert.deepEqual([rook.type, rook.games, rook.wins, rook.draws, rook.losses, rook.mistakes], ["Rook endings", 3, 1, 1, 1, 1]);
  assert.deepEqual(rook.details, [{ detail: "Rook vs rook", games: 3 }]);
  assert.equal(rook.positions.length, 2);
});

test("a win drill passes on a decisive advantage, not straight away", () => {
  const c = new Chess("8/5k2/8/r3P3/8/8/8/R3K3 w - - 0 1");
  assert.equal(judgeDrill(c, "win", "white", 1, 900).done, false);
  assert.equal(judgeDrill(c, "win", "white", 3, 900).ok, true);
  assert.equal(judgeDrill(c, "win", "white", 5, 20).ok, false);
});
