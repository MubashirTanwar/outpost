"""The opening courses as a repertoire: where did a real game leave the course, and who left it?"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import chess

DATA = Path(__file__).parent / "data" / "courses.json"


def position_key(board: chess.Board) -> str:
    return " ".join(board.fen().split()[:4])


@dataclass
class CourseIndex:
    id: str
    name: str
    color: str
    eco: list[str]
    learner: dict[str, tuple[str, str]]  # position -> (san, line id) when it's the learner's move
    replies: dict[str, dict[str, str]]  # position -> {opponent san: line id} the course covers
    line_names: dict[str, str]


@lru_cache
def courses() -> list[CourseIndex]:
    if not DATA.exists():
        return []
    out = []
    for c in json.loads(DATA.read_text())["courses"]:
        learner_color = chess.WHITE if c["color"] == "white" else chess.BLACK
        idx = CourseIndex(c["id"], c["name"], c["color"], c.get("eco", []), {}, {}, {})
        for ch in c["chapters"]:
            for line in ch["lines"]:
                idx.line_names[line["id"]] = line["name"]
                board = chess.Board()
                for mv in line["moves"]:
                    key = position_key(board)
                    if board.turn == learner_color:
                        idx.learner.setdefault(key, (mv["san"], line["id"]))
                    else:
                        idx.replies.setdefault(key, {}).setdefault(mv["san"], line["id"])
                    board.push_uci(mv["uci"])
        out.append(idx)
    return out


def match_course(eco: str | None, color: str | None) -> CourseIndex | None:
    """The course that covers this ECO code for the given side, if any."""
    for c in courses():
        if c.color == color and eco and eco in c.eco:
            return c
    return None


def check_game(sans: list[str], player_color: str, game_id: str = "", opponent: str = "",
               course_ids: set[str] | None = None) -> dict | None:
    """Follow a game through every course for the player's side and report where it left the
    deepest one: either the player played a different move than the course ("you_deviated"),
    or the opponent played a move the course doesn't cover ("opponent_deviated")."""
    best: dict | None = None
    for c in courses():
        if c.color != player_color or (course_ids is not None and c.id not in course_ids):
            continue
        learner = chess.WHITE if c.color == "white" else chess.BLACK
        board, line_id = chess.Board(), None
        for ply, san in enumerate(sans):
            key = position_key(board)
            note = None
            if board.turn == learner:
                expected = c.learner.get(key)
                if expected is None:
                    break
                line_id = expected[1]
                if san != expected[0]:
                    note = {"kind": "you_deviated", "expected": expected[0]}
            else:
                covered = c.replies.get(key)
                if not covered:
                    break
                if san in covered:
                    line_id = covered[san]
                else:
                    note = {"kind": "opponent_deviated", "expected": None}
            if note:
                if ply >= 2 and (best is None or ply > best["ply"]):
                    best = {
                        **note, "game_id": game_id, "opponent": opponent, "course_id": c.id,
                        "course_name": c.name, "line_id": line_id, "line_name": c.line_names.get(line_id, ""),
                        "ply": ply + 1, "played": san, "fen": board.fen(),
                    }
                break
            try:
                board.push_san(san)
            except ValueError:
                break
    return best
