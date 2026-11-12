/** Where the site lives, for absolute URLs in metadata, the sitemap and social cards. */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://chess-outpost.vercel.app")
).replace(/\/$/, "");

export const SITE_NAME = "Outpost";
export const SITE_TITLE = "Outpost: free chess game review, coaching and training";
export const SITE_DESCRIPTION =
  "Free chess.com game reviews with Stockfish, a cat coach who remembers your mistakes, puzzles from your own games, 50 opening courses and endgame training.";

const IMAGE = { url: "/opengraph-image.png", width: 1200, height: 630, alt: "Outpost: free chess game review, coached by Kittu the cat" };

/**
 * Metadata for one page. Next replaces (not merges) a parent's openGraph/twitter objects, so every
 * page that sets them must repeat the share image and card type.
 */
export function pageMeta(path: string, title: string, description: string) {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website" as const, siteName: SITE_NAME, url: path, title, description, images: [IMAGE] },
    twitter: { card: "summary_large_image" as const, title, description, images: [IMAGE] },
  };
}
