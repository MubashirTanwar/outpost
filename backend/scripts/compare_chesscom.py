"""How close are our reviews to chess.com's? Run it on your own games.

    cd backend && python scripts/compare_chesscom.py YOUR_USERNAME --games 30

It fetches your recent games that have been reviewed on chess.com (only those carry chess.com's
accuracy), reviews them with our engine, and prints both accuracies side by side, the average
error, and the win% curve steepness that would have matched chess.com best. The details are saved
to compare-<username>.json, so the settings can be tuned on real games.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.calibration import accuracy_from_evals, best_scale, error_stats, linear_fit  # noqa: E402
from app.chesscom import fetch_recent_games  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.engine import get_engine  # noqa: E402
from app.review import review_pgn  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("username")
    ap.add_argument("--games", type=int, default=20, help="how many reviewed games to compare")
    ap.add_argument("--scan", type=int, default=200, help="how many recent games to look through")
    ap.add_argument("--depth", type=int, default=get_settings().engine_depth)
    args = ap.parse_args()

    games = [g for g in fetch_recent_games(args.username, limit=args.scan) if g.chesscom_white_accuracy is not None]
    games = games[: args.games]
    if not games:
        print("None of your recent games have chess.com accuracies yet: open a few in chess.com's Game Review first.")
        return 1

    engine = get_engine()
    samples, rows = [], []
    print(f"{'game':<12} {'side':<6} {'ours':>6} {'chess.com':>9} {'diff':>6}")
    for g in games:
        review = review_pgn(g.pgn, engine, depth=args.depth, player_color=g.player_color)
        for color in ("white", "black"):
            cc = getattr(g, f"chesscom_{color}_accuracy")
            ours = review["summary"][color]["accuracy"]
            if cc is None or ours is None:
                continue
            samples.append((review, color, cc))
            mine = color == g.player_color
            rows.append({"game": g.url, "color": color, "you": mine, "ours": ours, "chesscom": cc,
                         "counts": review["summary"][color]["counts"]})
            print(f"{g.id[:12]:<12} {color + ('*' if mine else ''):<6} {ours:>6.1f} {cc:>9.1f} {ours - cc:>+6.1f}")

    pairs = [(r["ours"], r["chesscom"]) for r in rows]
    stats, best, fit = error_stats(pairs), best_scale(samples), linear_fit(pairs)
    print(f"\n{stats['n']} sides compared at depth {args.depth} (* = you)")
    print(f"Average error {stats['mae']} points; on average we are {stats['bias']:+} vs chess.com")
    print(f"Best win% curve steepness: x{best['scale']} (average error {best['mae']}, bias {best['bias']:+})")
    if fit:
        print(f"Linear map: chess.com ~ {fit[0]} x ours {fit[1]:+}")
    out = Path(f"compare-{args.username.lower()}.json")
    out.write_text(json.dumps({"depth": args.depth, "stats": stats, "best_scale": best, "linear_fit": fit, "rows": rows}, indent=1))
    print(f"Details saved to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
