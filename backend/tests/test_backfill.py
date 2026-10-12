import time

from fastapi.testclient import TestClient

from app import backfill, chesscom, jobs
from app.chesscom import parse_game

from .conftest import fixture_pgn


def _raw(uuid, name, end_time, white="coach_tester", black="opp"):
    return {"uuid": uuid, "url": f"https://www.chess.com/game/live/{uuid}", "pgn": fixture_pgn(name),
            "end_time": end_time, "time_class": "blitz", "time_control": "300", "rated": True, "rules": "chess",
            "white": {"username": white, "rating": 1200, "result": "win"},
            "black": {"username": black, "rating": 1200, "result": "checkmated"}}


def _fetch(games):
    return lambda username, start, end: [g for g in (parse_game(r, username) for r in games) if start <= g.end_time < end]


def test_backfill_reviews_new_games_once(monkeypatch, fake_engine, memory_store):
    monkeypatch.setattr(backfill, "get_engine", lambda: fake_engine)
    now = int(time.time())
    games = [_raw("a", "scholar.pgn", now - 3600), _raw("b", "hanging_queen.pgn", now - 5 * 86400),
             _raw("old", "legal.pgn", now - 40 * 86400)]
    stages = []
    out = backfill.run_backfill("coach_tester", 30, 1, lambda s, f: stages.append((s, f)), fetch=_fetch(games))
    assert out == {"games": 2, "analysed": 2, "already_reviewed": 0}
    assert {g["id"] for g in memory_store.list_games("coach_tester")} == {"a", "b"}
    assert stages[-1][1] <= 1 and "game 2 of 2" in stages[-1][0]
    # A second run only picks up what's new.
    games.append(_raw("c", "scholar.pgn", now - 60))
    out = backfill.run_backfill("coach_tester", 30, 1, lambda s, f: None, fetch=_fetch(games))
    assert out == {"games": 3, "analysed": 1, "already_reviewed": 2}


def test_backfill_endpoints_run_in_background_and_stop(monkeypatch, fake_engine, memory_store):
    from app import main

    monkeypatch.setattr(backfill, "get_engine", lambda: fake_engine)
    now = int(time.time())
    monkeypatch.setattr(chesscom, "fetch_games_between", _fetch([_raw("a", "scholar.pgn", now - 3600)]))
    client = TestClient(main.app)
    job = client.post("/api/players/coach_tester/backfill", json={"days": 30, "depth": 1}).json()
    for _ in range(100):
        job = client.get("/api/players/Coach_Tester/backfill").json()["job"]
        if job["status"] == "done":
            break
        time.sleep(0.05)
    assert job["status"] == "done" and job["result"]["analysed"] == 1
    assert client.post("/api/players/coach_tester/backfill", json={"days": 400}).status_code == 422

    # Cancelling a job stops it at its next progress report.
    def slow(progress):
        for i in range(200):
            progress("working", i / 200)
            time.sleep(0.01)

    jid = jobs.submit("slow", slow, background=True)
    time.sleep(0.05)
    assert jobs.cancel(jid)
    for _ in range(100):
        if jobs.get(jid)["status"] == "cancelled":
            break
        time.sleep(0.02)
    assert jobs.get(jid)["status"] == "cancelled"


def test_finished_jobs_are_forgotten(monkeypatch):
    jid = jobs.submit("quick", lambda progress: 42)
    for _ in range(100):
        if jobs.get(jid)["status"] == "done":
            break
        time.sleep(0.01)
    assert jobs.get(jid)["result"] == 42
    monkeypatch.setattr(jobs, "KEEP_FINISHED_S", -1)
    jobs.submit("next", lambda progress: None)
    assert jobs.get(jid) is None


def test_backfill_defaults_to_the_quicker_backfill_depth(monkeypatch):
    from app import main
    from app.config import get_settings

    seen = []
    monkeypatch.setattr(main, "run_backfill", lambda username, days, depth, progress: seen.append(depth) or {})
    client = TestClient(main.app)
    job = client.post("/api/players/depth_tester/backfill", json={"days": 30}).json()
    for _ in range(100):
        if client.get("/api/players/depth_tester/backfill").json()["job"]["status"] == "done":
            break
        time.sleep(0.05)
    assert job and seen == [get_settings().backfill_depth] and seen[0] < get_settings().engine_depth


def test_health_does_not_wait_for_a_running_search():
    import threading

    from app.engine import Engine

    eng = Engine.__new__(Engine)

    eng._lock = threading.Lock()
    eng._lock.acquire()  # a search in progress
    t = time.time()
    assert eng.available() is True
    assert time.time() - t < 0.1
    eng._lock.release()
