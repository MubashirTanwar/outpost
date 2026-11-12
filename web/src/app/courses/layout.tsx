import type { Metadata } from "next";
import { pageMeta } from "@/lib/site";

export const metadata: Metadata = {
  ...pageMeta("/courses", "Opening courses", "50 chess opening courses for White and Black: learn every line move by move, drill them with spaced repetition and test yourself in quizzes."),
  // Section titles reset the root template, so pass it on to the course pages.
  title: { absolute: "Opening courses · Outpost", template: "%s · Outpost" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
