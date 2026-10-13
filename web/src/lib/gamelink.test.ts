import assert from "node:assert/strict";
import { test } from "node:test";
import { gameNumber, metaFromPgn, parseGameInput, pgnId } from "./gamelink.ts";

test("chess.com links in every usual shape", () => {
  for (const url of [
    "https://www.chess.com/game/live/123456789",
    "https://www.chess.com/game/daily/123456789",
    "chess.com/live/game/123456789",
    "https://www.chess.com/analysis/game/live/123456789?tab=review",
    "https://www.chess.com/game/123456789",
    "  https://www.chess.com/game/live/123456789/  ",
    "123456789",
  ]) {
    assert.deepEqual(parseGameInput(url), { kind: "chesscom", number: "123456789" }, url);
  }
  assert.equal(parseGameInput(""), null);
  assert.equal(parseGameInput("https://lichess.org/abcdef"), null);
  assert.equal(parseGameInput("hello"), null);
});

test("PGNs, with or without headers", () => {
  assert.equal(parseGameInput('[Event "Live Chess"]\n\n1. e4 e5 *')?.kind, "pgn");
  assert.equal(parseGameInput("1. e4 e5 2. Nf3 *")?.kind, "pgn");
});

test("game number from a stored game URL", () => {
  assert.equal(gameNumber("https://www.chess.com/game/live/123456789"), "123456789");
  assert.equal(gameNumber("https://www.chess.com/game/daily/987654"), "987654");
  assert.equal(gameNumber("https://www.chess.com/member/x"), null);
});

const PGN = `[Event "Live Chess"]
[White "Me_Here"]
[Black "rival"]
[Result "0-1"]
[WhiteElo "1210"]
[BlackElo "1250"]
[TimeControl "300"]
[ECO "C50"]
[ECOUrl "https://www.chess.com/openings/Italian-Game-Giuoco-Piano-4.c3"]
[EndDate "2026.10.12"]
[EndTime "18:04:11"]
[Link "https://www.chess.com/game/live/123456789"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 0-1`;

test("game details from PGN headers", () => {
  const m = metaFromPgn(PGN, "me_here");
  assert.equal(m.player_color, "white");
  assert.deepEqual([m.white_result, m.black_result], ["resigned", "win"]);
  assert.deepEqual([m.white_rating, m.black_rating], [1210, 1250]);
  assert.equal(m.end_time, Date.UTC(2026, 9, 12, 18, 4, 11) / 1000);
  assert.equal(m.opening, "Italian Game Giuoco Piano");
  assert.equal(m.url, "https://www.chess.com/game/live/123456789");
  assert.equal(m.id, pgnId(PGN));
  assert.equal(metaFromPgn(PGN, "someone_else").player_color, null);
  assert.equal(metaFromPgn("1. e4 e5 *", "x", 5_000).end_time, 5);
  assert.notEqual(pgnId(PGN), pgnId(PGN + " "));
});
