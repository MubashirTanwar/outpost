from app.calibration import accuracy_from_evals, best_scale, error_stats, linear_fit, win_percent_scaled
from app.engine import win_percent
from app.review import review_pgn

from .conftest import fixture_pgn


def test_scale_one_is_the_lichess_curve():
    for cp in (-1200, -300, 0, 45, 800):
        assert abs(win_percent_scaled(cp) - win_percent(cp)) < 1e-9
    assert win_percent_scaled(300, 0.5) < win_percent_scaled(300) < win_percent_scaled(300, 1.5)


def test_recomputed_accuracy_matches_the_review(fake_engine):
    for name in ("scholar.pgn", "hanging_queen.pgn", "legal.pgn"):
        review = review_pgn(fixture_pgn(name), fake_engine, depth=1)
        for color in ("white", "black"):
            assert accuracy_from_evals(review, color) == review["summary"][color]["accuracy"], (name, color)


def test_best_scale_and_fits(fake_engine):
    review = review_pgn(fixture_pgn("hanging_queen.pgn"), fake_engine, depth=1)
    ours = accuracy_from_evals(review, "black")
    # If chess.com's number is exactly ours, scale 1.0 is (one of) the best.
    best = best_scale([(review, "black", ours)])
    assert best["mae"] == 0.0
    assert error_stats([(80, 70), (60, 65)]) == {"n": 2, "mae": 7.5, "bias": 2.5}
    assert linear_fit([(80, 70), (60, 50), (70, 60)]) == (1.0, -10.0)
    assert linear_fit([(1, 1)]) is None
