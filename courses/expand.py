"""Draft new course lines from real games (Lichess opening explorer), checked by Stockfish.

    python courses/expand.py --course caro-kann                     # draft lines for one course
    python courses/expand.py --all --min-share 4 --depth 22         # every course
    LICHESS_TOKEN=lip_... python courses/expand.py --all            # if the explorer asks for a token

For every position in a course where it's the opponent's move, it looks up what club players
actually play. Each popular reply (>= --min-share % of games) that the course doesn't answer
becomes a new draft line: the reply, then your best practical move (the most popular move
that Stockfish rates within --tolerance of its own choice), and so on until --plies deep or
the position runs out of games. Drafts are written to courses/drafts/<course>.course in the
normal format, with the stats as comments, so you can review them and paste them into the
real course file. Nothing in the course itself is changed.
"""

from __future__ import annotations

import argparse
import os
import shlex
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import chess
import chess.engine
import httpx

sys.path.insert(0, str(Path(__file__).parent))
from build import build_course, position_key  # noqa: E402

EXPLORER = "https://explorer.lichess.ovh/lichess"
DRAFTS = Path(__file__).parent / "drafts"


@dataclass
class ExplorerMove:
    san: str
    uci: str
    games: int


Explorer = Callable[[str], list[ExplorerMove]]
Evaluator = Callable[[chess.Board, list[str]], dict[str, int]]  # board, candidate ucis -> cp for the mover


def lichess_explorer(ratings: str, speeds: str) -> Explorer:
    headers = {"User-Agent": "outpost course expansion"}
    if token := os.environ.get("LICHESS_TOKEN"):
        headers["Authorization"] = f"Bearer {token}"
    client = httpx.Client(headers=headers, timeout=30)

    def lookup(fen: str) -> list[ExplorerMove]:
        for _ in range(3):
            resp = client.get(EXPLORER, params={"fen": fen, "ratings": ratings, "speeds": speeds, "moves": 12})
            if resp.status_code == 429:
                time.sleep(60)
                continue
            if resp.status_code == 401:
                sys.exit("The explorer needs a token: set LICHESS_TOKEN (https://lichess.org/account/oauth/token)")
            resp.raise_for_status()
            time.sleep(0.5)
            return [ExplorerMove(m["san"], m["uci"], m["white"] + m["draws"] + m["black"]) for m in resp.json().get("moves", [])]
        return []

    return lookup


def stockfish_evaluator(command: str, depth: int) -> tuple[Evaluator, Callable[[], None]]:
    engine = chess.engine.SimpleEngine.popen_uci(shlex.split(command))

    def evaluate(board: chess.Board, ucis: list[str]) -> dict[str, int]:
        moves = [chess.Move.from_uci(u) for u in ucis if chess.Move.from_uci(u) in board.legal_moves]
        if not moves:
            return {}
        infos = engine.analyse(board, chess.engine.Limit(depth=depth), multipv=len(moves), root_moves=moves)
        return {i["pv"][0].uci(): i["score"].relative.score(mate_score=10000) for i in infos if i.get("pv")}

    return evaluate, engine.quit


def pick_learner_move(board: chess.Board, candidates: list[ExplorerMove], evaluate: Evaluator, tolerance: int) -> ExplorerMove | None:
    """The most popular move that the engine rates within `tolerance` of the best candidate."""
    if not candidates:
        return None
    scores = evaluate(board, [c.uci for c in candidates[:6]])
    if not scores:
        return None
    best = max(scores.values())
    good = [c for c in candidates if c.uci in scores and scores[c.uci] >= best - tolerance]
    return max(good, key=lambda c: c.games) if good else None


