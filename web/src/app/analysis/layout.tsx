import type { Metadata } from "next";
import { pageMeta } from "@/lib/site";

export const metadata: Metadata = {
  ...pageMeta("/analysis", "Analysis board", "Free chess analysis board with Stockfish 17 in your browser: paste a PGN or FEN, set up any position, and see every move classified as you play."),
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
