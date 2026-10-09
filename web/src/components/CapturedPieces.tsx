import type { PieceType } from "@/lib/material";

const GLYPH: Record<PieceType, string> = { q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };

/** chess.com-style strip of pieces a player has captured, plus their material lead. */
export function CapturedPieces({ pieces, color, lead }: { pieces: PieceType[]; color: "white" | "black"; lead: number }) {
  // The captured pieces belong to the opponent, so they're drawn in the opponent's colour.
  const pieceColor = color === "white" ? "#262421" : "#f4f4f4";
  // Dark pieces get a light rim so they read on the dark page, light pieces a dark one.
  const outline = color === "white" ? "0 0 1px #e8e6e3, 0 0 1px #e8e6e3, 0 0 1px #e8e6e3" : "0 0 1px #000, 0 0 1px #000";
  const groups = (["q", "r", "b", "n", "p"] as const).map((t) => pieces.filter((p) => p === t)).filter((g) => g.length);
  if (!groups.length && lead <= 0) return null;
  return (
    <span className="flex items-center gap-1.5 text-[17px] leading-none" aria-label={`Captured: ${pieces.join(" ") || "none"}${lead > 0 ? `, +${lead}` : ""}`}>
      {groups.map((g) => (
        <span key={g[0]} className="flex">
          {g.map((t, i) => (
            <span key={i} style={{ color: pieceColor, textShadow: outline, marginLeft: i ? -7 : 0 }}>
              {GLYPH[t]}
            </span>
          ))}
        </span>
      ))}
      {lead > 0 && <span className="text-xs font-bold text-soft">+{lead}</span>}
    </span>
  );
}
