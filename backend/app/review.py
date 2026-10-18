"""chess.com-style game review: per-move classification, accuracy and motif tagging."""

from __future__ import annotations

import io
import json
import math
from dataclasses import asdict, dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Callable

import chess
import chess.pgn

from .engine import Engine, Line, win_percent

PIECE_VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}

# Ordered best -> worst; also the order the UI shows them in.
CLASSIFICATIONS = [
    "brilliant", "great", "best", "excellent", "good", "book", "forced",
    "inaccuracy", "mistake", "miss", "blunder",
]
ERRORS = {"inaccuracy", "mistake", "miss", "blunder"}
BRILLIANT_MAX_WIN = 90  # win % (about +6 pawns) above which a sacrifice is no longer brilliant

DATA_DIR = Path(__file__).parent / "data"


@dataclass
class MoveReview:
    ply: int
    move_number: int
    color: str
    san: str
    uci: str
    fen_before: str
    fen_after: str
    classification: str
    eval_cp: int  # after the move, from White's point of view
    eval_mate: int | None  # after the move, from White's point of view
    win_before: float  # best achievable, mover's point of view
    win_after: float  # mover's point of view
    win_loss: float
    accuracy: float
    best_uci: str | None
    best_san: str | None
    best_line: list[str] = field(default_factory=list)  # SAN
    best_pv: list[str] = field(default_factory=list)  # UCI
    phase: str = "middlegame"
    motifs: list[str] = field(default_factory=list)
    clock: float | None = None


@lru_cache
def opening_book() -> set[tuple[str, ...]]:
    """Every prefix of every bundled opening line, as SAN tuples."""
    lines = json.loads((DATA_DIR / "openings.json").read_text())
    book: set[tuple[str, ...]] = set()
    for line in lines:
        moves = tuple(line["moves"].split())
        for i in range(1, len(moves) + 1):
            book.add(moves[:i])
    return book


def material(board: chess.Board, color: chess.Color) -> int:
    return sum(PIECE_VALUES[p.piece_type] for p in board.piece_map().values() if p.color == color)


def material_diff(board: chess.Board, color: chess.Color) -> int:
    return material(board, color) - material(board, not color)


def game_phase(board: chess.Board, ply: int) -> str:
    non_pawn = sum(
        PIECE_VALUES[p.piece_type]
        for p in board.piece_map().values()
        if p.piece_type not in (chess.PAWN, chess.KING)
    )
    if non_pawn <= 26:
        return "endgame"
    if ply < 20 and non_pawn >= 54:
        return "opening"
    return "middlegame"


def move_accuracy(win_loss: float) -> float:
    """Lichess per-move accuracy curve."""
    return max(0.0, min(100.0, 103.1668 * math.exp(-0.04354 * win_loss) - 3.1669 + 1))


def game_accuracy(accuracies: list[float]) -> float | None:
    if not accuracies:
        return None
    mean = sum(accuracies) / len(accuracies)
    harmonic = len(accuracies) / sum(1 / max(a, 1.0) for a in accuracies)
    return round((mean + harmonic) / 2, 1)


def _play_line(board: chess.Board, ucis: list[str], plies: int) -> list[chess.Board]:
    """Boards after each of the first `plies` moves of a PV (stops on illegal/short PVs)."""
    out, b = [], board.copy(stack=False)
    for uci in ucis[:plies]:
        move = chess.Move.from_uci(uci)
        if move not in b.legal_moves:
            break
        b.push(move)
        out.append(b.copy(stack=False))
    return out


def _san_line(board: chess.Board, ucis: list[str], plies: int = 6) -> list[str]:
    sans, b = [], board.copy(stack=False)
    for uci in ucis[:plies]:
        move = chess.Move.from_uci(uci)
        if move not in b.legal_moves:
            break
        sans.append(b.san(move))
        b.push(move)
    return sans


def _is_hanging(board: chess.Board, square: chess.Square) -> bool:
    """Is the piece on `square` en prise (attacked and under-defended or attacked by cheaper)?"""
    piece = board.piece_at(square)
    if piece is None or piece.piece_type in (chess.PAWN, chess.KING):
        return False
    attackers = board.attackers(not piece.color, square)
    if not attackers:
        return False
    defenders = board.attackers(piece.color, square)
    cheapest = min(PIECE_VALUES[board.piece_type_at(s)] or 100 for s in attackers)
    return not defenders or cheapest < PIECE_VALUES[piece.piece_type]


def is_sacrifice(board: chess.Board, move: chess.Move, reply_pv: list[str]) -> bool:
    """Does `move` give up at least a minor piece's worth of material (net) that is not won straight back?"""
    mover = board.turn
    base = material_diff(board, mover)
    after = board.copy(stack=False)
    after.push(move)
    line = _play_line(after, reply_pv, 2)
    if len(line) >= 1 and material_diff(line[0], mover) <= base - 2:
        # Opponent took the material; did we immediately win it back?
        if len(line) < 2 or material_diff(line[1], mover) <= base - 2:
            return True
    # Offered but declined: the moved piece is left en prise and taking it would net material.
    value = PIECE_VALUES[board.piece_type_at(move.from_square)]
    return value >= 3 and _is_hanging(after, move.to_square) and material_diff(after, mover) - value <= base - 2


