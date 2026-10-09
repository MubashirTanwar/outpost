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


def test_six_courses_three_per_side():
    cs = repertoire.courses()
    assert sorted(c.id for c in cs) == ["caro-kann", "french", "italian", "london", "queens-gambit", "scandinavian"]
    assert sum(c.color == "white" for c in cs) == 3


def test_check_game_finds_player_deviation():
    # Italian: the course plays 4.c3 against 3...Bc5; here White played 4.Nc3.
    note = repertoire.check_game("e4 e5 Nf3 Nc6 Bc4 Bc5 Nc3".split(), "white", "g1", "bob")
    assert note["kind"] == "you_deviated"
    assert note["course_id"] == "italian" and note["played"] == "Nc3" and note["expected"] == "c3"
    assert note["ply"] == 7


def test_check_game_finds_uncovered_opponent_move():
    # Caro-Kann: 1.e4 c6 2.d4 d5 3.e5 Bf5 4.g4?! isn't in the course.
    note = repertoire.check_game("e4 c6 d4 d5 e5 Bf5 g4".split(), "black", "g2", "alice")
    assert note["kind"] == "opponent_deviated" and note["course_id"] == "caro-kann" and note["played"] == "g4"


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
