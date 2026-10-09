"use client";

import { Chess, type Square } from "chess.js";
import { useMemo, useState } from "react";
import { Chessboard } from "react-chessboard";
import type { Classification } from "@/lib/types";
import { ClassificationIcon } from "./ClassificationIcon";

export type Arrow = [Square, Square, string?];

export interface BoardProps {
  fen: string;
  orientation?: "white" | "black";
  /** Return true if the move was accepted. Omit to make the board read-only. */
  onMove?: (from: Square, to: Square, promotion?: string) => boolean;
  lastMove?: { from: string; to: string } | null;
  arrows?: Arrow[];
  badge?: { square: string; cls: Classification } | null;
  highlights?: Record<string, string>;
  id?: string;
}

const LIGHT = "#edd6b0";
const DARK = "#b88762";
const LAST_MOVE = "rgba(255, 255, 51, 0.45)";
const SELECTED = "rgba(255, 255, 51, 0.6)";

function squarePosition(square: string, orientation: "white" | "black") {
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1], 10) - 1;
  const col = orientation === "white" ? file : 7 - file;
  const row = orientation === "white" ? 7 - rank : rank;
  return { left: `${col * 12.5}%`, top: `${row * 12.5}%` };
}

export function Board({ fen, orientation = "white", onMove, lastMove, arrows = [], badge, highlights = {}, id = "board" }: BoardProps) {
  const [selected, setSelected] = useState<Square | null>(null);
  const chess = useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return new Chess();
    }
  }, [fen]);

  const targets = useMemo(() => {
    if (!selected) return [] as { to: Square; capture: boolean }[];
    return chess.moves({ square: selected, verbose: true }).map((m) => ({ to: m.to as Square, capture: !!m.captured }));
  }, [chess, selected]);

  const squareStyles = useMemo(() => {
    const s: Record<string, React.CSSProperties> = {};
    if (lastMove) {
      s[lastMove.from] = { background: LAST_MOVE };
      s[lastMove.to] = { background: LAST_MOVE };
    }
    if (chess.inCheck()) {
      const king = chess.findPiece({ type: "k", color: chess.turn() })[0];
      if (king) s[king] = { ...s[king], background: "radial-gradient(circle, rgba(255,0,0,0.85) 0%, rgba(231,0,0,0.5) 40%, rgba(169,0,0,0) 75%)" };
    }
    for (const [sq, color] of Object.entries(highlights)) s[sq] = { ...s[sq], background: color };
    if (selected) s[selected] = { ...s[selected], background: SELECTED };
    for (const t of targets) {
      s[t.to] = {
        ...s[t.to],
        background: t.capture
          ? "radial-gradient(circle, transparent 58%, rgba(0,0,0,0.16) 59%)"
          : "radial-gradient(circle, rgba(0,0,0,0.16) 24%, transparent 25%)",
      };
    }
    return s;
  }, [chess, lastMove, highlights, selected, targets]);

  const tryMove = (from: Square, to: Square, promotion?: string) => {
    if (!onMove) return false;
    const ok = onMove(from, to, promotion);
    setSelected(null);
    return ok;
  };

  const onSquareClick = (square: Square) => {
    if (!onMove) return;
    if (selected && targets.some((t) => t.to === square)) {
      const piece = chess.get(selected);
      const promo = piece?.type === "p" && (square[1] === "8" || square[1] === "1") ? "q" : undefined;
      tryMove(selected, square, promo);
      return;
    }
    const piece = chess.get(square);
    setSelected(piece && piece.color === chess.turn() ? square : null);
  };

  return (
    <div className="relative w-full select-none" style={{ aspectRatio: "1 / 1" }}>
      <Chessboard
        id={id}
        position={fen}
        boardOrientation={orientation}
        arePiecesDraggable={!!onMove}
        animationDuration={200}
        onPieceDrop={(from, to, piece) => {
          const promo = piece[1]?.toLowerCase();
          const isPromo = chess.get(from)?.type === "p" && (to[1] === "8" || to[1] === "1");
          return tryMove(from, to, isPromo ? (promo === "p" ? "q" : promo) : undefined);
        }}
        onPromotionPieceSelect={(piece, from, to) => {
          if (!piece || !from || !to) return false;
          return tryMove(from, to, piece[1].toLowerCase());
        }}
        onPieceDragBegin={(_, sq) => {
          const p = chess.get(sq);
          setSelected(p && p.color === chess.turn() ? sq : null);
        }}
        onSquareClick={onSquareClick}
        customArrows={arrows as never}
        customSquareStyles={squareStyles}
        customDarkSquareStyle={{ backgroundColor: DARK }}
        customLightSquareStyle={{ backgroundColor: LIGHT }}
        customBoardStyle={{ borderRadius: "3px", boxShadow: "0 6px 18px rgba(0,0,0,0.45)" }}
        customNotationStyle={{ fontWeight: 700, fontSize: "11px" }}
        customDropSquareStyle={{ boxShadow: "inset 0 0 0 4px rgba(255,255,255,0.65)" }}
      />
      {badge && (
        <div
          key={`${badge.square}-${badge.cls}`}
          className="pointer-events-none absolute z-10 animate-pop"
          style={{ ...squarePosition(badge.square, orientation), width: "12.5%", height: "12.5%" }}
        >
          <div className="absolute -right-[18%] -top-[18%] w-[52%] drop-shadow-md">
            <ClassificationIcon cls={badge.cls} size={64} className="h-auto w-full" />
          </div>
        </div>
      )}
    </div>
  );
}
