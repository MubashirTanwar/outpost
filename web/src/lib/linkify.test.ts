import assert from "node:assert/strict";
import { test } from "node:test";
import { linkify, type RefContext } from "./linkify.ts";

const game = (id: string, opponent: string) =>
  ({ id, opponent, url: "", color: "white", result: "loss", accuracy: 60, opponent_accuracy: 70, counts: {}, time_class: "blitz", opening: null, eco: null, end_time: 0 }) as never;
const moment = (game_id: string, ply: number, san: string, best_san: string, opponent: string) =>
  ({ game_id, ply, san, best_san, opponent, move_number: Math.ceil(ply / 2), win_loss: 30, classification: "blunder", fen_before: "", motifs: [], best_line: [] }) as never;

const ctx: RefContext = {
  username: "me",
  games: [game("g1", "DTJONY"), game("g2", "Skaus200")],
  moments: [moment("g1", 17, "Bb5+", "Nf3", "DTJONY"), moment("g2", 10, "Bf5", "c6", "Skaus200"), moment("g1", 30, "Bf5", "Qd2", "DTJONY")],
};

test("links opponents and key moves", () => {
  const out = linkify("Against DTJONY you played **Bb5+** instead of Nf3.", ctx);
  assert.match(out, /\[DTJONY\]\(game:g1\)/);
  assert.match(out, /\[\*\*Bb5\+\*\*\]\(move:g1:17\)/);
  assert.match(out, /\[\*\*Nf3\*\*\]\(move:g1:17:best\)/);
});

test("ambiguous moves prefer the game named in the same paragraph", () => {
  const out = linkify("Against Skaus200, you played **Bf5** instead of c6.", ctx);
  assert.match(out, /move:g2:10\)/);
  const out2 = linkify("Later vs DTJONY: Bf5 again.", ctx);
  assert.match(out2, /move:g1:30\)/);
});

test("check signs are optional and existing links are untouched", () => {
  assert.match(linkify("You played Bb5 too early.", ctx), /move:g1:17/);
  const pre = "See [DTJONY](game:g1) and Bb5+.";
  assert.equal((linkify(pre, ctx).match(/game:g1/g) ?? []).length, 1);
});

test("no partial matches inside other moves or words", () => {
  const c: RefContext = { ...ctx, moments: [moment("g1", 9, "O-O", "d4", "DTJONY")] };
  assert.doesNotMatch(linkify("Castling long with O-O-O was fine.", c), /move:/);
});

test("model-written links that point nowhere are repaired or unwrapped", () => {
  const c: RefContext = { ...ctx, games: [...ctx.games, game("37a81a2f-c499-11f1-8dbb-feb0c301000f", "Spha_hlatshwayo-97Rsa"), game("x9", "err0r_0110")] };
  // Opponent name used as the id, truncated id, angle brackets: all resolve to the real game.
  assert.match(linkify("vs [Spha_hlatshwayo-97Rsa](game:Spha_hlatshwayo-97Rsa)", c), /\(game:37a81a2f-c499-11f1-8dbb-feb0c301000f\)/);
  assert.match(linkify("vs [them](game:37a81a2f-c499)", c), /\(game:37a81a2f-c499-11f1-8dbb-feb0c301000f\)/);
  assert.match(linkify("vs [DTJONY](<game:g1>)", c), /\[DTJONY\]\(game:g1\)/);
  // A made-up id for a known opponent: unwrapped, then linked by name.
  assert.match(linkify("against [err0r_0110](game:abc)", c), /\[err0r_0110\]\(game:x9\)/);
  // Unknown target and unknown name: plain text, never a dead link.
  assert.equal(linkify("see [this game](game:nope)", c), "see this game");
  // Stray references in the text are removed.
  assert.equal(linkify("You lost to err0r_0110 (game:x9).", c), "You lost to [err0r_0110](game:x9).");
  // Names with _ and - are linked when the model didn't link them at all.
  assert.match(linkify("and Spha_hlatshwayo-97Rsa too", c), /\[Spha_hlatshwayo-97Rsa\]\(game:37a81a2f/);
});
