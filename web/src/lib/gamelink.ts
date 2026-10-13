/** "Review one game": understand a pasted chess.com link, game number or PGN. */
import type { Color, GameMeta } from "./types.ts";

export type GameInput = { kind: "chesscom"; number: string } | { kind: "pgn"; pgn: string };

/**
 * chess.com links in their usual shapes (game/live, game/daily, live/game, analysis/game/live, with or
 * without query strings), a bare game number, or a PGN. Null if it's none of those.
 */
export function parseGameInput(text: string): GameInput | null {
  const s = text.trim();
  if (!s) return null;
  if (/^\s*\[\w+\s+"/.test(s) || /^1\.\s*\S/.test(s)) return { kind: "pgn", pgn: s };
  if (/^\d{5,}$/.test(s)) return { kind: "chesscom", number: s };
  const m = s.match(/chess\.com\/(?:analysis\/)?(?:game\/(?:live|daily)|live\/game|daily\/game|game)\/(\d{5,})/i);
  return m ? { kind: "chesscom", number: m[1] } : null;
}

/** The game number at the end of a chess.com game URL. */
export function gameNumber(url: string): string | null {
  return url.match(/\/(\d{5,})\/?(?:[?#].*)?$/)?.[1] ?? null;
}

function header(pgn: string, name: string): string | null {
  return pgn.match(new RegExp(`\\[${name} "([^"]*)"\\]`))?.[1] ?? null;
}

/** Short stable id for a pasted PGN, so pasting the same game again reuses its review. */
export function pgnId(pgn: string): string {
  let h = 2166136261;
  for (let i = 0; i < pgn.length; i++) h = Math.imul(h ^ pgn.charCodeAt(i), 16777619);
  return `pgn-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/** Game details from a PGN's headers, seen from `username`'s side if they played it. */
export function metaFromPgn(pgn: string, username: string, now = Date.now()): GameMeta & { pgn: string } {
  const white = header(pgn, "White") ?? "White";
  const black = header(pgn, "Black") ?? "Black";
  const u = username.toLowerCase();
  const color: Color | null = white.toLowerCase() === u ? "white" : black.toLowerCase() === u ? "black" : null;
  const result = header(pgn, "Result");
  const side = (win: string) => (result === "1/2-1/2" ? "agreed" : result === win ? "win" : result === "*" || !result ? "unknown" : "resigned");
  const rating = (name: string) => {
    const r = Number(header(pgn, name));
    return Number.isFinite(r) && r > 0 ? r : null;
  };
  // "2026.10.12" + "18:04:11" (UTC on chess.com) when present.
  const date = header(pgn, "EndDate") ?? header(pgn, "UTCDate") ?? header(pgn, "Date");
  const time = header(pgn, "EndTime") ?? header(pgn, "UTCTime");
  const parsed = date && /^\d{4}\.\d{2}\.\d{2}$/.test(date) ? Date.parse(`${date.replace(/\./g, "-")}T${time && /^\d{1,2}:\d{2}:\d{2}$/.test(time) ? time.padStart(8, "0") : "12:00:00"}Z`) : NaN;
  const ecoUrl = header(pgn, "ECOUrl");
  return {
    id: pgnId(pgn),
    url: header(pgn, "Link") ?? "",
    pgn,
    end_time: Math.floor((Number.isFinite(parsed) ? parsed : now) / 1000),
    time_class: "",
    time_control: header(pgn, "TimeControl") ?? "",
    rated: false,
    white,
    black,
    white_rating: rating("WhiteElo"),
    black_rating: rating("BlackElo"),
    white_result: side("1-0"),
    black_result: side("0-1"),
    eco: header(pgn, "ECO"),
    opening: ecoUrl ? (ecoUrl.replace(/\/$/, "").split("/").pop() ?? "").split(/-\d+\./)[0].replace(/-/g, " ") || null : null,
    player_color: color,
  };
}
