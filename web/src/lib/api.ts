import type { DayGame, DayOverview, GameMeta, Job, OpeningLine, Profile, Puzzle, Review, WorstMoment } from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

export interface CoachReport {
  scope: { label: string; start: number | null; end: number | null; count: number | null };
  username: string;
  record: { games: number; wins: number; draws: number; losses: number };
  avg_accuracy: number | null;
  rating: { time_class: string; games: number; start: number; end: number; change: number }[];
  games: (DayGame & { rating: number | null; rating_change: number | null; termination: string | null })[];
  moments: (WorstMoment & { win_before: number; win_after: number; clock: number | null })[];
  patterns: {
    motifs: { motif: string; count: number; all_time: number; title: string; lesson: string; drill: string }[];
    weakest_phase: string | null;
    time_trouble_errors: number;
    lost_on_time: number;
    loss_streak: number;
  };
  plan: { kind: string; title: string; why: string; link: string | null }[];
}

export interface ChatAnswer {
  answer: string;
  source: string;
  used: string[];
  report?: CoachReport;
}

export interface BackfillResult {
  games: number;
  analysed: number;
  already_reviewed: number;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_URL) throw new ApiError(0, "No backend configured");
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
  } catch {
    // fetch only throws (as a bare "TypeError: Failed to fetch") when the request never got a readable reply.
    throw new ApiError(0, `Couldn't reach the backend at ${API_URL}. Is it running?`);
  }
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
  getReview: (gameId: string, username?: string) =>
    request<Review>(`/api/review/game/${encodeURIComponent(gameId)}${username ? `?username=${encodeURIComponent(username)}` : ""}`),
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
  history: (username: string, days: number) =>
    request<{ games: (GameMeta & { rating?: number | null; blunders?: number; mistakes?: number; inaccuracies?: number })[] }>(
      `/api/players/${encodeURIComponent(username)}/history?days=${days}`,
    ),
  startBackfill: (username: string, days: number) =>
    request<Job<BackfillResult>>(`/api/players/${encodeURIComponent(username)}/backfill`, {
      method: "POST",
      body: JSON.stringify({ days }),
    }),
  backfill: (username: string) => request<{ job: Job<BackfillResult> | null }>(`/api/players/${encodeURIComponent(username)}/backfill`),
  stopBackfill: (username: string) => request(`/api/players/${encodeURIComponent(username)}/backfill`, { method: "DELETE" }),
  openings: () => request<{ openings: OpeningLine[] }>("/api/openings"),
  chat: (body: { username: string; message: string; fen?: string | null; history: { role: string; content: string }[]; tz_offset?: number }) =>
    request<ChatAnswer | { job_id: string }>("/api/coach/chat", {
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
