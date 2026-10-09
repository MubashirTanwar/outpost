/** Browser-side access to chess.com's public API (it serves CORS headers), for browser-only mode. */
import type { Color, GameMeta } from "./types";

const API = "https://api.chess.com/pub";

interface RawGame {
  uuid?: string;
  url: string;
  pgn?: string;
  end_time: number;
  time_class: string;
  time_control: string;
  rated: boolean;
  rules?: string;
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
}

function header(pgn: string, name: string): string | null {
  const m = pgn.match(new RegExp(`\\[${name} "([^"]*)"\\]`));
  return m ? m[1] : null;
}

export function openingFromUrl(url: string | null): string | null {
  if (!url) return null;
  const slug = url.replace(/\/$/, "").split("/").pop() ?? "";
  return slug.split(/-\d+\./)[0].replace(/-/g, " ") || null;
}

function toMeta(raw: RawGame, username: string): GameMeta | null {
  if (!raw.pgn || (raw.rules ?? "chess") !== "chess") return null;
  const u = username.toLowerCase();
  const color: Color | null =
    raw.white.username.toLowerCase() === u ? "white" : raw.black.username.toLowerCase() === u ? "black" : null;
  return {
    id: raw.uuid ?? raw.url.split("/").pop()!,
    url: raw.url,
    pgn: raw.pgn,
    end_time: raw.end_time,
    time_class: raw.time_class,
    time_control: raw.time_control,
    rated: raw.rated,
    white: raw.white.username,
    black: raw.black.username,
    white_rating: raw.white.rating,
    black_rating: raw.black.rating,
    white_result: raw.white.result,
    black_result: raw.black.result,
    eco: header(raw.pgn, "ECO"),
    opening: openingFromUrl(header(raw.pgn, "ECOUrl")),
    player_color: color,
  };
}

/** Games that ended on the given local calendar day (browser time zone). */
export async function fetchDayGames(username: string, day: string): Promise<GameMeta[]> {
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(start.getTime() + 86400_000);
  const months = new Set<string>();
  for (const d of [start, new Date(end.getTime() - 1)]) {
    months.add(`${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  const games: GameMeta[] = [];
  for (const m of Array.from(months).sort()) {
    const res = await fetch(`${API}/player/${username.toLowerCase()}/games/${m}`);
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`chess.com returned ${res.status}`);
    const data: { games: RawGame[] } = await res.json();
    for (const raw of data.games) {
      const t = raw.end_time * 1000;
      if (t >= start.getTime() && t < end.getTime()) {
        const meta = toMeta(raw, username);
        if (meta) games.push(meta);
      }
    }
  }
  return games.sort((a, b) => a.end_time - b.end_time);
}

export async function playerExists(username: string): Promise<boolean> {
  const res = await fetch(`${API}/player/${username.toLowerCase()}`);
  return res.ok;
}

export function playerResult(g: Pick<GameMeta, "player_color" | "white_result" | "black_result">): "win" | "loss" | "draw" {
  const code = g.player_color === "black" ? g.black_result : g.white_result;
  if (code === "win") return "win";
  if (["agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"].includes(code)) return "draw";
  return "loss";
}

export function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Minutes east of UTC, as the backend expects. */
export function tzOffset(): number {
  return -new Date().getTimezoneOffset();
}
