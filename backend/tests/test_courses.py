import json
import sqlite3
import subprocess
import sys
from pathlib import Path

import chess
import pytest
from fastapi.testclient import TestClient

from app import repertoire

COURSES_DIR = Path(__file__).parents[2] / "courses"
sys.path.insert(0, str(COURSES_DIR))
import import_db  # noqa: E402

SCHEMA = """
create table courses (id text primary key, name text not null, short_name text, description text, color text, created_at integer);
create table course_tags (course_id text, tag text, primary key (course_id, tag));
create table chapters (id text primary key, course_id text not null, name text not null, idx integer not null);
create table studies (id text primary key, chapter_id text not null, name text not null, idx integer not null);
create table variations (id text primary key, study_id text not null, chapter_id text not null, idx integer, start_fen text, move_count integer);
create table variation_moves (variation_id text not null, ply integer, fen text not null, san text not null, next_fen text not null,
                              primary key (variation_id, fen));
"""


def _ep_fen(board: chess.Board) -> str:
    """FENs as the course database writes them: always with the en-passant square after a double step."""
    fen = board.fen().split()
    last = board.peek() if board.move_stack else None
    if last and board.piece_type_at(last.to_square) == chess.PAWN and abs(last.to_square - last.from_square) == 16:
        fen[3] = chess.square_name((last.to_square + last.from_square) // 2)
    return " ".join(fen)


def _variation(con, vid, study, chapter, idx, sans):
    board = chess.Board()
    con.execute("insert into variations values (?, ?, ?, ?, ?, ?)", (vid, study, chapter, idx, chess.STARTING_FEN, len(sans)))
    for ply, san in enumerate(sans):
        before = _ep_fen(board)
        try:
            board.push_san(san)
            after = _ep_fen(board)
        except ValueError:
            after = before  # an illegal move, to be rejected by the importer
        con.execute("insert into variation_moves values (?, ?, ?, ?, ?)", (vid, ply, before, san, after))


@pytest.fixture
def course_db(tmp_path):
    path = tmp_path / "chess.db"
    con = sqlite3.connect(path)
    con.executescript(SCHEMA)
    con.execute("insert into courses values ('c1', 'The Italian Game', 'Italian', 'Fast development. Then attack.', 'W', 0)")
    con.execute("insert into course_tags values ('c1', 'White Openings')")
    con.execute("insert into courses values ('c2', 'Coming Soon Course', null, 'Soon.', 'B', 0)")
    con.execute("insert into chapters values ('ch1', 'c1', 'Chapter 1: Main Lines', 0)")
    con.execute("insert into studies values ('s1', 'ch1', 'Study 1: Black Plays 3...Bc5', 0)")
    con.execute("insert into studies values ('s2', 'ch1', 'Study 2: Black Plays 3...Nf6', 1)")
    _variation(con, "v1", "s1", "ch1", 0, ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3"])
    _variation(con, "v2", "s1", "ch1", 1, ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6", "d4"])  # longer than v1
    _variation(con, "v3", "s1", "ch1", 2, ["e4", "e5", "Nf3", "Nc6", "Bc4", "d6", "d4"])  # branches at 3...d6
    _variation(con, "v4", "s2", "ch1", 0, ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "d3"])
    _variation(con, "bad", "s2", "ch1", 1, ["e4", "e5", "Ke3"])  # illegal
    con.commit()
    con.close()
    return str(path)


def test_import_builds_course_chapter_study_lines(course_db):
    courses, problems = import_db.load(course_db)
    assert [c["id"] for c in courses] == ["the-italian-game"]  # the empty course is skipped
    c = courses[0]
    assert (c["color"], c["tags"], c["tagline"], c["shortName"]) == ("white", ["White Openings"], "Fast development.", "Italian")
    [ch] = c["chapters"]
    assert ch["title"] == "Chapter 1: Main Lines" and ch["quizzes"] == []
    lines = {l["id"]: l for l in ch["lines"]}
    assert set(lines) == {"v1", "v2", "v3", "v4"}  # the illegal line is left out
    assert [lines[v]["label"] for v in ("v1", "v2", "v3", "v4")] == ["Main line", "4...Nf6", "3...d6", "Main line"]
    assert lines["v3"]["name"] == "Study 1: Black Plays 3...Bc5: 3...d6"
    assert lines["v2"]["study"] == "Study 1: Black Plays 3...Bc5" and lines["v4"]["studyId"] == "s2"
    first = lines["v1"]["moves"][0]
    assert first == {"san": "e4", "uci": "e2e4", "fen": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", "note": None}
    assert c["stats"]["lines"] == 4 and c["stats"]["chapters"] == 1
    assert any("bad" in p for p in problems) and any("Coming Soon Course" in p for p in problems)


def test_import_writes_the_data_files(course_db, tmp_path, monkeypatch):
    out = [tmp_path / "a.json", tmp_path / "b.json"]
    monkeypatch.setattr(import_db, "OUTPUTS", out)
    monkeypatch.setattr(sys, "argv", ["import_db.py", course_db])
    assert import_db.main() == 0
    assert json.loads(out[0].read_text()) == json.loads(out[1].read_text())
    assert len(json.loads(out[0].read_text())["courses"]) == 1


@pytest.fixture
def imported(course_db, tmp_path, monkeypatch):
    """The sample database imported as the app's course data."""
    courses, _ = import_db.load(course_db)
    data = tmp_path / "courses.json"
    data.write_text(json.dumps({"courses": courses}))
    monkeypatch.setattr(repertoire, "DATA", data)
    repertoire.courses.cache_clear()
    yield courses
    repertoire.courses.cache_clear()


def test_check_game_finds_player_deviation(imported):
    note = repertoire.check_game("e4 e5 Nf3 Nc6 Bc4 Bc5 Nc3".split(), "white", "g1", "bob")
    assert note["kind"] == "you_deviated" and note["course_id"] == "the-italian-game"
    assert (note["played"], note["expected"], note["ply"]) == ("Nc3", "c3", 7)


def test_check_game_finds_uncovered_opponent_move(imported):
    note = repertoire.check_game("e4 e5 Nf3 Nc6 Bc4 Be7".split(), "white", "g2", "alice")
    assert note["kind"] == "opponent_deviated" and note["played"] == "Be7"


def test_check_game_accepts_any_move_the_course_teaches(imported, tmp_path, monkeypatch):
    # Two lines teaching different White moves in the same position: both count.
    c = imported[0]
    extra = dict(c["chapters"][0]["lines"][0])
    board = chess.Board()
    moves = []
    for san in ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "O-O"]:
        mv = board.parse_san(san)
        board.push(mv)
        moves.append({"san": san, "uci": mv.uci(), "fen": board.fen(), "note": None})
    extra.update(id="v-castle", moves=moves)
    c["chapters"][0]["lines"].append(extra)
    repertoire.DATA.write_text(json.dumps({"courses": imported}))
    repertoire.courses.cache_clear()
    assert repertoire.check_game("e4 e5 Nf3 Nc6 Bc4 Bc5 O-O".split(), "white") is None
    assert repertoire.check_game("e4 e5 Nf3 Nc6 Bc4 Bc5 c3".split(), "white") is None


def test_check_game_respects_studied_courses(imported):
    assert repertoire.check_game("e4 e5 Nf3 Nc6 Bc4 Bc5 Nc3".split(), "white", course_ids={"other"}) is None


def test_no_course_data_means_no_notes(tmp_path, monkeypatch):
    monkeypatch.setattr(repertoire, "DATA", tmp_path / "missing.json")
    repertoire.courses.cache_clear()
    try:
        assert repertoire.courses() == []
        assert repertoire.check_game("e4 e5".split(), "white") is None
    finally:
        repertoire.courses.cache_clear()


def test_endgame_course_is_built_and_valid():
    out = subprocess.run([sys.executable, str(COURSES_DIR / "build_endgames.py"), "--check"], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr + out.stdout


def test_progress_roundtrip(memory_store):
    from app import main

    client = TestClient(main.app)
    assert client.get("/api/players/Kim/progress").json() == {"progress": None}
    body = {"version": 1, "xp": 40, "lines": {"the-italian-game/v1": {"stage": 2, "due": 1, "reviews": 1, "lapses": 0}}}
    assert client.put("/api/players/kim/progress", json=body).json() == {"ok": True}
    assert client.get("/api/players/KIM/progress").json()["progress"]["xp"] == 40
    assert client.put("/api/players/kim/progress", json={"lines": "nope"}).status_code == 400
