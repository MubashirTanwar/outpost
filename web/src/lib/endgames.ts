/** Endgame course data (built from courses/endgames.endgame). */
import data from "@/data/endgame-course.json";
import type { Goal } from "./endgame-rules";

export { GOAL_TEXT, HOLD_MOVES, drillStars, judgeDrill, type Goal, type Verdict } from "./endgame-rules";

export interface DemoMove {
  san: string;
  uci: string;
  fen: string;
  note: string | null;
}

export interface TheoryCard {
  text: string;
  demo: { fen: string; moves: DemoMove[] } | null;
}

export interface Drill {
  id: string;
  fen: string;
  goal: Goal;
  hint: string;
  side: "white" | "black";
  known: boolean;
}

export interface EndgameLesson {
  id: string;
  title: string;
  level: "beginner" | "intermediate" | "advanced";
  summary: string;
  theory: TheoryCard[];
  drills: Drill[];
}

export interface Stage {
  id: string;
  title: string;
  intro: string;
  lessons: EndgameLesson[];
}

export const STAGES = (data as { stages: Stage[] }).stages;
export const ALL_LESSONS = STAGES.flatMap((s) => s.lessons);
export const ALL_DRILLS = ALL_LESSONS.flatMap((l) => l.drills);

export function findLesson(id: string): { stage: Stage; lesson: EndgameLesson } | undefined {
  for (const stage of STAGES) {
    const lesson = stage.lessons.find((l) => l.id === id);
    if (lesson) return { stage, lesson };
  }
  return undefined;
}