def _pinned_pieces(board: chess.Board, color: chess.Color) -> set[chess.Square]:
    return {
        sq for sq, p in board.piece_map().items()
        if p.color == color and p.piece_type not in (chess.PAWN, chess.KING) and board.is_pinned(color, sq)
    }


def tag_motifs(
    board: chess.Board,
    move: chess.Move,
    best: Line,
    after_best: Line,
    phase: str,
    clock: float | None,
) -> list[str]:
    """Explain *why* a bad move was bad, in tags the graph store can aggregate across games."""
    mover = board.turn
    motifs: list[str] = [f"{phase}_phase"]
    after = board.copy(stack=False)
    after.push(move)
    reply_line = _play_line(after, after_best.pv, 3)
    base = material_diff(board, mover)

    if best.mate is not None and best.mate > 0 and not (after_best.mate is not None and after_best.mate < 0):
        motifs.append("missed_mate")
    if after_best.mate is not None and after_best.mate > 0:
        motifs.append("allowed_mate")
        king = after.king(mover)
        if king is not None and chess.square_rank(king) == (0 if mover == chess.WHITE else 7):
            motifs.append("back_rank")

    if reply_line:
        reply = chess.Move.from_uci(after_best.pv[0])
        if after.is_capture(reply) and material_diff(reply_line[-1], mover) <= base - 2:
            motifs.append("hanging_piece")
        replied = reply_line[0]
        targets = []
        for sq in replied.attacks(reply.to_square):
            p = replied.piece_at(sq)
            if p and p.color == mover and (p.piece_type == chess.KING or PIECE_VALUES[p.piece_type] >= 3):
                targets.append(sq)
        if len(targets) >= 2:
            motifs.append("fork")
        if _pinned_pieces(replied, mover) - _pinned_pieces(after, mover):
            motifs.append("pin")

    best_line = _play_line(board, best.pv, 3)
    if best_line and material_diff(best_line[-1], mover) >= base + 2 and "missed_mate" not in motifs:
        motifs.append("missed_tactic")

    piece = board.piece_at(move.from_square)
    king_sq = board.king(mover)
    if piece and piece.piece_type == chess.PAWN and king_sq is not None:
        kfile, pfile = chess.square_file(king_sq), chess.square_file(move.from_square)
        if abs(kfile - pfile) <= 1 and kfile in (0, 1, 2, 5, 6, 7):
            motifs.append("weakened_king")

    if clock is not None and clock < 30:
        motifs.append("time_pressure")
    return motifs


def classify(
    *,
    win_before: float,
    win_after: float,
    played_best: bool,
    second_best_win: float | None,
    sacrifice: bool,
    is_book: bool,
    only_move: bool,
    is_recapture: bool,
    gives_mate: bool = False,
    prev_opponent_class: str | None,
) -> str:
    loss = max(0.0, win_before - win_after)
    if only_move:
        return "forced"
    if is_book:
        return "book"
    # Like chess.com: a sound sacrifice that leaves you at least equal, but not when you were already
    # completely winning (sacrificing for fun at +6 isn't brilliant).
    if loss < 2 and sacrifice and win_after >= 50 and win_before < BRILLIANT_MAX_WIN:
        return "brilliant"
    if played_best:
        if (
            not gives_mate
            and win_before < 97
            and second_best_win is not None
            and win_before - second_best_win >= 15
            and second_best_win < 70
            and not is_recapture
        ):
            return "great"
        return "best"
    if loss < 2:
        return "excellent"
    if loss < 5:
        return "good"
    if loss < 10:
        return "inaccuracy"
    cls = "mistake" if loss < 20 else "blunder"
    if prev_opponent_class in {"mistake", "blunder"} and win_before >= 60 and win_after >= 35:
        return "miss"
    return cls


def key_moments(moves: list[dict], player_color: str | None) -> list[int]:
    """The plies worth replaying for one side: its biggest errors, plus its brilliant/great moves."""
    focus = player_color or "white"
    picked = sorted(
        (m for m in moves if m["color"] == focus and (m["classification"] in ERRORS or m["classification"] in {"brilliant", "great"})),
        key=lambda m: -m["win_loss"] if m["classification"] in ERRORS else -100,
    )[:6]
    return sorted(m["ply"] for m in picked)


def review_for(review: dict, player_color: str | None) -> dict:
    """The same analysis seen from one player's side (both players of a game can review it)."""
    if review.get("player_color") == player_color or player_color is None:
        return review
    return {**review, "player_color": player_color, "key_moments": key_moments(review["moves"], player_color)}


