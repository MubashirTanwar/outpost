import type { Metadata } from "next";
import { getCourse } from "@/lib/courses";
import { pageMeta } from "@/lib/site";

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  const course = getCourse(params.id);
  if (!course) return { title: "Course not found", robots: { index: false } };
  const lines = course.chapters.reduce((n, ch) => n + ch.lines.length, 0);
  const description = `${course.tagline || course.name} ${course.chapters.length} chapters, ${lines} lines to learn as ${course.color === "white" ? "White" : "Black"}.`;
  return pageMeta(`/courses/${course.id}`, course.name, description);
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
