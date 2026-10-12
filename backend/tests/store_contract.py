"""Store behaviour both graph stores must share (run against memory and, when available, Neo4j)."""

from app.review import review_for, review_pgn

from .conftest import fixture_pgn


def _game(player_color: str) -> dict:
    return {"id": "shared", "url": "", "pgn": fixture_pgn("hanging_queen.pgn"), "end_time": 1_760_000_000,
            "time_class": "blitz", "time_control": "300", "rated": True, "white": "opponent2", "black": "coach_tester",
            "white_rating": 1250, "black_rating": 1200, "white_result": "win", "black_result": "checkmated",
            "eco": None, "opening": None, "player_color": player_color}


def check_rereview_replaces_records(store, fake_engine):
    game = _game("black")
    review = review_pgn(game["pgn"], fake_engine, depth=1, player_color="black")
    store.save_review("coach_tester", game, review)
    first = store.weakness_profile("coach_tester")
    puzzles = store.puzzles("coach_tester")
    # Same game again (e.g. a deeper re-review): nothing is counted twice.
    store.save_review("coach_tester", game, review)
    assert store.weakness_profile("coach_tester")["motifs"] == first["motifs"]
    assert len(store.puzzles("coach_tester")) == len(puzzles)
    # A re-review where the move is no longer an error drops its mistake and puzzle.
    clean = {**review, "moves": [{**m, "classification": "best"} for m in review["moves"]]}
    store.save_review("coach_tester", game, clean)
    assert store.puzzles("coach_tester") == []
    assert store.weakness_profile("coach_tester")["motifs"] == []


def check_both_players_keep_their_side(store, fake_engine):
    review = review_pgn(fixture_pgn("hanging_queen.pgn"), fake_engine, depth=1, player_color="black")
    store.save_review("coach_tester", _game("black"), review)
    store.save_review("opponent2", _game("white"), review_for(review, "white"))
    mine, theirs = store.list_games("coach_tester")[0], store.list_games("opponent2")[0]
    assert (mine["player_color"], mine["rating"], mine["result"]) == ("black", 1200, "loss")
    assert (theirs["player_color"], theirs["rating"], theirs["result"]) == ("white", 1250, "win")
    assert mine["accuracy"] == review["summary"]["black"]["accuracy"]
    assert theirs["accuracy"] == review["summary"]["white"]["accuracy"]
    assert store.weakness_profile("opponent2")["games_analyzed"] == 1
    assert store.weakness_profile("coach_tester")["games_analyzed"] == 1


def check_list_reviews(store, fake_engine):
    review = review_pgn(fixture_pgn("hanging_queen.pgn"), fake_engine, depth=1, player_color="black")
    store.save_review("coach_tester", _game("black"), review)
    store.save_review("opponent2", _game("white"), review_for(review, "white"))
    [(row, full)] = store.list_reviews("coach_tester")
    assert row["id"] == "shared" and row["player_color"] == "black" and row["result"] == "loss"
    assert [m["san"] for m in full["moves"]] == [m["san"] for m in review["moves"]]
    assert store.list_reviews("coach_tester", since=1_760_000_001) == []
    assert store.list_reviews("nobody") == []
