"""Find popular opponent moves the courses don't cover yet, using the Lichess opening explorer.

    python courses/coverage.py                       # all courses, club ratings, moves played >= 5%
    python courses/coverage.py --course caro-kann --min-share 3 --ratings 1600,1800,2000
    LICHESS_TOKEN=lip_... python courses/coverage.py # the explorer may require a (free) token

For every position in a course where it's the opponent's turn, it asks Lichess which moves
real players make there, and lists the ones with a meaningful share that no line answers.
Add lines for those to the .course file, then rebuild with build.py.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

import chess
import httpx

sys.path.insert(0, str(Path(__file__).parent))
from build import build_course, position_key  # noqa: E402

EXPLORER = "https://explorer.lichess.ovh/lichess"


def opponent_positions(course: dict) -> dict[str, tuple[str, set[str], str]]:
    """position key -> (fen, opponent moves the course covers, a line id that reaches it)."""
    learner = chess.WHITE if course["color"] == "white" else chess.BLACK
    out: dict[str, tuple[str, set[str], str]] = {}
    for chapter in course["chapters"]:
        for line in chapter["lines"]:
            board = chess.Board()
            for mv in line["moves"]:
                if board.turn != learner:
                    key = position_key(board)
                    fen, covered, lid = out.get(key, (board.fen(), set(), line["id"]))
                    covered.add(mv["san"])
                    out[key] = (fen, covered, lid)
                board.push_uci(mv["uci"])
            # The position after the line's last (learner) move is the opponent's turn too.
            out.setdefault(position_key(board), (board.fen(), set(), line["id"]))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--course", action="append", help="course id(s); default all")
    ap.add_argument("--ratings", default="1200,1400,1600,1800,2000")
    ap.add_argument("--speeds", default="blitz,rapid,classical")
    ap.add_argument("--min-share", type=float, default=5.0, help="percent of games")
    ap.add_argument("--min-games", type=int, default=500)
    ap.add_argument("--include-line-ends", action="store_true", help="also report moves after each line ends")
    args = ap.parse_args()

    headers = {"User-Agent": "chess-coach course coverage check"}
    if token := os.environ.get("LICHESS_TOKEN"):
        headers["Authorization"] = f"Bearer {token}"
    client = httpx.Client(headers=headers, timeout=30)

    paths = sorted(Path(__file__).parent.glob("*.course"))
    for path in paths:
        course = build_course(path)
        if args.course and course["id"] not in args.course:
            continue
        print(f"\n== {course['name']} ==")
        gaps = 0
        for key, (fen, covered, line_id) in opponent_positions(course).items():
            if not covered and not args.include_line_ends:
                continue
            resp = client.get(EXPLORER, params={"fen": fen, "ratings": args.ratings, "speeds": args.speeds, "moves": 12})
            if resp.status_code == 429:
                time.sleep(60)
                resp = client.get(EXPLORER, params={"fen": fen, "ratings": args.ratings, "speeds": args.speeds, "moves": 12})
            if resp.status_code == 401:
                print("The explorer needs a token: set LICHESS_TOKEN (https://lichess.org/account/oauth/token)")
                return 1
            resp.raise_for_status()
            data = resp.json()
            total = sum(m["white"] + m["draws"] + m["black"] for m in data.get("moves", []))
            if total < args.min_games:
                continue
            for m in data["moves"]:
                n = m["white"] + m["draws"] + m["black"]
                share = 100 * n / total
                if share >= args.min_share and m["san"] not in covered:
                    gaps += 1
                    print(f"  {share:5.1f}%  {m['san']:7} after line '{line_id}'  fen: {fen}")
            time.sleep(0.5)  # be polite to the public API
        print(f"  {gaps} uncovered popular moves" if gaps else "  fully covered at this threshold")
    return 0


if __name__ == "__main__":
    sys.exit(main())
