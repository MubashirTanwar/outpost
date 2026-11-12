import type { Metadata } from "next";
import { pageMeta } from "@/lib/site";

export const metadata: Metadata = {
  ...pageMeta("/endgames", "Endgame training", "Learn the endgames that decide games: basic mates, pawn endings, Lucena and Philidor, then play them out against Stockfish, plus positions from your own games."),
  title: { absolute: "Endgame training · Outpost", template: "%s · Outpost" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
