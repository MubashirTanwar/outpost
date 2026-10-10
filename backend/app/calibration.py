"""Compare our accuracy with chess.com's on the same games, and search for settings that match it better.

chess.com's Game Review (CAPS2) is closed source, but its API reports the accuracy for every game that
has been reviewed there. That gives real numbers to measure against: `scripts/compare_chesscom.py`
reviews a player's recent games and uses these helpers to report how far off we are, and which win%
curve steepness would have matched best.
"""

from __future__ import annotations

import math
from statistics import mean

from .review import game_accuracy, move_accuracy

LICHESS_K = 0.00368208


def win_percent_scaled(cp: int, scale: float = 1.0) -> float:
    """The Lichess expected-score curve with its steepness multiplied by `scale`."""
    cp = max(-1000, min(1000, cp))
    return 50 + 50 * (2 / (1 + math.exp(-LICHESS_K * scale * cp)) - 1)


def accuracy_from_evals(review: dict, color: str, scale: float = 1.0) -> float | None:
    """Recompute a side's game accuracy from the stored evals with a different curve steepness.

    Each move's eval before is the previous move's eval after (the same engine search), so no new
    analysis is needed. With scale=1.0 this reproduces the review's own accuracy.
    """
    accs = []
    prev_cp = review["start_eval"]["cp"]
    for m in review["moves"]:
        sign = 1 if m["color"] == "white" else -1
        before, after = sign * prev_cp, sign * m["eval_cp"]
        prev_cp = m["eval_cp"]
        if m["color"] != color or m["classification"] in {"book", "forced"}:
            continue
        win_after = win_percent_scaled(after, scale)
        win_before = max(win_percent_scaled(before, scale), win_after)
        loss = 0.0 if m["uci"] == m["best_uci"] else win_before - win_after
        accs.append(round(move_accuracy(loss), 1))
    return game_accuracy(accs)


def error_stats(pairs: list[tuple[float, float]]) -> dict:
    """pairs: (ours, chess.com). Mean absolute error and mean bias (positive: we're higher)."""
    if not pairs:
        return {"n": 0, "mae": None, "bias": None}
    return {"n": len(pairs), "mae": round(mean(abs(a - b) for a, b in pairs), 2),
            "bias": round(mean(a - b for a, b in pairs), 2)}


def best_scale(samples: list[tuple[dict, str, float]], scales: list[float] | None = None) -> dict:
    """samples: (review, color, chess.com accuracy). The curve steepness with the lowest error."""
    scales = scales or [round(0.5 + 0.05 * i, 2) for i in range(31)]  # 0.5 .. 2.0
    results = []
    for s in scales:
        pairs = [(acc, cc) for review, color, cc in samples if (acc := accuracy_from_evals(review, color, s)) is not None]
        results.append({"scale": s, **error_stats(pairs)})
    results = [r for r in results if r["n"]]
    return min(results, key=lambda r: r["mae"]) if results else {"scale": 1.0, "n": 0, "mae": None, "bias": None}


def linear_fit(pairs: list[tuple[float, float]]) -> tuple[float, float] | None:
    """Least squares chess.com ~ a * ours + b."""
    if len(pairs) < 3:
        return None
    xs, ys = [p[0] for p in pairs], [p[1] for p in pairs]
    mx, my = mean(xs), mean(ys)
    var = sum((x - mx) ** 2 for x in xs)
    if var == 0:
        return None
    a = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / var
    return round(a, 3), round(my - a * mx, 2)
