import os
import shlex
import shutil

import chess
import pytest

from app import graph_store
from app.engine import Engine, Line
from app.review import material_diff

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def fixture_pgn(name: str) -> str:
    with open(os.path.join(FIXTURES, name)) as f:
        return f.read()


class FakeEngine:
    """Material-only 'engine': deterministic and fast, good enough to drive the pipeline."""

    def analyse(self, board: chess.Board, depth: int, multipv: int = 1) -> list[Line]:
        if board.is_checkmate():
            return [Line(cp=-100_000, mate=0, pv=[])]
        scored = []
        for move in board.legal_moves:
            b = board.copy(stack=False)
            b.push(move)
            if b.is_checkmate():
                scored.append((100_000 - 1, 1, move))
                continue
            # Assume the opponent recaptures the most valuable thing it can.
            worst = material_diff(b, board.turn)
            for reply in b.legal_moves:
                if b.is_capture(reply):
                    b2 = b.copy(stack=False)
                    b2.push(reply)
                    worst = min(worst, material_diff(b2, board.turn))
            scored.append((worst * 100, None, move))
        scored.sort(key=lambda s: -s[0])
        return [Line(cp=cp, mate=mate, pv=[m.uci()]) for cp, mate, m in scored[:multipv]]


@pytest.fixture
def fake_engine():
    return FakeEngine()


@pytest.fixture
def memory_store(monkeypatch):
    store = graph_store.MemoryGraphStore()
    monkeypatch.setattr(graph_store, "_store", store)
    return store


def real_engine_command() -> str | None:
    cmd = os.environ.get("STOCKFISH_PATH") or "stockfish"
    return cmd if shutil.which(shlex.split(cmd)[0]) else None


@pytest.fixture(scope="session")
def real_engine():
    cmd = real_engine_command()
    if not cmd:
        pytest.skip("Stockfish not installed")
    engine = Engine(cmd)
    if not engine.available():
        pytest.skip("Stockfish failed to start")
    yield engine
    engine.close()
