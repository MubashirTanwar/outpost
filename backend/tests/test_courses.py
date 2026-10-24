import subprocess
import sys
from pathlib import Path

from fastapi.testclient import TestClient

from app import repertoire

COURSES_DIR = Path(__file__).parents[2] / "courses"


def test_course_json_is_built_and_valid():
    """build.py re-validates every course (legality, one move per position) and checks the JSON is current."""
    if not COURSES_DIR.exists():
        return
    out = subprocess.run([sys.executable, str(COURSES_DIR / "build.py"), "--check"], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr + out.stdout


def test_endgame_course_is_built_and_valid():
    if not COURSES_DIR.exists():
        return
    out = subprocess.run([sys.executable, str(COURSES_DIR / "build_endgames.py"), "--check"], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr + out.stdout


def test_the_courses():
    cs = repertoire.courses()
    assert sorted(c.id for c in cs) == ["caro-kann", "french", "italian", "jobava", "london", "queens-gambit", "scandinavian"]
    assert sum(c.color == "white" for c in cs) == 4


def test_check_game_finds_player_deviation():
    # Italian: the course plays 4.c3 against 3...Bc5; here White played 4.Nc3.
    note = repertoire.check_game("e4 e5 Nf3 Nc6 Bc4 Bc5 Nc3".split(), "white", "g1", "bob")
    assert note["kind"] == "you_deviated"
    assert note["course_id"] == "italian" and note["played"] == "Nc3" and note["expected"] == "c3"
    assert note["ply"] == 7


def test_check_game_finds_uncovered_opponent_move():
    # Caro-Kann: 1.e4 c6 2.d4 d5 3.e5 Bf5 4.Be2 isn't in the course.
    note = repertoire.check_game("e4 c6 d4 d5 e5 Bf5 Be2".split(), "black", "g2", "alice")
    assert note["kind"] == "opponent_deviated" and note["course_id"] == "caro-kann" and note["played"] == "Be2"


def test_check_game_reports_only_the_course_that_followed_furthest():
    # Pure London: the Jobava (2.Nc3) is left at move 2, but the London follows the whole game.
    assert repertoire.check_game("d4 d5 Bf4 Nf6 e3 e6 Nf3 c5 c3".split(), "white") is None
    # And a Jobava game isn't reported as a London deviation.
    assert repertoire.check_game("d4 d5 Nc3 Nf6 Bf4".split(), "white") is None


def test_check_game_respects_studied_courses():
    assert repertoire.check_game("e4 e5 Nf3 Nc6 Bc4 Bc5 Nc3".split(), "white", course_ids={"london"}) is None


def test_match_course():
    assert repertoire.match_course("B12", "black").id == "caro-kann"
    assert repertoire.match_course("B12", "white") is None


def test_progress_roundtrip(memory_store):
    from app import main

    client = TestClient(main.app)
    assert client.get("/api/players/Kim/progress").json() == {"progress": None}
    body = {"version": 1, "xp": 40, "lines": {"italian/piano-main": {"stage": 2, "due": 1, "reviews": 1, "lapses": 0}}}
    assert client.put("/api/players/kim/progress", json=body).json() == {"ok": True}
    assert client.get("/api/players/KIM/progress").json()["progress"]["xp"] == 40
    assert client.put("/api/players/kim/progress", json={"lines": "nope"}).status_code == 400


def test_expand_drafts_uncovered_popular_replies(tmp_path):
    """courses/expand.py with a fake explorer and engine: popular uncovered replies become draft lines."""
    if not COURSES_DIR.exists():
        return
    sys.path.insert(0, str(COURSES_DIR))
    import chess

    from build import build_course
    from expand import ExplorerMove, draft_lines, render

    src = tmp_path / "mini.course"
    src.write_text(
        "course: mini\nname: Mini\ncolor: white\ntagline: t\ndescription: d\n"
        "chapter: c\ntitle: C\nintro: i\n"
        "line: main\nname: Main\nmoves: 1.e4 e5 2.Nf3\n"
    )
    course = build_course(src)

    def explore(fen):
        b = chess.Board(fen)
        table = {
            # after 1.e4 Black plays e5 (covered) and c5 (not covered, 30%)
            "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1": [("e7e5", 700), ("c7c5", 300)],
            "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2": [("g1f3", 500), ("b1c3", 400)],
        }
        return [ExplorerMove(b.san(chess.Move.from_uci(u)), u, n) for u, n in table.get(fen, [])]

    def evaluate(board, ucis):
        return {u: 30 for u in ucis}

    drafts = draft_lines(course, explore, evaluate, min_share=5, min_games=100, plies=6, tolerance=40, max_lines=5)
    assert [d["sans"] for d in drafts] == [["c5", "Nf3"]]
    text = render(course, drafts)
    assert "30% of 1000 games" in text
    from build import parse_moves

    moves_line = next(l for l in text.splitlines() if l.startswith("moves: "))
    assert [m["san"] for m in parse_moves(moves_line[7:], "draft")] == ["e4", "c5", "Nf3"]
