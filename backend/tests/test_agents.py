from fastapi.testclient import TestClient

from app import llm
from app.agents import coach, day_review
from app.chesscom import parse_game
from app.config import get_settings

from .conftest import fixture_pgn


def _games():
    raw = [
        {"uuid": "g1", "url": "https://www.chess.com/game/live/1", "pgn": fixture_pgn("scholar.pgn"),
         "end_time": 1_760_000_000, "time_class": "rapid", "time_control": "600", "rated": True, "rules": "chess",
         "white": {"username": "coach_tester", "rating": 1200, "result": "win"},
         "black": {"username": "opponent1", "rating": 1180, "result": "checkmated"}},
        {"uuid": "g2", "url": "https://www.chess.com/game/live/2", "pgn": fixture_pgn("hanging_queen.pgn"),
         "end_time": 1_760_000_500, "time_class": "rapid", "time_control": "600", "rated": True, "rules": "chess",
         "white": {"username": "opponent2", "rating": 1250, "result": "win"},
         "black": {"username": "coach_tester", "rating": 1200, "result": "checkmated"}},
    ]
    return [{**g.to_dict(), "pgn": g.pgn} for g in (parse_game(r, "coach_tester") for r in raw)]


def test_parse_game_sets_player_color_and_opening():
    games = _games()
    assert games[0]["player_color"] == "white" and games[1]["player_color"] == "black"
    assert games[0]["opening"] == "Bishops Opening"


def test_day_review_graph_end_to_end(monkeypatch, fake_engine, memory_store):
    monkeypatch.setattr(day_review, "get_engine", lambda: fake_engine)
    monkeypatch.setattr(get_settings(), "llm_provider", "none")
    stages = []
    result = day_review.run_day_review("coach_tester", "2025-10-09", games=_games(), depth=1,
                                       progress=lambda stage, frac: stages.append(stage))
    summary = result["summary"]
    assert summary["games"] == 2 and summary["wins"] == 1 and summary["losses"] == 1
    assert summary["worst_moments"][0]["san"] == "Qg5", "the hung queen should be the key moment"
    assert "time_pressure" in summary["worst_moments"][0]["motifs"]
    assert result["lesson_source"] == "template"
    assert "Your day in chess" in result["lesson"]
    assert result["plan"]["puzzles"], "mistakes should become personal puzzles"
    assert any(s.startswith("Analyzing") for s in stages)

    # The graph now knows about the player.
    profile = memory_store.weakness_profile("coach_tester")
    assert profile["games_analyzed"] == 2
    assert profile["motifs"]

    # Re-running uses cached reviews and does not duplicate mistakes.
    day_review.run_day_review("coach_tester", "2025-10-09", games=_games(), depth=1)
    assert memory_store.weakness_profile("coach_tester")["games_analyzed"] == 2


def test_no_games_short_circuits(memory_store):
    result = day_review.run_day_review("coach_tester", "2025-10-09", games=[])
    assert result["games"] == 0 and result["summary"] is None


def test_puzzle_attempts_reorder_queue(monkeypatch, fake_engine, memory_store):
    monkeypatch.setattr(day_review, "get_engine", lambda: fake_engine)
    day_review.run_day_review("coach_tester", "2025-10-09", games=_games(), depth=1)
    first = memory_store.puzzles("coach_tester")[0]
    memory_store.record_attempt("coach_tester", first["id"], solved=True)
    queue = memory_store.puzzles("coach_tester")
    assert queue[-1]["id"] == first["id"]


def test_coach_routes_to_the_right_context(monkeypatch, fake_engine, memory_store):
    monkeypatch.setattr(coach, "get_engine", lambda: fake_engine)
    monkeypatch.setattr(get_settings(), "llm_provider", "none")
    out = coach.ask_coach("coach_tester", "What should I play here?",
                          fen="rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2")
    assert out["used"] == ["analyze_position"]
    out = coach.ask_coach("coach_tester", "What are my weaknesses and what openings should I learn?")
    assert out["used"] == ["load_profile", "load_openings"]
    assert out["source"] == "template"


def test_llm_errors_fall_back(monkeypatch):
    monkeypatch.setattr(get_settings(), "llm_provider", "ollama")
    monkeypatch.setattr(get_settings(), "ollama_url", "http://127.0.0.1:9")  # nothing listens here
    result = coach.explain_move({"san": "Nf6", "classification": "blunder", "best_san": "g6", "best_line": ["g6"],
                                 "win_loss": 50, "motifs": ["allowed_mate"]}, "black")
    assert result["source"] == "template" and "blunder" in result["text"]
    assert llm.provider() == "ollama"


def test_api_smoke(monkeypatch, fake_engine, memory_store):
    from app import main

    monkeypatch.setattr(main, "get_engine", lambda: fake_engine)
    client = TestClient(main.app)
    assert client.get("/api/openings").json()["openings"]
    assert client.get("/api/endgames").json()["stages"]
    lines = client.post("/api/analyze", json={"fen": "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1"}).json()["lines"]
    assert lines[0]["san"][0] == "Ra8#"
    assert client.post("/api/analyze", json={"fen": "nonsense"}).status_code == 400
    prof = client.get("/api/players/nobody/profile").json()
    assert prof["games_analyzed"] == 0


def test_history_rows_have_chart_fields(monkeypatch, fake_engine, memory_store):
    from app import main

    monkeypatch.setattr(day_review, "get_engine", lambda: fake_engine)
    day_review.run_day_review("coach_tester", "2025-10-09", games=_games(), depth=1)
    rows = memory_store.list_games("coach_tester")
    queen = next(r for r in rows if r["id"] == "g2")
    assert queen["rating"] == 1200 and queen["blunders"] >= 1 and queen["accuracy"] is not None
    client = TestClient(main.app)
    assert len(client.get("/api/players/coach_tester/history?days=100000").json()["games"]) == 2


def test_crashes_come_back_as_json_with_cors(monkeypatch):
    from app import main

    def boom(*a, **k):
        raise TypeError("unsupported operand")

    monkeypatch.setattr(main, "ask_coach", boom)
    client = TestClient(main.app, raise_server_exceptions=False)
    res = client.post("/api/coach/chat", json={"username": "x", "message": "hi"}, headers={"Origin": "http://localhost:3000"})
    assert res.status_code == 500
    assert res.json()["detail"] == "TypeError: unsupported operand"
    assert res.headers["access-control-allow-origin"]
