"""Reusing a stored review for whichever player asks for it.

A review is stored once per game, but both players can review the same game. The analysis is the
same for both; only the point of view differs (player_color, key moments, their own stats).
"""

from __future__ import annotations

from .review import review_for


def color_of(review: dict, username: str | None) -> str | None:
    """Which side `username` played in a reviewed game (None if they didn't play it)."""
    if not username:
        return None
    game = review.get("game") or {}
    headers = review.get("headers") or {}
    for color in ("white", "black"):
        name = game.get(color) or headers.get(color.capitalize()) or ""
        if name.lower() == username.lower():
            return color
    return None


def cached_review(store, username: str, game_id: str, depth: int, game: dict | None = None) -> dict | None:
    """The stored review of `game_id` at `depth` or deeper, from `username`'s side.

    When the stored review was made by the opponent, this player's side is saved too (their
    mistakes, puzzles and stats), without analysing the game again.
    """
    cached = store.get_review(game_id)
    if not cached or cached.get("depth", 0) < depth:
        return None
    color = (game or {}).get("player_color") or color_of(cached, username)
    view = review_for(cached, color)
    fresh = {k: v for k, v in (game or {}).items() if k != "pgn"}
    # chess.com's own accuracy appears once the game is reviewed there: carry it into the cache.
    newer_meta = fresh.get("chesscom_white_accuracy") is not None and cached.get("game") != fresh
    if view is not cached or newer_meta:
        meta = fresh or {**(cached.get("game") or {}), "player_color": color}
        view = {**view, "game": meta}
        store.save_review(username, {**meta, "id": game_id}, view)
    return view
