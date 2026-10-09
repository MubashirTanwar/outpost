"""Thin, thread-safe wrapper around a UCI Stockfish process."""

from __future__ import annotations

import math
import shlex
import threading
from dataclasses import dataclass, field

import chess
import chess.engine

from .config import get_settings

MATE_SCORE = 100_000


@dataclass
class Line:
    """One principal variation, scored from the side to move's point of view."""

    cp: int  # centipawns; mates are mapped to +/- (MATE_SCORE - distance)
    mate: int | None
    pv: list[str] = field(default_factory=list)  # UCI moves

    @property
    def best(self) -> str | None:
        return self.pv[0] if self.pv else None

    def to_dict(self) -> dict:
        return {"cp": self.cp, "mate": self.mate, "pv": self.pv}


def win_percent(cp: int) -> float:
    """Lichess' expected-score curve: centipawns -> winning chances (0-100)."""
    cp = max(-1000, min(1000, cp))
    return 50 + 50 * (2 / (1 + math.exp(-0.00368208 * cp)) - 1)


def _score_to_line(info: chess.engine.InfoDict) -> Line:
    pov = info["score"].relative
    mate = pov.mate()
    cp = pov.score(mate_score=MATE_SCORE)
    return Line(cp=cp, mate=mate, pv=[m.uci() for m in info.get("pv", [])])


class Engine:
    def __init__(self, command: str | None = None):
        settings = get_settings()
        self._command = shlex.split(command or settings.stockfish_path)
        self._lock = threading.Lock()
        self._engine: chess.engine.SimpleEngine | None = None
        self._options = {"Threads": settings.engine_threads, "Hash": settings.engine_hash_mb}

    def _ensure(self) -> chess.engine.SimpleEngine:
        if self._engine is None:
            self._engine = chess.engine.SimpleEngine.popen_uci(self._command)
            for name, value in self._options.items():
                if name in self._engine.options:
                    self._engine.configure({name: value})
        return self._engine

    def analyse(self, board: chess.Board, depth: int, multipv: int = 1) -> list[Line]:
        if board.is_game_over():
            return [_terminal_line(board)]
        with self._lock:
            try:
                infos = self._ensure().analyse(board, chess.engine.Limit(depth=depth), multipv=multipv)
            except (chess.engine.EngineTerminatedError, chess.engine.EngineError):
                # Restart once on a crashed engine process.
                self._engine = None
                infos = self._ensure().analyse(board, chess.engine.Limit(depth=depth), multipv=multipv)
        return [_score_to_line(info) for info in infos]

    def available(self) -> bool:
        try:
            with self._lock:
                self._ensure()
            return True
        except (OSError, chess.engine.EngineError):
            return False

    def close(self) -> None:
        with self._lock:
            if self._engine is not None:
                self._engine.quit()
                self._engine = None


def _terminal_line(board: chess.Board) -> Line:
    if board.is_checkmate():
        # Side to move is mated.
        return Line(cp=-MATE_SCORE, mate=0, pv=[])
    return Line(cp=0, mate=None, pv=[])


_engine: Engine | None = None


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = Engine()
    return _engine
