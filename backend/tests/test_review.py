import chess
import pytest

from app import coaching
from app.engine import win_percent
from app.review import classify, game_accuracy, is_sacrifice, review_pgn

from .conftest import fixture_pgn

BASE = dict(played_best=False, second_best_win=None, sacrifice=False, is_book=False,
            only_move=False, is_recapture=False, prev_opponent_class=None)


def test_win_percent_is_symmetric_and_bounded():
    assert win_percent(0) == pytest.approx(50)
    assert win_percent(300) + win_percent(-300) == pytest.approx(100)
    assert 97 < win_percent(100_000) <= 100


@pytest.mark.parametrize("loss,expected", [
    (0.5, "excellent"), (3, "good"), (7, "inaccuracy"), (15, "mistake"), (40, "blunder"),
])
def test_classify_thresholds(loss, expected):
    assert classify(win_before=60, win_after=60 - loss, **BASE) == expected


def test_classify_special_cases():
    assert classify(win_before=60, win_after=60, **{**BASE, "played_best": True}) == "best"
    great = {**BASE, "played_best": True, "second_best_win": 30}
    assert classify(win_before=55, win_after=55, **great) == "great"
    assert classify(win_before=55, win_after=55, **{**great, "is_recapture": True}) == "best"
    assert classify(win_before=55, win_after=55, **{**great, "gives_mate": True}) == "best"
    assert classify(win_before=70, win_after=70, **{**BASE, "sacrifice": True}) == "brilliant"
    # Already completely winning: a sacrifice there is just the best move.
    assert classify(win_before=95, win_after=95, **{**BASE, "sacrifice": True, "played_best": True}) == "best"
    assert classify(win_before=40, win_after=40, **{**BASE, "sacrifice": True}) == "excellent"
    assert classify(win_before=80, win_after=55, **{**BASE, "prev_opponent_class": "blunder"}) == "miss"
    assert classify(win_before=80, win_after=10, **{**BASE, "prev_opponent_class": "blunder"}) == "blunder"
    assert classify(win_before=50, win_after=10, **{**BASE, "only_move": True}) == "forced"


def test_sacrifice_detection():
    # Greek gift: Bxh7+ Kxh7 gives up a bishop for a pawn.
    board = chess.Board("r1bq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R2QK2R w KQ - 0 8")
    assert is_sacrifice(board, chess.Move.from_uci("d3h7"), ["g8h7", "f3g5"])
    # Bishop-for-knight trade (Ruy Lopez Exchange) is not a sacrifice.
    board = chess.Board("r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4")
    assert not is_sacrifice(board, chess.Move.from_uci("b5c6"), ["d7c6"])
    # Leaving a knight en prise (declined) is.
    board = chess.Board("rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 2")
    assert is_sacrifice(board, chess.Move.from_uci("f3g5"), ["d8g5"])


def test_game_accuracy():
    assert game_accuracy([]) is None
    assert game_accuracy([100, 100]) == 100
    assert game_accuracy([100, 10]) < 55


def test_bundled_openings_are_legal():
    for line in coaching.openings():
        board = chess.Board()
        for san in line["moves"].split():
            board.push_san(san)  # raises on an illegal or ambiguous move
        assert line["color"] in ("white", "black")


def test_endgame_lesson_matching():
    assert coaching.endgame_lesson_for("8/8/4k3/8/3PK3/8/8/2r1R3 w - - 0 1")["id"] == "philidor"
    assert coaching.endgame_lesson_for("8/8/4k3/8/3PK3/8/8/8 w - - 0 1")["id"] == "opposition"
    assert {l["id"] for l in coaching.endgames()} >= {"kq-k", "lucena", "philidor", "bn-mate"}


def test_review_with_fake_engine_flags_scholars_mate_blunder(fake_engine):
    review = review_pgn(fixture_pgn("scholar.pgn"), fake_engine, depth=1, player_color="white")
    moves = {m["san"]: m for m in review["moves"]}
    assert moves["Nf6"]["classification"] == "blunder"
    assert "allowed_mate" in moves["Nf6"]["motifs"]
    assert moves["Qxf7#"]["classification"] in {"best", "great"}
    assert review["summary"]["white"]["accuracy"] is not None
    assert review["moves"][0]["classification"] == "book"


def test_review_with_real_engine(real_engine):
    review = review_pgn(fixture_pgn("legal.pgn"), real_engine, depth=10, player_color="black")
    moves = {m["ply"]: m for m in review["moves"]}
    # 5...Bxd1?? walks into Legal's mate.
    assert moves[10]["san"] == "Bxd1"
    assert moves[10]["classification"] == "blunder"
    assert moves[13]["san"] == "Nd5#"


def test_match_opening():
    assert coaching.match_opening("B90", "Sicilian Defense Najdorf Variation")["id"] == "sicilian-najdorf"
    assert coaching.match_opening(None, "Totally unknown") is None
    # "Opening" must not match "Open Sicilian".
    assert coaching.match_opening("C23", "Bishops Opening", "white") is None
    assert coaching.match_opening("C50", "Italian Game Giuoco Piano", "white")["id"] == "italian-giuoco-piano"


def test_start_eval_is_from_whites_side_when_black_moves_first(fake_engine):
    # Black to move and a rook up: the start position is good for Black, so negative for White.
    pgn = '[SetUp "1"]\n[FEN "r3k3/8/8/8/8/8/8/4K3 b - - 0 1"]\n\n1... Kd7 2. Ke2 *'
    review = review_pgn(pgn, fake_engine, depth=1)
    assert review["start_eval"]["cp"] < 0
