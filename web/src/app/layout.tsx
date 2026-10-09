import type { Metadata } from "next";
import { AchievementToasts } from "@/components/AchievementToasts";
import { Shell } from "@/components/Shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChessCoach",
  description: "Free game reviews, daily coaching, puzzles from your own mistakes, openings and endgame training.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <Shell>{children}</Shell>
        <AchievementToasts />
      </body>
    </html>
  );
}