def draft_lines(course: dict, explore: Explorer, evaluate: Evaluator, *, min_share: float, min_games: int,
                plies: int, tolerance: int, max_lines: int) -> list[dict]:
    learner = chess.WHITE if course["color"] == "white" else chess.BLACK
    covered: dict[str, set[str]] = {}  # opponent-to-move position -> replies the course answers
    known_learner: dict[str, str] = {}  # learner-to-move position -> repertoire move
    starts: dict[str, tuple[chess.Board, str]] = {}  # opponent positions to look at, with a line that reaches them
    for chapter in course["chapters"]:
        for line in chapter["lines"]:
            board = chess.Board()
            for mv in line["moves"]:
                key = position_key(board)
                if board.turn == learner:
                    known_learner[key] = mv["san"]
                else:
                    covered.setdefault(key, set()).add(mv["san"])
                    starts.setdefault(key, (board.copy(), line["id"]))
                board.push_uci(mv["uci"])
            starts.setdefault(position_key(board), (board.copy(), line["id"]))

    drafts: list[dict] = []
    for key, (start, via) in starts.items():
        if len(drafts) >= max_lines:
            break
        replies = explore(start.fen())
        total = sum(m.games for m in replies)
        if total < min_games:
            continue
        for reply in replies:
            share = 100 * reply.games / total
            if share < min_share or reply.san in covered.get(key, set()):
                continue
            board = start.copy()
            sans = [board.san(chess.Move.from_uci(reply.uci))]
            board.push_uci(reply.uci)
            notes = [f"{share:.0f}% of {total} games"]
            # Follow the most popular continuation, choosing engine-approved moves for the learner.
            while len(sans) < plies:
                moves = explore(board.fen())
                n = sum(m.games for m in moves)
                if n < min_games:
                    break
                if board.turn == learner:
                    known = known_learner.get(position_key(board))
                    pick = next((m for m in moves if m.san == known), None) or pick_learner_move(board, moves, evaluate, tolerance)
                else:
                    pick = moves[0] if moves else None
                if pick is None:
                    break
                sans.append(board.san(chess.Move.from_uci(pick.uci)))
                board.push_uci(pick.uci)
            if board.turn == learner:  # lines end on the learner's move
                moves = explore(board.fen())
                pick = pick_learner_move(board, moves, evaluate, tolerance)
                if pick is None:
                    continue
                sans.append(board.san(chess.Move.from_uci(pick.uci)))
                board.push_uci(pick.uci)
            drafts.append({"from_line": via, "start": start, "sans": sans, "note": notes[0]})
            if len(drafts) >= max_lines:
                break
    return drafts


def render(course: dict, drafts: list[dict]) -> str:
    out = [f"# Draft lines for {course['name']} from Lichess games. Review, add {{comments}}, then move them",
           "# into the course file under the right chapter.", ""]
    for i, d in enumerate(drafts, 1):
        # Rebuild full move text from the start of the game.
        board = chess.Board()
        text, ply = [], 0
        for move in d["start"].move_stack:
            if ply % 2 == 0:
                text.append(f"{ply // 2 + 1}.")
            text.append(board.san(move))
            board.push(move)
            ply += 1
        for j, san in enumerate(d["sans"]):
            if ply % 2 == 0:
                text.append(f"{ply // 2 + 1}.")
            elif j == 0:
                text.append(f"{ply // 2 + 1}...")
            text.append(san + (f" {{Popular: {d['note']}.}}" if j == 0 else ""))
            board.push_san(san)
            ply += 1
        out += [f"line: draft-{i}", f"name: After {d['sans'][0]} (from {d['from_line']})", "moves: " + " ".join(text), ""]
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--course", action="append")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--engine", default=os.environ.get("STOCKFISH_PATH", "stockfish"))
    ap.add_argument("--depth", type=int, default=18)
    ap.add_argument("--ratings", default="1200,1400,1600,1800,2000")
    ap.add_argument("--speeds", default="blitz,rapid,classical")
    ap.add_argument("--min-share", type=float, default=5.0)
    ap.add_argument("--min-games", type=int, default=300)
    ap.add_argument("--plies", type=int, default=12, help="how far to extend each new line")
    ap.add_argument("--tolerance", type=int, default=40, help="centipawns a popular move may trail the engine's")
    ap.add_argument("--max-lines", type=int, default=15, help="per course")
    args = ap.parse_args()
    if not args.all and not args.course:
        ap.error("pass --course ID or --all")

    explore = lichess_explorer(args.ratings, args.speeds)
    evaluate, close = stockfish_evaluator(args.engine, args.depth)
    DRAFTS.mkdir(exist_ok=True)
    try:
        for path in sorted(Path(__file__).parent.glob("*.course")):
            course = build_course(path)
            if args.course and course["id"] not in args.course:
                continue
            drafts = draft_lines(course, explore, evaluate, min_share=args.min_share, min_games=args.min_games,
                                 plies=args.plies, tolerance=args.tolerance, max_lines=args.max_lines)
            out = DRAFTS / f"{course['id']}.course"
            out.write_text(render(course, drafts))
            print(f"{course['id']}: {len(drafts)} draft lines -> {out}")
    finally:
        close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
