"""Fetch games from the public chess.com API (https://www.chess.com/news/view/published-data-api)."""

from __future__ import annotations

import io
import re
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta, timezone

import chess.pgn
import httpx

from .config import get_settings

API = "https://api.chess.com/pub"


class ChessComError(RuntimeError):
    pass


@dataclass
class GameSummary:
    id: str
    url: str
    pgn: str
    end_time: int
    time_class: str
    time_control: str
    rated: bool
    white: str
    black: str
    white_rating: int | None
    black_rating: int | None
    white_result: str
    black_result: str
    eco: str | None
    opening: str | None
    player_color: str | None = None
    # chess.com's own accuracy, present once the game has been reviewed on chess.com.
    chesscom_white_accuracy: float | None = None
    chesscom_black_accuracy: float | None = None

    def to_dict(self) -> dict:
        data = asdict(self)
        data.pop("pgn")
        return data

    @property
    def player_result(self) -> str | None:
        if self.player_color == "white":
            return _normalise_result(self.white_result)
        if self.player_color == "black":
            return _normalise_result(self.black_result)
        return None


def _normalise_result(code: str) -> str:
    if code == "win":
        return "win"
    if code in {"agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"}:
        return "draw"
    return "loss"


def opening_name_from_url(url: str | None) -> str | None:
    """chess.com puts the opening in the ECOUrl header slug, e.g. .../openings/Sicilian-Defense-Najdorf..."""
    if not url:
        return None
    slug = url.rstrip("/").rsplit("/", 1)[-1]
    # Drop trailing move lists such as "...-3.Nc3-Bb4".
    slug = re.split(r"-\d+\.", slug, maxsplit=1)[0]
    return slug.replace("-", " ") or None


def _client() -> httpx.Client:
    return httpx.Client(
        headers={"User-Agent": get_settings().chesscom_user_agent},
        timeout=20,
        follow_redirects=True,
    )


def _get_json(client: httpx.Client, url: str) -> dict:
    resp = client.get(url)
    if resp.status_code == 404:
        raise ChessComError(f"Not found on chess.com: {url}")
    resp.raise_for_status()
    return resp.json()


def parse_game(raw: dict, username: str | None = None) -> GameSummary | None:
    pgn = raw.get("pgn")
    if not pgn or raw.get("rules", "chess") != "chess":
        return None  # skip variants (chess960, bughouse, ...)
    game = chess.pgn.read_game(io.StringIO(pgn))
    headers = game.headers if game else {}
    white, black = raw.get("white", {}), raw.get("black", {})
    summary = GameSummary(
        id=raw.get("uuid") or raw.get("url", "").rsplit("/", 1)[-1],
        url=raw.get("url", ""),
        pgn=pgn,
        end_time=int(raw.get("end_time", 0)),
        time_class=raw.get("time_class", ""),
        time_control=raw.get("time_control", ""),
        rated=bool(raw.get("rated", False)),
        white=white.get("username", headers.get("White", "?")),
        black=black.get("username", headers.get("Black", "?")),
        white_rating=white.get("rating"),
        black_rating=black.get("rating"),
        white_result=white.get("result", ""),
        black_result=black.get("result", ""),
        eco=headers.get("ECO"),
        opening=opening_name_from_url(headers.get("ECOUrl")),
        chesscom_white_accuracy=(raw.get("accuracies") or {}).get("white"),
        chesscom_black_accuracy=(raw.get("accuracies") or {}).get("black"),
    )
    if username:
        if summary.white.lower() == username.lower():
            summary.player_color = "white"
        elif summary.black.lower() == username.lower():
            summary.player_color = "black"
    return summary


def player_exists(username: str) -> bool:
    with _client() as client:
        try:
            _get_json(client, f"{API}/player/{username.lower()}")
            return True
        except ChessComError:
            return False


def fetch_games_for_day(username: str, day: date, tz_offset_minutes: int = 0) -> list[GameSummary]:
    """All standard-chess games that *ended* on `day` in the player's local time zone."""
    tz = timezone(timedelta(minutes=tz_offset_minutes))
    start = datetime(day.year, day.month, day.day, tzinfo=tz)
    end = start + timedelta(days=1)
    return fetch_games_between(username, int(start.timestamp()), int(end.timestamp()))


def fetch_games_between(username: str, start_ts: int, end_ts: int) -> list[GameSummary]:
    """All standard-chess games that ended in [start_ts, end_ts), oldest first."""
    # The range can span several UTC months (a local day can straddle two), so check every one.
    first = datetime.fromtimestamp(start_ts, timezone.utc)
    last = datetime.fromtimestamp(max(start_ts, end_ts - 1), timezone.utc)
    months, (y, m) = [], (first.year, first.month)
    while (y, m) <= (last.year, last.month):
        months.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    games: list[GameSummary] = []
    with _client() as client:
        for year, month in months:
            try:
                data = _get_json(client, f"{API}/player/{username.lower()}/games/{year}/{month:02d}")
            except ChessComError:
                continue
            for raw in data.get("games", []):
                if start_ts <= int(raw.get("end_time", 0)) < end_ts:
                    parsed = parse_game(raw, username)
                    if parsed:
                        games.append(parsed)
    games.sort(key=lambda g: g.end_time)
    return games


def fetch_recent_games(username: str, limit: int = 20) -> list[GameSummary]:
    """Most recent games across the latest monthly archives."""
    with _client() as client:
        archives = _get_json(client, f"{API}/player/{username.lower()}/games/archives").get("archives", [])
        games: list[GameSummary] = []
        for archive_url in reversed(archives):
            for raw in reversed(_get_json(client, archive_url).get("games", [])):
                parsed = parse_game(raw, username)
                if parsed:
                    games.append(parsed)
                if len(games) >= limit:
                    return games
        return games
