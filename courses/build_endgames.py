"""Build the endgame course from courses/endgames.endgame.

    python courses/build_endgames.py                       # validate + write JSON
    python courses/build_endgames.py --engine stockfish    # also check every drill is winnable/holdable
    python courses/build_endgames.py --check               # fail if the JSON is out of date
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
SOURCE = ROOT / "endgames.endgame"
OUTPUTS = [
    ROOT.parent / "backend" / "app" / "data" / "endgame-course.json",
    ROOT.parent / "web" / "src" / "data" / "endgame-course.json",
]
KEY = re.compile(r"^(stage|title|intro|lesson|level|summary|theory|demo|drill):\s*(.*)$")
GOALS = {"mate", "promote", "convert", "draw"}


class EndgameError(ValueError):
    pass


def parse_demo(value: str, where: str) -> dict:
    fen, _, moves = (p.strip() for p in value.partition("|"))
    board = _board(fen, where)
    game = chess.pgn.read_game(io.StringIO(f'[FEN "{fen}"]\n[SetUp "1"]\n\n{moves} *'))
    if game is None or game.errors:
        raise EndgameError(f"{where}: bad demo moves {game.errors if game else ''}")
    out = []
    for node in game.mainline():
        if node.move not in board.legal_moves:
            raise EndgameError(f"{where}: illegal demo move {node.move}")
        san = board.san(node.move)
        board.push(node.move)
        out.append({"san": san, "uci": node.move.uci(), "fen": board.fen(), "note": node.comment.strip() or None})
    return {"fen": fen, "moves": out}


def _board(fen: str, where: str) -> chess.Board:
    try:
        board = chess.Board(fen)
    except ValueError as exc:
        raise EndgameError(f"{where}: bad FEN {fen!r}") from exc
    if not board.is_valid():
        raise EndgameError(f"{where}: illegal position {fen!r} ({board.status()!r})")
    if board.is_game_over():
        raise EndgameError(f"{where}: position is already over {fen!r}")
    return board


def parse() -> list[dict]:
    entries: list[list[str]] = []
    for raw in SOURCE.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = KEY.match(line)
        if m:
            entries.append([m.group(1), m.group(2).strip()])
        elif entries:
            entries[-1][1] += " " + line
        else:
            raise EndgameError(f"text before the first key: {line!r}")

    stages: list[dict] = []
    stage = lesson = target = None
    seen: set[str] = set()
    for key, value in entries:
        if key == "stage":
            stage = target = {"id": value, "lessons": []}
            stages.append(stage)
        elif key == "lesson":
            if stage is None:
                raise EndgameError(f"lesson {value} outside a stage")
            if value in seen:
                raise EndgameError(f"duplicate lesson id {value}")
            seen.add(value)
            lesson = target = {"id": value, "theory": [], "drills": []}
            stage["lessons"].append(lesson)
        elif key == "theory":
            lesson["theory"].append({"text": value, "demo": None})
        elif key == "demo":
            if not lesson["theory"]:
                raise EndgameError(f"{lesson['id']}: demo before any theory card")
            lesson["theory"][-1]["demo"] = parse_demo(value, f"{lesson['id']} demo")
        elif key == "drill":
            parts = [p.strip() for p in value.split("|")]
            if len(parts) not in (3, 4) or parts[1] not in GOALS or (len(parts) == 4 and parts[3] != "known"):
                raise EndgameError(f"{lesson['id']}: drill needs 'FEN | goal | hint [| known]' with goal in {sorted(GOALS)}")
            board = _board(parts[0], f"{lesson['id']} drill")
            lesson["drills"].append({
                "id": f"{lesson['id']}-{len(lesson['drills']) + 1}",
                "fen": parts[0],
                "goal": parts[1],
                "hint": parts[2],
                "side": "white" if board.turn == chess.WHITE else "black",
                # A theoretical result that engines without tablebases misjudge: skip the engine check.
                "known": len(parts) == 4,
            })
        else:
            target[key] = value
    for st in stages:
        for ls in st["lessons"]:
            for field in ("title", "level", "summary"):
                if field not in ls:
                    raise EndgameError(f"{ls['id']}: missing {field}")
            if not ls["drills"]:
                raise EndgameError(f"{ls['id']}: no drills")
    return stages


def engine_check(stages: list[dict], command: str, depth: int) -> list[str]:
    engine = chess.engine.SimpleEngine.popen_uci(shlex.split(command))
    problems = []
    try:
        for st in stages:
            for ls in st["lessons"]:
                for d in ls["drills"]:
                    if d["known"]:
                        continue
                    score = engine.analyse(chess.Board(d["fen"]), chess.engine.Limit(depth=depth))["score"].relative
                    cp = score.score(mate_score=10000)
                    ok = cp >= -150 if d["goal"] == "draw" else cp >= 250
                    print(f"  {d['id']:18} {d['goal']:8} {cp:+6}  {'ok' if ok else 'CHECK'}", file=sys.stderr)
                    if not ok:
                        problems.append(f"{d['id']}: goal {d['goal']} but engine says {cp:+}")
    finally:
        engine.quit()
    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine")
    ap.add_argument("--depth", type=int, default=20)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    stages = parse()
    lessons = sum(len(s["lessons"]) for s in stages)
    drills = sum(len(l["drills"]) for s in stages for l in s["lessons"])
    demos = sum(1 for s in stages for l in s["lessons"] for t in l["theory"] if t["demo"])
    print(f"{len(stages)} stages, {lessons} lessons, {drills} drills, {demos} demos")

    if args.engine:
        problems = engine_check(stages, args.engine, args.depth)
        for p in problems:
            print("ENGINE:", p)
        if problems:
            return 1

    payload = json.dumps({"stages": stages}, ensure_ascii=False, separators=(",", ":")) + "\n"
    for out in OUTPUTS:
        if args.check:
            if not out.exists() or out.read_text() != payload:
                print(f"{out} is out of date: run python courses/build_endgames.py", file=sys.stderr)
                return 1
        else:
            out.write_text(payload)
    return 0


if __name__ == "__main__":
    sys.exit(main())
