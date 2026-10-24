import assert from "node:assert/strict";
import { test } from "node:test";
import { rankVoices, readingTime, sentences, spokenText, squaresIn, voiceScore } from "./narration.ts";

test("moves are spoken as words", () => {
  assert.equal(spokenText("Nxe5+"), "knight takes e5, check");
  assert.equal(spokenText("Play Bf4."), "Play bishop f4.");
  assert.equal(spokenText("exd5 opens the c8 bishop"), "e takes d5 opens the c8 bishop");
  assert.equal(spokenText("e8=Q#"), "e8 promotes to a queen, checkmate");
  assert.equal(spokenText("Nbd2 supports e4."), "knight d2 supports e4.");
  assert.equal(spokenText("If Black takes, axb3 gives your rook the a-file."), "If Black takes, a takes b3 gives your rook the a-file.");
});

test("move numbers, dots, castling and symbols", () => {
  assert.equal(spokenText("After 5...Qb6 6.Qb3!"), "After queen b6 queen b3");
  assert.equal(spokenText("Black plays ...c5 and ...Nc6."), "Black plays c5 and knight c6.");
  assert.equal(spokenText("O-O and then O-O-O+"), "castles and then castles queenside, check");
  assert.equal(spokenText("Qxf7#!!"), "queen takes f7, checkmate");
});

test("ordinary words are left alone", () => {
  const plain = "Build the pyramid: pawns on c3, d4 and e3. The B-file and 2nd rank stay quiet. Be careful.";
  assert.equal(spokenText(plain), plain);
});

test("squares to highlight", () => {
  assert.deepEqual(squaresIn("The knight is strong on e5 and supports f4 and Qh5."), ["e5", "f4", "h5"]);
  assert.deepEqual(squaresIn("Nxc6 and Bxd6 win material"), ["c6", "d6"]);
  assert.deepEqual(squaresIn("no squares here, B-file or e44 or 2nd rank"), []);
});

test("sentences and reading time", () => {
  assert.deepEqual(sentences("Claim the centre. Then develop! Why? Because"), ["Claim the centre.", "Then develop!", "Why?", "Because"]);
  assert.ok(readingTime("one two three") < readingTime("one two three four five six seven eight"));
  assert.ok(readingTime("a b c", 2) < readingTime("a b c"));
});

test("the narrator voice: English, deep, natural first", () => {
  const v = (name: string, lang = "en-US") => ({ name, lang, voiceURI: name });
  const ranked = rankVoices([
    v("Microsoft Aria Online (Natural) - English (United States)"),
    v("Google Deutsch", "de-DE"),
    v("Samantha"),
    v("Microsoft Guy Online (Natural) - English (United States)"),
    v("Daniel", "en-GB"),
    v("Google UK English Female", "en-GB"),
  ]).map((x) => x.name);
  assert.equal(ranked[0], "Microsoft Guy Online (Natural) - English (United States)");
  assert.ok(ranked.indexOf("Daniel") < ranked.indexOf("Samantha"));
  assert.ok(!ranked.includes("Google Deutsch"));
  assert.ok(voiceScore(v("Daniel", "en-GB")) > voiceScore(v("Google UK English Female", "en-GB")));
});
