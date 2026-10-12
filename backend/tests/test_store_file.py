"""The in-memory store saves itself to a file, so restarting the backend keeps reviewed games."""

from app.graph_store import MemoryGraphStore
from app.review import review_pgn

from .conftest import fixture_pgn
from .store_contract import _game


def test_memory_store_survives_a_restart(tmp_path, fake_engine):
    path = str(tmp_path / "data" / "store.json")
    store = MemoryGraphStore(path)
    review = review_pgn(fixture_pgn("hanging_queen.pgn"), fake_engine, depth=1, player_color="black")
    store.save_review("coach_tester", _game("black"), review)
    puzzle = store.puzzles("coach_tester")[0]
    store.record_attempt("coach_tester", puzzle["id"], solved=True)
    store.save_progress("coach_tester", {"xp": 40})
    store.close()  # flushes the pending save

    again = MemoryGraphStore(path)
    assert again.list_games("coach_tester") == store.list_games("coach_tester")
    assert again.get_review("shared") == review
    assert again.weakness_profile("coach_tester") == store.weakness_profile("coach_tester")
    assert again.puzzles("coach_tester")[0]["attempt"]["solved"] is True
    assert again.get_progress("coach_tester") == {"xp": 40}
    # And it keeps working after loading: a re-review still replaces rather than duplicates.
    again.save_review("coach_tester", _game("black"), review)
    assert len(again.puzzles("coach_tester")) == len(store.puzzles("coach_tester"))


def test_saves_are_batched_and_written_in_the_background(tmp_path, fake_engine, monkeypatch):
    import time

    monkeypatch.setattr(MemoryGraphStore, "FLUSH_DELAY_S", 0.05)
    path = tmp_path / "store.json"
    store = MemoryGraphStore(str(path))
    store.save_progress("a", {"xp": 1})
    store.save_progress("a", {"xp": 2})
    for _ in range(100):
        if path.exists():
            break
        time.sleep(0.02)
    assert MemoryGraphStore(str(path)).get_progress("a") == {"xp": 2}


def test_unreadable_file_is_set_aside_not_overwritten(tmp_path):
    path = tmp_path / "store.json"
    path.write_text("{not json")
    store = MemoryGraphStore(str(path))
    assert store.list_games("anyone") == []
    assert (tmp_path / "store.json.bad").read_text() == "{not json"


def test_no_path_writes_nothing(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    store = MemoryGraphStore()
    store.save_progress("a", {"xp": 1})
    store.close()
    assert list(tmp_path.iterdir()) == []
