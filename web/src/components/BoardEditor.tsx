"use client";

import { Eraser, FlipVertical2, Hand, Play, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Chessboard, ChessboardDnDProvider, SparePiece } from "react-chessboard";
import { DARK, LIGHT } from "@/components/Board";
import {
  EMPTY_SETUP,
  START_SETUP,
  possibleCastling,
  setupFromFen,
  setupToFen,
  validateSetup,
  type PieceCode,
  type Setup,
} from "@/lib/position";

const PIECES = ["K", "Q", "R", "B", "N", "P"] as const;
type Tool = PieceCode | "move" | "erase";

/**
 * Set up any position: drag pieces from the trays onto the board, drag them around, drag them off
 * to remove them; or pick a piece (or the eraser) and tap squares. Then choose who moves and castling.
 */
export function BoardEditor({ initialFen, onDone, onCancel }: { initialFen: string; onDone: (fen: string) => void; onCancel: () => void }) {
  const [setup, setSetup] = useState<Setup>(() => setupFromFen(initialFen));
  const [tool, setTool] = useState<Tool>("move");
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [fenText, setFenText] = useState<string | null>(null); // while the FEN box is being edited
  const [boardWidth, setBoardWidth] = useState(560);
  // The trays' pieces match the board's squares, so follow the board's width.
  const boardBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = boardBox.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoardWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fen = setupToFen(setup);
  const errors = useMemo(() => validateSetup(setup), [setup]);
  const canCastle = possibleCastling(setup.placement);

  const place = (square: string, piece: PieceCode | null) =>
    setSetup((s) => {
      const placement = { ...s.placement };
      if (piece) placement[square] = piece;
      else delete placement[square];
      return { ...s, placement };
    });

  const tray = (color: "w" | "b") => (
    <div className="flex flex-wrap items-center justify-center gap-1 rounded-md bg-panel2 p-1.5">
      {PIECES.map((p) => {
        const code = `${color}${p}` as PieceCode;
        return (
          <button
            key={code}
            type="button"
            onClick={() => setTool(code)}
            aria-label={`${color === "w" ? "White" : "Black"} ${{ K: "king", Q: "queen", R: "rook", B: "bishop", N: "knight", P: "pawn" }[p]}`}
            aria-pressed={tool === code}
            className={`rounded-md p-0.5 ${tool === code ? "bg-brand/40 ring-2 ring-brand" : "hover:bg-[#3c3a37]"}`}
          >
            <SparePiece piece={code} width={Math.round(boardWidth / 10)} dndId="editor" />
          </button>
        );
      })}
    </div>
  );

  const toolButton = (t: Tool, icon: React.ReactNode, label: string) => (
    <button
      type="button"
      onClick={() => setTool(t)}
      aria-pressed={tool === t}
      className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-bold ${tool === t ? "bg-brand/30 text-white ring-2 ring-brand" : "bg-panel2 text-soft hover:text-white"}`}
    >
      {icon} {label}
    </button>
  );

  return (
    <ChessboardDnDProvider>
      <div className="mx-auto flex max-w-[1250px] flex-col gap-5 p-3 lg:flex-row lg:p-5">
        <div className="mx-auto flex w-full max-w-[min(80vh,640px)] flex-col gap-2 lg:flex-1">
          {tray(orientation === "white" ? "b" : "w")}
          <div className="w-full" ref={boardBox}>
            <Chessboard
              id="editor"
              position={setup.placement as never}
              boardOrientation={orientation}
              arePiecesDraggable
              dropOffBoardAction="trash"
              onPieceDrop={(from, to, piece) => {
                setSetup((s) => {
                  const placement = { ...s.placement };
                  delete placement[from];
                  placement[to] = piece as PieceCode;
                  return { ...s, placement };
                });
                return true;
              }}
              onSparePieceDrop={(piece, square) => {
                place(square, piece as PieceCode);
                return true;
              }}
              onPieceDropOffBoard={(square) => place(square, null)}
              onSquareClick={(square, piece) => {
                if (tool === "erase") place(square, null);
                else if (tool !== "move") place(square, piece === tool ? null : tool); // tap again to remove
              }}
              customDarkSquareStyle={{ backgroundColor: DARK }}
              customLightSquareStyle={{ backgroundColor: LIGHT }}
              customBoardStyle={{ borderRadius: "3px", boxShadow: "0 6px 18px rgba(0,0,0,0.45)" }}
              customNotationStyle={{ fontWeight: 700, fontSize: "11px" }}
            />
          </div>
          {tray(orientation === "white" ? "w" : "b")}
        </div>

        <div className="flex w-full flex-col gap-4 lg:w-[400px]">
          <div className="card p-4">
            <h2 className="text-lg font-extrabold">Set up a position</h2>
            <p className="mb-3 text-sm text-muted">
              Drag pieces from the trays, move them around, drag them off the board to remove them. Or pick a piece and tap squares.
            </p>
            <div className="mb-4 flex flex-wrap gap-2">
              {toolButton("move", <Hand size={16} />, "Drag")}
              {toolButton("erase", <Eraser size={16} />, "Erase")}
            </div>

            <div className="mb-1 text-xs font-bold uppercase text-muted">To move</div>
            <div className="mb-4 flex rounded-lg bg-panel2 p-1" role="radiogroup" aria-label="Side to move">
              {(["w", "b"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={setup.turn === t}
                  onClick={() => setSetup((s) => ({ ...s, turn: t }))}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-md py-1.5 text-sm font-bold ${setup.turn === t ? "bg-[#3c3a37] text-white" : "text-muted hover:text-white"}`}
                >
                  <span className={`h-3 w-3 rounded-sm ${t === "w" ? "bg-white" : "bg-[#1a1a1a] ring-1 ring-[#666]"}`} />
                  {t === "w" ? "White" : "Black"}
                </button>
              ))}
            </div>

            <div className="mb-1 text-xs font-bold uppercase text-muted">Castling</div>
            <div className="mb-4 grid grid-cols-2 gap-1.5 text-sm">
              {(
                [
                  ["K", "White O-O"],
                  ["Q", "White O-O-O"],
                  ["k", "Black O-O"],
                  ["q", "Black O-O-O"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className={`flex items-center gap-2 ${canCastle[k] ? "" : "opacity-40"}`} title={canCastle[k] ? "" : "King and rook must be on their starting squares"}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[#81b64c]"
                    disabled={!canCastle[k]}
                    checked={canCastle[k] && setup.castling[k]}
                    onChange={(e) => setSetup((s) => ({ ...s, castling: { ...s.castling, [k]: e.target.checked } }))}
                  />
                  {label}
                </label>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={() => setSetup(START_SETUP)}>
                <RotateCcw size={16} /> Start position
              </button>
              <button type="button" className="btn-secondary" onClick={() => setSetup(EMPTY_SETUP)}>
                <Trash2 size={16} /> Clear
              </button>
              <button type="button" className="btn-secondary" onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))}>
                <FlipVertical2 size={16} /> Flip
              </button>
            </div>
          </div>

          <div className="card p-4">
            <label htmlFor="editor-fen" className="mb-1 block text-xs font-bold uppercase text-muted">
              FEN
            </label>
            <input
              id="editor-fen"
              className="input w-full font-mono text-xs"
              value={fenText ?? fen}
              onChange={(e) => {
                setFenText(e.target.value);
                // Apply it once the board part is well formed (8 ranks of pieces and digits).
                if (/^([pnbrqkPNBRQK1-8]+\/){7}[pnbrqkPNBRQK1-8]+(\s|$)/.test(e.target.value.trim())) setSetup(setupFromFen(e.target.value));
              }}
              onBlur={() => setFenText(null)}
              spellCheck={false}
            />
            {errors.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm text-[#ff8a7a]">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex gap-2">
              <button type="button" className="btn-primary flex-1" disabled={errors.length > 0} onClick={() => onDone(fen)}>
                <Play size={18} /> Analyse this position
              </button>
              <button type="button" className="btn-secondary" onClick={onCancel} aria-label="Cancel">
                <X size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </ChessboardDnDProvider>
  );
}
