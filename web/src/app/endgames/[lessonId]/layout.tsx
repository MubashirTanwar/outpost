import type { Metadata } from "next";
import { findLesson } from "@/lib/endgames";
import { pageMeta } from "@/lib/site";

export function generateMetadata({ params }: { params: { lessonId: string } }): Metadata {
  const found = findLesson(params.lessonId);
  if (!found) return { title: "Endgame lesson" };
  const { lesson } = found;
  const title = `${lesson.title}: endgame lesson`;
  return pageMeta(`/endgames/${lesson.id}`, title, lesson.summary);
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