def _white_pov(line: Line, turn: chess.Color) -> tuple[int, int | None]:
    sign = 1 if turn == chess.WHITE else -1
    return sign * line.cp, (sign * line.mate if line.mate is not None else None)


def review_pgn(
    pgn: str,
    engine: Engine,
    depth: int = 18,
    player_color: str | None = None,
    progress: Callable[[int, int], None] | None = None,
) -> dict:
    game = chess.pgn.read_game(io.StringIO(pgn))
    if game is None:
        raise ValueError("Could not parse PGN")

    nodes = list(game.mainline())
    boards = [game.board()]
    for node in nodes:
        b = boards[-1].copy(stack=False)
        b.push(node.move)
        boards.append(b)

    analyses: list[list[Line]] = []
    for i, board in enumerate(boards):
        analyses.append(engine.analyse(board, depth=depth, multipv=2))
        if progress:
            progress(i + 1, len(boards))

    book = opening_book()
    sans: list[str] = []
    still_in_book = True
    moves: list[MoveReview] = []
    prev_class: str | None = None

    for i, node in enumerate(nodes):
        board, move = boards[i], node.move
        mover = board.turn
        san = board.san(move)
        sans.append(san)
        best, after_best = analyses[i][0], analyses[i + 1][0]
        second = analyses[i][1] if len(analyses[i]) > 1 else None

        played_best = best.best == move.uci()
        win_before = win_percent(best.cp)
        win_after = win_percent(-after_best.cp)
        if played_best:
            # Depth noise can make the best move look slightly worse than itself.
            win_after = max(win_after, win_before)
        win_before = max(win_before, win_after)
        loss = win_before - win_after

        # A book move that throws the game away is still reported as the error it is.
        in_book = tuple(sans) in book and loss < 5
        heuristic_book = i < 12 and loss < 3
        still_in_book = still_in_book and (in_book or heuristic_book)
        phase = game_phase(board, i)

        prev_move = nodes[i - 1].move if i else None
        is_recapture = bool(
            prev_move
            and board.is_capture(move)
            and prev_move.to_square == move.to_square
            and boards[i - 1].is_capture(prev_move)
        )

        cls = classify(
            win_before=win_before,
            win_after=win_after,
            played_best=played_best,
            second_best_win=win_percent(second.cp) if second else None,
            sacrifice=(loss < 2 and not still_in_book and is_sacrifice(board, move, after_best.pv)),
            is_book=still_in_book,
            only_move=board.legal_moves.count() == 1,
            is_recapture=is_recapture,
            gives_mate=boards[i + 1].is_checkmate(),
            prev_opponent_class=prev_class,
        )

        clock = node.clock()
        motifs = tag_motifs(board, move, best, after_best, phase, clock) if cls in ERRORS else []
        eval_cp, eval_mate = _white_pov(after_best, boards[i + 1].turn)

        moves.append(MoveReview(
            ply=i + 1,
            move_number=i // 2 + 1,
            color="white" if mover == chess.WHITE else "black",
            san=san,
            uci=move.uci(),
            fen_before=board.fen(),
            fen_after=boards[i + 1].fen(),
            classification=cls,
            eval_cp=eval_cp,
            eval_mate=eval_mate,
            win_before=round(win_before, 1),
            win_after=round(win_after, 1),
            win_loss=round(loss, 1),
            accuracy=round(move_accuracy(loss), 1),
            best_uci=best.best,
            best_san=board.san(chess.Move.from_uci(best.best)) if best.best else None,
            best_line=_san_line(board, best.pv),
            best_pv=best.pv[:6],
            phase=phase,
            motifs=motifs,
            clock=clock,
        ))
        prev_class = cls

    start_cp, start_mate = _white_pov(analyses[0][0], boards[0].turn)  # a set-up position may start with Black to move
    summary = {}
    for color in ("white", "black"):
        mine = [m for m in moves if m.color == color]
        counts = {c: 0 for c in CLASSIFICATIONS}
        for m in mine:
            counts[m.classification] += 1
        phases = {}
        for ph in ("opening", "middlegame", "endgame"):
            accs = [m.accuracy for m in mine if m.phase == ph]
            phases[ph] = game_accuracy(accs)
        summary[color] = {
            "accuracy": game_accuracy([m.accuracy for m in mine if m.classification not in {"book", "forced"}]),
            "counts": counts,
            "phase_accuracy": phases,
        }


    headers = dict(game.headers)
    return {
        "headers": headers,
        "player_color": player_color,
        "result": headers.get("Result", "*"),
        "termination": headers.get("Termination"),
        "eco": headers.get("ECO"),
        "start_eval": {"cp": start_cp, "mate": start_mate},
        "summary": summary,
        "moves": [asdict(m) for m in moves],
        "key_moments": key_moments([asdict(m) for m in moves], player_color),
        "depth": depth,
    }
