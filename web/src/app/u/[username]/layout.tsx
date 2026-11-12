import type { Metadata } from "next";

// Personal pages: shareable, but kept out of search results.
export function generateMetadata({ params }: { params: { username: string } }): Metadata {
  const name = decodeURIComponent(params.username);
  return {
    title: `${name}'s games`,
    description: `${name}'s chess games reviewed with Stockfish, with coaching from Kittu.`,
    robots: { index: false, follow: true },
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
