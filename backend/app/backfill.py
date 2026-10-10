"""Analyse every game from the last N days in the background, so the progress charts have data."""

from __future__ import annotations

import time
from typing import Callable

from . import chesscom
from .engine import get_engine
from .graph_store import get_store
from .review import review_pgn
from .review_cache import cached_review


def run_backfill(username: str, days: int, depth: int, progress: Callable[[str, float], None],
                 fetch: Callable[[str, int, int], list] | None = None) -> dict:
    """Review (and store) each game that ended in the last `days` days and isn't reviewed yet.

    Games already reviewed at `depth` or deeper are skipped, so running it again only picks up
    new games. Newest games go first: they matter most for the charts and the day reviews.
    """
    progress("Fetching your games from chess.com", 0.0)
    now = int(time.time())
    games = (fetch or chesscom.fetch_games_between)(username, now - days * 86400, now + 60)
    store, engine = get_store(), get_engine()
    todo = [g for g in reversed(games)
            if not cached_review(store, username, g.id, depth, {**g.to_dict(), "pgn": g.pgn})]
    skipped = len(games) - len(todo)
    for i, g in enumerate(todo):
        progress(f"Analysing game {i + 1} of {len(todo)}", i / max(1, len(todo)))
        game = {**g.to_dict(), "pgn": g.pgn}

        def on_position(done: int, total: int, i: int = i) -> None:
            progress(f"Analysing game {i + 1} of {len(todo)}", (i + done / total) / len(todo))

        review = review_pgn(g.pgn, engine, depth=depth, player_color=g.player_color, progress=on_position)
        review["game"] = {k: v for k, v in game.items() if k != "pgn"}
        store.save_review(username, game, review)
    return {"games": len(games), "analysed": len(todo), "already_reviewed": skipped}
