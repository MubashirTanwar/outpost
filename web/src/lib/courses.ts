import { Chess } from "chess.js";
import data from "@/data/courses.json";
import type { Color } from "./types";

export interface CourseMove {
  san: string;
  uci: string;
  fen: string; // position after the move
  note: string | null;
}

export interface CourseLine {
  id: string;
  name: string;
  moves: CourseMove[];
}

export interface Quiz {
  id: string;
  line: string;
  ply: number;
  fen: string;
  question: string;
  answer: string;
  wrong: string[];
  explanation: string;
}

export interface Chapter {
  id: string;
  title: string;
  intro: string;
  lines: CourseLine[];
  quizzes: Quiz[];
}

export interface Course {
  id: string;
  name: string;
  color: Color;
  eco: string[];
  tagline: string;
  description: string;
  chapters: Chapter[];
  stats: { chapters: number; lines: number; quizzes: number; positions: number };
}

export const COURSES = (data as { courses: Course[] }).courses;
export const START_FEN = new Chess().fen();

export function getCourse(id: string): Course | undefined {
  return COURSES.find((c) => c.id === id);
}

export function allLines(course: Course): { chapter: Chapter; line: CourseLine; index: number }[] {
  const out: { chapter: Chapter; line: CourseLine; index: number }[] = [];
  for (const chapter of course.chapters) for (const line of chapter.lines) out.push({ chapter, line, index: out.length });
  return out;
}

export function lineIds(course: Course): string[] {
  return allLines(course).map((l) => l.line.id);
}

export function findLine(course: Course, lineId: string) {
  return allLines(course).find((l) => l.line.id === lineId);
}

/** Position (without move counters) before ply i of a line (i = 0 is the start position). */
export function positionBefore(line: CourseLine, i: number): string {
  const fen = i === 0 ? START_FEN : line.moves[i - 1].fen;
  return fen.split(" ").slice(0, 4).join(" ");
}

export function isLearnerMove(course: Course, ply: number): boolean {
  // ply is 0-based: even plies are White's moves.
  return (ply % 2 === 0) === (course.color === "white");
}

/** Learner positions in already-learned lines: those moves are auto-played in Learn mode. */
export function knownPositions(course: Course, learned: Set<string>): Set<string> {
  const known = new Set<string>();
  for (const { line } of allLines(course)) {
    if (!learned.has(line.id)) continue;
    line.moves.forEach((_, i) => {
      if (isLearnerMove(course, i)) known.add(positionBefore(line, i));
    });
  }
  return known;
}

export function countLearnerMoves(course: Course, line: CourseLine): number {
  return line.moves.filter((_, i) => isLearnerMove(course, i)).length;
}
