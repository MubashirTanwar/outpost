/** Narrated lessons: turning chess notation into speech, picking a narrator voice, and what to highlight. */

const PIECES: Record<string, string> = { K: "king", Q: "queen", R: "rook", B: "bishop", N: "knight" };

// A SAN move not glued to other letters or digits: Nbd2, exd5, e8=Q+, Qxf7#, R1e2.
const SAN = /(?<![A-Za-z0-9])([KQRBN])?([a-h])?([1-8])?(x)?([a-h][1-8])(?:=([QRBN]))?([+#])?(?![A-Za-z0-9])/g;

function speakMove(piece: string | undefined, fromFile: string | undefined, fromRank: string | undefined, capture: string | undefined, to: string, promo: string | undefined, check: string | undefined): string {
  const words: string[] = [];
  if (piece) words.push(PIECES[piece]);
  // "exd5" -> "e takes d5"; "Nbd2" -> "knight b d2" reads badly, so the disambiguation is dropped.
  else if (fromFile && capture) words.push(fromFile);
  if (capture) words.push("takes");
  words.push(to);
  if (promo) words.push(`promotes to a ${PIECES[promo]}`);
  let out = words.join(" ");
  if (check === "+") out += ", check";
  if (check === "#") out += ", checkmate";
  void fromRank;
  return out;
}

/**
 * Text as a narrator should say it: move numbers and "..." dropped, SAN moves in words
 * ("Nxe5+" -> "knight takes e5, check"), castling spelled out, and annotation symbols removed.
 */
export function spokenText(text: string): string {
  return (
    text
      // Move numbers: "12." / "12..." before a move, and a leading "..." on Black's moves.
      .replace(/(?<![A-Za-z0-9])\d+\.(?:\.\.)?\s*(?=[KQRBNa-hO])/g, "")
      .replace(/\.\.\.(?=[KQRBNa-hO])/g, "")
      .replace(/(?<![A-Za-z0-9-])O-O-O([+#])?/g, (_, c) => `castles queenside${c === "#" ? ", checkmate" : c ? ", check" : ""}`)
      .replace(/(?<![A-Za-z0-9-])O-O([+#])?/g, (_, c) => `castles${c === "#" ? ", checkmate" : c ? ", check" : ""}`)
      .replace(SAN, (_m, p, ff, fr, x, to, promo, chk) => speakMove(p, ff, fr, x, to, promo, chk))
      .replace(/[!?]{1,2}(?=\s|$|[,.;:)])/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Board squares a comment talks about (from its moves and plain mentions like "the e5 square"). */
export function squaresIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?<![A-Za-z0-9])(?:[KQRBN]?[a-h]?[1-8]?x?)([a-h][1-8])(?![A-Za-z0-9])/g)) out.add(m[1]);
  return [...out];
}

/** Long text split into sentences: some browsers cut a single long utterance off after ~15 seconds. */
export function sentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface VoiceInfo {
  name: string;
  lang: string;
  voiceURI: string;
  localService?: boolean;
}

// Deep, calm male narrator voices that ship with common browsers and systems.
const PREFERRED = ["guy", "christopher", "eric", "ryan", "thomas", "brian", "andrew", "davis", "daniel", "arthur", "oliver", "google uk english male", "aaron", "fred", "alex", "david", "mark", "george"];
const FEMALE = ["female", "aria", "jenny", "sonia", "libby", "samantha", "victoria", "karen", "moira", "tessa", "fiona", "zira", "hazel", "susan", "emma", "ava", "allison", "serena", "kate", "michelle", "google us english", "google uk english female"];

/** How good a voice is for a deep English narrator (higher is better). */
export function voiceScore(v: VoiceInfo): number {
  const name = v.name.toLowerCase();
  if (!v.lang.toLowerCase().startsWith("en")) return -100;
  let score = 0;
  // Neural "Natural"/"Online" voices (Edge, Windows) sound far more human than older ones.
  if (/natural|online|neural|premium|enhanced/.test(name)) score += 40;
  const pref = PREFERRED.findIndex((p) => name.includes(p));
  if (pref >= 0) score += 30 - pref;
  if (FEMALE.some((f) => name.includes(f))) score -= 25;
  if (/en-gb/i.test(v.lang)) score += 3; // a documentary feel
  return score;
}

/** English voices, best narrator first. */
export function rankVoices<T extends VoiceInfo>(voices: T[]): T[] {
  return voices.filter((v) => voiceScore(v) > -100).sort((a, b) => voiceScore(b) - voiceScore(a) || a.name.localeCompare(b.name));
}

/** Milliseconds to show a comment when narration is off: enough time to read it. */
export function readingTime(text: string, speed = 1): number {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return Math.round((1200 + words * 260) / speed);
}
