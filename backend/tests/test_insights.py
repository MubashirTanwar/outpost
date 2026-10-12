import time
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.agents import coach, insights
from app.chesscom import parse_game

from .conftest import fixture_pgn

NOW = datetime(2026, 10, 12, 15, 0, tzinfo=timezone.utc).timestamp()


def test_parse_scope():
    assert insights.parse_scope("what went wrong in my latest game?", NOW).count == 1
    assert insights.parse_scope("review my last 10 games", NOW).count == 10
    assert insights.parse_scope("my last five games", NOW).count == 5
    y = insights.parse_scope("why did I lose 50 elo yesterday?", NOW)
    assert y.label == "yesterday" and y.end - y.start == 86400
    assert datetime.fromtimestamp(y.start, timezone.utc).day == 11
    # Local days: at UTC+5:30 it's already the 12th in the evening.
    t = insights.parse_scope("how did I do today", NOW, tz_offset=330)
    assert datetime.fromtimestamp(t.start, timezone(insights.timedelta(minutes=330))).hour == 0
    assert insights.parse_scope("what should I study this week", NOW).label == "the last 7 days"
    assert insights.parse_scope("my rating keeps dropping", NOW).label == "the last 7 days"
    assert insights.wants_games("What went wrong yesterday?")
    assert not insights.wants_games("Explain the London system to me")


def _raw(uuid, name, end_time, me_white, my_rating, result):
    me, opp = {"username": "coach_tester", "rating": my_rating}, {"username": f"opp-{uuid}", "rating": 1200}
    win = {"win": ("win", "resigned"), "loss": ("timeout", "win")}[result]
    me["result"], opp["result"] = win
    return {"uuid": uuid, "url": f"https://www.chess.com/game/live/{uuid}", "pgn": fixture_pgn(name), "end_time": end_time,
            "time_class": "blitz", "time_control": "300", "rated": True, "rules": "chess",
            "white": me if me_white else opp, "black": opp if me_white else me}


def _fetch(raws):
    return lambda u, start, end: [g for g in (parse_game(r, u) for r in raws) if start <= g.end_time < end]


def test_report_rating_moments_and_plan(monkeypatch, fake_engine, memory_store):
    monkeypatch.setattr(insights, "get_engine", lambda: fake_engine)
    now = int(time.time())
    raws = [
        _raw("old", "scholar.pgn", now - 3 * 86400, True, 1250, "win"),  # before the scope: the baseline rating
        _raw("q1", "hanging_queen.pgn", now - 3600, False, 1230, "loss"),
        _raw("q2", "hanging_queen.pgn", now - 600, False, 1205, "loss"),
    ]
    stages = []
    out = insights.answer_question("coach_tester", "what went wrong in my last 2 games?", 1,
                                   lambda s, f: stages.append(s), fetch=_fetch(raws))
    report, answer = out["report"], out["answer"]
    assert report["record"] == {"games": 2, "wins": 0, "draws": 0, "losses": 2}
    assert report["rating"] == [{"time_class": "blitz", "games": 2, "start": 1250, "end": 1205, "change": -45}]
    assert [g["rating_change"] for g in report["games"]] == [-20, -25]
    assert report["patterns"]["lost_on_time"] == 2
    # The decisive moment is the hung queen, linked for hover previews.
    top = report["moments"][0]
    assert top["san"] == "Qg5" and top["game_id"] in {"q1", "q2"}
    assert f"(move:{top['game_id']}:{top['ply']})" in answer and "(game:q1)" in answer
    assert "1250 → 1205 (**-45**)" in answer
    kinds = [p["kind"] for p in report["plan"]]
    assert "puzzles" in kinds and "review" in kinds and "habit" in kinds
    assert any(p["link"] and p["link"].startswith("/u/coach_tester/puzzles?motif=") for p in report["plan"])
    assert any("Reviewing game" in s for s in stages)
    # Asking again reuses the reviews instead of analysing again.
    stages.clear()
    insights.answer_question("coach_tester", "what went wrong in my last 2 games?", 1, lambda s, f: stages.append(s),
                             fetch=_fetch(raws))
    assert not any("Reviewing game" in s for s in stages)


def test_no_games_in_scope(monkeypatch, fake_engine, memory_store):
    out = insights.answer_question("coach_tester", "what went wrong yesterday?", 1, lambda s, f: None, fetch=lambda *a: [])
    assert out["report"]["record"]["games"] == 0 and "couldn't find any games" in out["answer"]


def test_chat_endpoint_runs_game_questions_as_a_job(monkeypatch, fake_engine, memory_store):
    from app import chesscom, main

    monkeypatch.setattr(insights, "get_engine", lambda: fake_engine)
    now = int(time.time())
    monkeypatch.setattr(chesscom, "fetch_games_between", _fetch([_raw("q1", "hanging_queen.pgn", now - 600, False, 1205, "loss")]))
    client = TestClient(main.app)
    res = client.post("/api/coach/chat", json={"username": "coach_tester", "message": "What went wrong in my latest game?"}).json()
    assert "job_id" in res
    for _ in range(200):
        job = client.get(f"/api/jobs/{res['job_id']}").json()
        if job["status"] in {"done", "error"}:
            break
        time.sleep(0.02)
    assert job["status"] == "done", job
    assert job["result"]["report"]["moments"] and "analyze_games" in job["result"]["used"]
    # Other questions still answer straight away.
    assert "answer" in client.post("/api/coach/chat", json={"username": "coach_tester", "message": "Explain the London to me"}).json()


def test_games_in_any_order_give_the_same_rating_story(monkeypatch, fake_engine, memory_store):
    monkeypatch.setattr(insights, "get_engine", lambda: fake_engine)
    now = int(time.time())
    raws = [_raw("old", "scholar.pgn", now - 3 * 86400, True, 1250, "win"),
            _raw("q1", "hanging_queen.pgn", now - 3600, False, 1230, "loss"),
            _raw("q2", "hanging_queen.pgn", now - 600, False, 1205, "loss")]
    newest_first = lambda u, s, e: list(reversed(_fetch(raws)(u, s, e)))  # noqa: E731
    report = insights.answer_question("coach_tester", "my last 2 games", 1, lambda s, f: None, fetch=newest_first)["report"]
    assert report["rating"][0]["change"] == -45 and [g["id"] for g in report["games"]] == ["q1", "q2"]
