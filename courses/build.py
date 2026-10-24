"""Build the opening courses from the human-friendly *.course files.

    python courses/build.py            # validate + write JSON for backend and web
    python courses/build.py --engine "stockfish" --depth 16   # also engine-check every repertoire move
    python courses/build.py --dry-run --engine "stockfish" --only london   # check one course, write nothing

Course file format (one key per line, values may continue on following lines):

    course: <id>              name: ...   color: white|black   eco: ...   tagline: ...   description: ...
    chapter: <id>             title: ...  intro: ...
    line: <id>                name: ...   moves: 1.e4 {comment on 1.e4} e5 2.Nf3 ...
    quiz: <line-id> <ply>     q: ...  a: correct answer  w: wrong answer (repeatable)  why: ...

Checks: every move is legal, every quiz position exists, and each position where it's
the learner's turn has exactly one repertoire move across the whole course (so drills
are unambiguous, including transpositions).
"""

from __future__ import annotations

import argparse
import io
import json
import re
import shlex
import sys
from pathlib import Path

import chess
import chess.engine
import chess.pgn

ROOT = Path(__file__).parent
OUTPUTS = [ROOT.parent / "backend" / "app" / "data" / "courses.json", ROOT.parent / "web" / "src" / "data" / "courses.json"]
KEY = re.compile(r"^(course|name|color|eco|tagline|description|chapter|title|intro|line|moves|quiz|q|a|w|why):\s*(.*)$")


class CourseError(ValueError):
    pass


def position_key(board: chess.Board) -> str:
    return " ".join(board.fen().split()[:4])


def parse_file(path: Path) -> dict:
    entries: list[list[str]] = []
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = KEY.match(line)
        if m:
            entries.append([m.group(1), m.group(2).strip()])
        elif entries:
            entries[-1][1] += " " + line
        else:
            raise CourseError(f"{path.name}: text before the first key: {line!r}")

    course: dict = {"chapters": []}
    chapter = target = quiz = None
    for key, value in entries:
        if key == "course":
            course["id"] = value
            target = course
        elif key == "chapter":
            chapter = {"id": value, "lines": [], "quizzes": []}
            course["chapters"].append(chapter)
            target = chapter
        elif key == "line":
            if chapter is None:
                raise CourseError(f"line {value} outside a chapter")
            target = {"id": value}
            chapter["lines"].append(target)
        elif key == "quiz":
            line_id, ply = value.split()
            quiz = {"line": line_id, "ply": int(ply), "wrong": []}
            chapter["quizzes"].append(quiz)
            target = quiz
        elif key in ("q", "a", "w", "why"):
            if quiz is None or target is not quiz:
                raise CourseError(f"{key}: outside a quiz")
            if key == "w":
                quiz["wrong"].append(value)
            else:
                quiz[{"q": "question", "a": "answer", "why": "explanation"}[key]] = value
        else:
            target[key] = value
    return course


def parse_moves(text: str, where: str) -> list[dict]:
    game = chess.pgn.read_game(io.StringIO(text + " *"))
    if game is None or game.errors:
        raise CourseError(f"{where}: {game.errors if game else 'unparseable'}")
    moves, board = [], game.board()
    for node in game.mainline():
        if node.move not in board.legal_moves:
            raise CourseError(f"{where}: illegal move at ply {len(moves) + 1}")
        san = board.san(node.move)
        board.push(node.move)
        moves.append({"san": san, "uci": node.move.uci(), "fen": board.fen(), "note": node.comment.strip() or None})
    if not moves:
        raise CourseError(f"{where}: no moves")
    return moves


