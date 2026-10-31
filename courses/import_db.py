"""Import the opening courses from a course database (SQLite) into the app's course data.

    python courses/import_db.py path/to/chess.db

Reads courses -> chapters -> studies -> variations (with their moves), checks every move with
python-chess, and writes the app's course data for the backend and the web app:

    backend/app/data/courses.json
    web/src/data/courses.json

Run it again whenever the database changes; it replaces the previous import. Commit both files to
publish the courses on the site.

Structure in the app: course -> chapters -> lines, where each line remembers its study, so the
course page shows chapter -> study -> lines. Each line is named after the move where it branches
off the study's earlier lines ("Main line" for the first one).
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from pathlib import Path

import chess

ROOT = Path(__file__).resolve().parents[1]
OUTPUTS = [ROOT / "backend" / "app" / "data" / "courses.json", ROOT / "web" / "src" / "data" / "courses.json"]
START = chess.STARTING_FEN


def slug(name: str, taken: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "course"
    out, n = base, 2
    while out in taken:
        out, n = f"{base}-{n}", n + 1
    taken.add(out)
    return out


def move_label(ply: int, san: str) -> str:
    """'9.Bd2' for White's move at ply 16, '8...Qb6' for Black's at ply 15."""
    number = ply // 2 + 1
    return f"{number}.{san}" if ply % 2 == 0 else f"{number}...{san}"


def tagline(description: str) -> str:
    first = re.split(r"(?<=[.!?])\s", description.strip(), maxsplit=1)[0] if description else ""
    return first if len(first) <= 140 else first[:137].rstrip() + "..."


def position_key(board: chess.Board) -> str:
    return " ".join(board.fen().split()[:4])


def load(db_path: str) -> tuple[list[dict], list[str]]:
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    problems: list[str] = []
    courses: list[dict] = []
    taken: set[str] = set()
    for c in con.execute("select * from courses order by color desc, name"):
        color = {"W": "white", "B": "black"}.get(c["color"] or "")
        if not color:
            problems.append(f"{c['name']}: no side (color), skipped")
            continue
        learner = chess.WHITE if color == "white" else chess.BLACK
        course_id = slug(c["name"], taken)
        chapters, learner_positions = [], set()
        for ch in con.execute("select * from chapters where course_id = ? order by idx", (c["id"],)):
            lines = []
            for st in con.execute("select * from studies where chapter_id = ? order by idx", (ch["id"],)):
                study_name = st["name"].strip()
                earlier: list[list[str]] = []
                for v in con.execute("select * from variations where study_id = ? order by idx, id", (st["id"],)):
                    rows = con.execute("select ply, san, fen from variation_moves where variation_id = ? order by ply", (v["id"],)).fetchall()
                    board = chess.Board(v["start_fen"] or START)
                    if board.fen() != START:
                        problems.append(f"{c['name']} / {study_name}: line {v['id']} doesn't start from the initial position, skipped")
                        continue
                    moves, sans, ok = [], [], True
                    for r in rows:
                        # Compare piece placement, side to move and castling: the database always writes
                        # the en-passant square after a double step, python-chess only when it's capturable.
                        if r["fen"].split()[:3] != board.fen().split()[:3]:
                            ok = False
                            break
                        try:
                            mv = board.parse_san(r["san"])
                        except ValueError:
                            ok = False
                            break
                        if board.turn == learner:
                            learner_positions.add(position_key(board))
                        san = board.san(mv)
                        board.push(mv)
                        moves.append({"san": san, "uci": mv.uci(), "fen": board.fen(), "note": None})
                        sans.append(san)
                    if not ok or not moves:
                        problems.append(f"{c['name']} / {study_name}: line {v['id']} has an illegal or broken move list, skipped")
                        continue
                    # Name the line after the move where it leaves the study's earlier lines.
                    branch = max((next((i for i, (a, b) in enumerate(zip(sans, e)) if a != b), min(len(sans), len(e))) for e in earlier), default=None)
                    label = "Main line" if branch is None else move_label(branch, sans[branch]) if branch < len(sans) else f"Short line ({len(sans)} moves)"
                    earlier.append(sans)
                    lines.append({"id": v["id"], "name": f"{study_name}: {label}" if label != "Main line" else study_name,
                                  "label": label, "study": study_name, "studyId": st["id"], "moves": moves})
            if lines:
                chapters.append({"id": ch["id"], "title": ch["name"].strip(), "intro": "", "lines": lines, "quizzes": []})
        if not chapters:
            problems.append(f"{c['name']}: no lines yet, skipped")
            continue
        n_lines = sum(len(ch["lines"]) for ch in chapters)
        tags = [r[0] for r in con.execute("select tag from course_tags where course_id = ?", (c["id"],))]
        courses.append({
            "id": course_id, "name": c["name"].strip(), "shortName": (c["short_name"] or "").strip() or None,
            "color": color, "eco": [], "tags": tags, "tagline": tagline(c["description"] or ""),
            "description": (c["description"] or "").strip(), "chapters": chapters,
            "stats": {"chapters": len(chapters), "lines": n_lines, "positions": len(learner_positions), "quizzes": 0},
        })
    return courses, problems


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("db", help="path to the course database (SQLite)")
    args = ap.parse_args()
    courses, problems = load(args.db)
    for p in problems:
        print("note:", p, file=sys.stderr)
    payload = json.dumps({"courses": courses}, ensure_ascii=False, separators=(",", ":")) + "\n"
    for out in OUTPUTS:
        out.write_text(payload)
    total = sum(c["stats"]["lines"] for c in courses)
    print(f"Imported {len(courses)} courses, {sum(c['stats']['chapters'] for c in courses)} chapters, {total} lines.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
