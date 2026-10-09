import type { Classification } from "@/lib/types";

export const CLS_COLORS: Record<Classification, string> = {
  brilliant: "#26c2a3",
  great: "#749bbf",
  best: "#81b64c",
  excellent: "#81b64c",
  good: "#95b776",
  book: "#a88865",
  forced: "#97af8b",
  inaccuracy: "#f7c631",
  mistake: "#ffa459",
  miss: "#ff7769",
  blunder: "#fa412d",
};

export const CLS_LABELS: Record<Classification, string> = {
  brilliant: "Brilliant",
  great: "Great",
  best: "Best",
  excellent: "Excellent",
  good: "Good",
  book: "Book",
  forced: "Forced",
  inaccuracy: "Inaccuracy",
  mistake: "Mistake",
  miss: "Miss",
  blunder: "Blunder",
};

const TEXT: Partial<Record<Classification, string>> = {
  brilliant: "!!",
  great: "!",
  inaccuracy: "?!",
  mistake: "?",
  blunder: "??",
};

function Glyph({ cls }: { cls: Classification }) {
  const text = TEXT[cls];
  if (text) {
    return (
      <text x="12" y="16.5" textAnchor="middle" fontSize={text.length > 1 ? 11 : 13} fontWeight={800} fill="#fff" fontFamily="Arial, sans-serif">
        {text}
      </text>
    );
  }
  switch (cls) {
    case "best":
      return <path d="M12 5.2l1.95 4.1 4.45.55-3.28 3.08.84 4.42L12 15.2l-3.96 2.15.84-4.42L5.6 9.85l4.45-.55z" fill="#fff" />;
    case "excellent":
      // thumbs up
      return <path d="M7 11h2v7H7zM10 18v-7l3-4.6c.4-.6 1.5-.3 1.4.5L14 10h3.3c.9 0 1.5.8 1.3 1.6l-1.2 5.2c-.2.7-.8 1.2-1.5 1.2z" fill="#fff" />;
    case "good":
      return <path d="M7.5 12.3l3 3 6-6.3" stroke="#fff" strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
    case "book":
      return (
        <path
          d="M6.5 7.5c2-.6 3.8-.4 5.5.8 1.7-1.2 3.5-1.4 5.5-.8v9c-2-.6-3.8-.4-5.5.8-1.7-1.2-3.5-1.4-5.5-.8z M12 8.3v9"
          stroke="#fff" strokeWidth={1.5} fill="none" strokeLinejoin="round"
        />
      );
    case "forced":
      return <path d="M7 12h9M13 8.5l3.5 3.5-3.5 3.5" stroke="#fff" strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
    case "miss":
      return <path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" />;
    default:
      return null;
  }
}

export function ClassificationIcon({ cls, size = 20, className = "" }: { cls: Classification; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-label={CLS_LABELS[cls]} role="img">
      <circle cx="12" cy="12" r="11" fill={CLS_COLORS[cls]} />
      <circle cx="12" cy="12" r="11" fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth={1} />
      <Glyph cls={cls} />
    </svg>
  );
}