def build_course(path: Path) -> dict:
    course = parse_file(path)
    for field in ("id", "name", "color", "tagline", "description"):
        if field not in course:
            raise CourseError(f"{path.name}: missing {field}")
    learner = chess.WHITE if course["color"] == "white" else chess.BLACK
    repertoire: dict[str, tuple[str, str]] = {}  # position -> (san, line id)
    line_ids: dict[str, dict] = {}
    total_moves = 0

    for chapter in course["chapters"]:
        for line in chapter["lines"]:
            where = f"{course['id']}/{line['id']}"
            if line["id"] in line_ids:
                raise CourseError(f"{where}: duplicate line id")
            line["moves"] = parse_moves(line["moves"], where)
            line_ids[line["id"]] = line
            if (len(line["moves"]) % 2 == 1) != (learner == chess.WHITE):
                raise CourseError(f"{where}: a line must end on the learner's move")
            board = chess.Board()
            for i, mv in enumerate(line["moves"]):
                if board.turn == learner:
                    key = position_key(board)
                    known = repertoire.get(key)
                    if known and known[0] != mv["san"]:
                        raise CourseError(
                            f"{where}: plays {mv['san']} at ply {i + 1} but line {known[1]} plays {known[0]} "
                            f"in the same position"
                        )
                    repertoire[key] = (mv["san"], line["id"])
                    total_moves += 1
                board.push_uci(mv["uci"])
        for quiz in chapter["quizzes"]:
            line = line_ids.get(quiz["line"])
            if not line or not 0 < quiz["ply"] <= len(line["moves"]):
                raise CourseError(f"{course['id']}: quiz points at missing {quiz['line']} ply {quiz['ply']}")
            if not quiz.get("question") or not quiz.get("answer") or len(quiz["wrong"]) < 1:
                raise CourseError(f"{course['id']}: incomplete quiz on {quiz['line']}")
            quiz["fen"] = line["moves"][quiz["ply"] - 1]["fen"]
            quiz["id"] = f"{quiz['line']}@{quiz['ply']}"

    course["eco"] = course.get("eco", "").split()
    course["stats"] = {
        "chapters": len(course["chapters"]),
        "lines": len(line_ids),
        "quizzes": sum(len(c["quizzes"]) for c in course["chapters"]),
        "positions": len(repertoire),
    }
    return course


def engine_check(courses: list[dict], command: str, depth: int, threshold: int) -> list[str]:
    """Flag repertoire moves that lose more than `threshold` centipawns versus the engine's choice."""
    engine = chess.engine.SimpleEngine.popen_uci(shlex.split(command))
    problems, seen = [], {}
    try:
        for course in courses:
            learner = chess.WHITE if course["color"] == "white" else chess.BLACK
            for chapter in course["chapters"]:
                for line in chapter["lines"]:
                    board = chess.Board()
                    for i, mv in enumerate(line["moves"]):
                        if board.turn == learner:
                            key = position_key(board) + mv["uci"]
                            if key not in seen:
                                best = engine.analyse(board, chess.engine.Limit(depth=depth))["score"].relative
                                after = board.copy()
                                after.push_uci(mv["uci"])
                                played = -engine.analyse(after, chess.engine.Limit(depth=depth))["score"].relative
                                b, p = best.score(mate_score=10000), played.score(mate_score=10000)
                                seen[key] = (b, p)
                            b, p = seen[key]
                            if b - p > threshold:
                                problems.append(f"{course['id']}/{line['id']} ply {i + 1} {mv['san']}: {p:+} vs best {b:+}")
                        board.push_uci(mv["uci"])
                    print(f"  checked {course['id']}/{line['id']}", file=sys.stderr)
    finally:
        engine.quit()
    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", help="UCI engine command for soundness checks")
    ap.add_argument("--depth", type=int, default=14)
    ap.add_argument("--threshold", type=int, default=70)
    ap.add_argument("--check", action="store_true", help="fail if the JSON outputs are out of date")
    ap.add_argument("--only", nargs="*", help="limit the engine check to these course ids")
    ap.add_argument("--dry-run", action="store_true", help="validate (and engine-check) without writing the JSON outputs")
    args = ap.parse_args()

    courses = [build_course(p) for p in sorted(ROOT.glob("*.course"))]
    order = {"white": 0, "black": 1}
    courses.sort(key=lambda c: (order[c["color"]], c.get("order", c["id"])))
    for c in courses:
        s = c["stats"]
        print(f"{c['id']:14} {c['color']:5}  {s['chapters']} chapters  {s['lines']:3} lines  "
              f"{s['positions']:3} positions  {s['quizzes']} quizzes")

    if args.engine:
        checked = [c for c in courses if not args.only or c["id"] in args.only]
        problems = engine_check(checked, args.engine, args.depth, args.threshold)
        for p in problems:
            print("ENGINE:", p)
        if problems:
            return 1

    if args.dry_run:
        return 0
    payload = json.dumps({"courses": courses}, ensure_ascii=False, separators=(",", ":")) + "\n"
    for out in OUTPUTS:
        if args.check:
            if not out.exists() or out.read_text() != payload:
                print(f"{out} is out of date: run python courses/build.py", file=sys.stderr)
                return 1
        else:
            out.write_text(payload)
    return 0


if __name__ == "__main__":
    sys.exit(main())
