export const CLASSIFICATIONS = [
  "brilliant",
  "great",
  "best",
  "excellent",
  "good",
  "book",
  "forced",
  "inaccuracy",
  "mistake",
  "miss",
  "blunder",
] as const;

export type Classification = (typeof CLASSIFICATIONS)[number];
export type Color = "white" | "black";

export interface MoveReview {
  ply: number;
  move_number: number;
  color: Color;
  san: string;
  uci: string;
  fen_before: string;
  fen_after: string;
  classification: Classification;
  eval_cp: number;
  eval_mate: number | null;
  win_before: number;
  win_after: number;
  win_loss: number;
  accuracy: number;
  best_uci: string | null;
  best_san: string | null;
  best_line: string[];
  best_pv: string[];
  phase: "opening" | "middlegame" | "endgame";
  motifs: string[];
  clock: number | null;
}

export interface SideSummary {
  accuracy: number | null;
  counts: Record<Classification, number>;
  phase_accuracy: Record<string, number | null>;
}

export interface GameMeta {
  id: string;
  url: string;
  end_time: number;
  time_class: string;
  time_control: string;
  rated: boolean;
  white: string;
  black: string;
  white_rating: number | null;
  black_rating: number | null;
  white_result: string;
  black_result: string;
  eco: string | null;
  opening: string | null;
  player_color: Color | null;
  reviewed?: boolean;
  accuracy?: number | null;
  chesscom_white_accuracy?: number | null; // chess.com's own number, once reviewed there
  chesscom_black_accuracy?: number | null;
  pgn?: string;
}

export interface Review {
  headers: Record<string, string>;
  player_color: Color | null;
  result: string;
  eco: string | null;
  start_eval: { cp: number; mate: number | null };
  summary: Record<Color, SideSummary>;
  moves: MoveReview[];
  key_moments: number[];
  depth: number;
  game?: GameMeta;
}

export interface Puzzle {
  id: string;
  game_id: string;
  fen: string;
  solution: string[];
  played: string;
  best_san: string;
  motifs: string[];
  theme: string;
  win_loss: number;
  phase: string;
  attempt?: { attempts: number; streak: number; solved: boolean; last_at: number } | null;
}

export interface WorstMoment {
  ply: number;
  move_number: number;
  san: string;
  best_san: string;
  win_loss: number;
  classification: Classification;
  fen_before: string;
  motifs: string[];
  best_line: string[];
  game_id: string;
  opponent: string;
}

export interface DayGame {
  id: string;
  url: string;
  opponent: string;
  color: Color;
  result: "win" | "loss" | "draw";
  accuracy: number | null;
  opponent_accuracy: number | null;
  counts: Record<Classification, number>;
  time_class: string;
  opening: string | null;
  eco: string | null;
  end_time: number;
}

export interface MotifInfo {
  title: string;
  lesson: string;
  drill: string;
}

export interface DayOverview {
  username: string;
  day: string;
  games: number;
  summary: {
    games: number;
    wins: number;
    draws: number;
    losses: number;
    avg_accuracy: number | null;
    counts: Record<Classification, number>;
    per_game: DayGame[];
    best_game: string | null;
    worst_game: string | null;
    worst_moments: WorstMoment[];
    openings: [string, number][];
  } | null;
  patterns: {
    today_motifs: { motif: string; count: number; historical: number; recurring: boolean }[];
    weakest_phase: string | null;
    phase_losses: Record<string, number>;
  };
  lesson: string | null;
  lesson_source: string | null;
  plan: {
    puzzles: Puzzle[];
    focus: (MotifInfo & { motif: string })[];
    opening: { course_id: string | null; line_id: string | null; name: string; played: string | null; reason: string } | null;
    repertoire: RepertoireNote[];
    endgame: Endgame | null;
  } | null;
}

/** Where a game left one of your course repertoires (backend day review). */
export interface RepertoireNote {
  game_id: string;
  opponent: string;
  course_id: string;
  course_name: string;
  line_id: string;
  line_name: string;
  ply: number;
  kind: "you_deviated" | "opponent_deviated";
  played: string;
  expected: string | null;
  fen: string;
}

export interface Job<T> {
  id: string;
  status: "queued" | "running" | "done" | "error";
  stage: string;
  progress: number;
  result: T | null;
  error: string | null;
}

export interface Profile {
  games_analyzed: number;
  motifs: { motif: string; count: number; avg_loss: number }[];
  phases: { phase: string; count: number; avg_loss: number }[];
  openings: { eco: string; name: string; games: number; win: number; draw: number; loss: number; avg_accuracy: number | null }[];
  recurring_positions: { fen: string; times: number; best_san: string }[];
  error_totals: Record<string, number>;
  motif_info: Record<string, MotifInfo>;
}

export interface OpeningLine {
  id: string;
  name: string;
  eco: string;
  color: Color;
  moves: string;
  ideas: string[];
}

/** An endgame lesson recommended by the backend's day review. */
export interface Endgame {
  id: string;
  title: string;
  level: string;
  summary: string;
  stage: string;
}

export interface EngineLine {
  cp: number;
  mate: number | null;
  pv: string[];
  san?: string[];
  depth?: number;
}
