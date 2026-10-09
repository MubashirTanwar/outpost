import type { DayOverview, GameMeta, Job, OpeningLine, Profile, Puzzle, Review } from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_URL) throw new ApiError(0, "No backend configured");
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {}
    throw new ApiError(res.status, typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.json();
}

export interface Health {
  engine: boolean;
  graph: string;
  llm: string;
  depth: number;
}

let healthPromise: Promise<Health | null> | null = null;

/** Resolves to null when there is no reachable backend (browser-only mode). */
export function getHealth(): Promise<Health | null> {
  if (!healthPromise) {
    healthPromise = API_URL
      ? request<Health>("/api/health").catch(() => null)
      : Promise.resolve(null);
  }
  return healthPromise;
}

export const api = {
  games: (username: string, day: string, tzOffset: number) =>
    request<{ games: GameMeta[] }>(
      `/api/players/${encodeURIComponent(username)}/games?day=${day}&tz_offset=${tzOffset}`,
    ),
  reviewGame: (body: { username: string; game_id?: string; pgn?: string; day?: string; tz_offset?: number }) =>
    request<{ status: string; game_id: string; job_id?: string; review?: Review }>("/api/review/game", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getReview: (gameId: string) => request<Review>(`/api/review/game/${encodeURIComponent(gameId)}`),
  reviewDay: (body: { username: string; day: string; tz_offset: number }) =>
    request<{ job_id: string }>("/api/review/day", { method: "POST", body: JSON.stringify(body) }),
  job: <T>(id: string) => request<Job<T>>(`/api/jobs/${id}`),
  explain: (gameId: string, ply: number) =>
    request<{ text: string; source: string }>("/api/explain", {
      method: "POST",
      body: JSON.stringify({ game_id: gameId, ply }),
    }),
  profile: (username: string) => request<Profile>(`/api/players/${encodeURIComponent(username)}/profile`),
  puzzles: (username: string, motif?: string) =>
    request<{ puzzles: Puzzle[] }>(
      `/api/players/${encodeURIComponent(username)}/puzzles${motif ? `?motif=${encodeURIComponent(motif)}` : ""}`,
    ),
  attempt: (puzzleId: string, username: string, solved: boolean) =>
    request(`/api/puzzles/${encodeURIComponent(puzzleId)}/attempt`, {
      method: "POST",
      body: JSON.stringify({ username, solved }),
    }),
  openings: () => request<{ openings: OpeningLine[] }>("/api/openings"),
  chat: (body: { username: string; message: string; fen?: string | null; history: { role: string; content: string }[] }) =>
    request<{ answer: string; source: string; used: string[] }>("/api/coach/chat", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

export async function pollJob<T>(id: string, onUpdate: (job: Job<T>) => void, intervalMs = 800): Promise<T> {
  for (;;) {
    const job = await api.job<T>(id);
    onUpdate(job);
    if (job.status === "done") return job.result as T;
    if (job.status === "error") throw new Error(job.error || "Job failed");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
