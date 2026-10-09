"""HTTP API for the chess coach."""

from __future__ import annotations

import hashlib
import io
import json
import time
from datetime import date, datetime, timedelta, timezone

import chess
import chess.pgn
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import chesscom, coaching, jobs, llm
from .agents.coach import ask_coach, explain_move
from .agents.day_review import run_day_review
from .config import get_settings
from .engine import get_engine
from .graph_store import get_store
from .review import _san_line, review_pgn

app = FastAPI(title="Outpost API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in get_settings().cors_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(chesscom.ChessComError)
async def _chesscom_error(_, exc: chesscom.ChessComError):
    from fastapi.responses import JSONResponse

    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.get("/api/health")
def health() -> dict:
    return {
        "engine": get_engine().available(),
        "graph": get_store().backend,
        "llm": llm.provider(),
        "depth": get_settings().engine_depth,
    }


def _day_bounds(day: date, tz_offset: int) -> tuple[int, int]:
    start = datetime(day.year, day.month, day.day, tzinfo=timezone(timedelta(minutes=tz_offset)))
    return int(start.timestamp()), int((start + timedelta(days=1)).timestamp())


@app.get("/api/players/{username}/games")
def list_games(username: str, day: date | None = None, tz_offset: int = 0) -> dict:
    """Games for a day from chess.com, marked with whether we've already reviewed them."""
    try:
        if day:
            games = chesscom.fetch_games_for_day(username, day, tz_offset)
        else:
            games = chesscom.fetch_recent_games(username, limit=30)
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"chess.com request failed: {exc}") from exc
    store = get_store()
    reviewed = {g["id"]: g for g in store.list_games(username)}
    return {"games": [
        {**g.to_dict(), "reviewed": g.id in reviewed, "accuracy": reviewed.get(g.id, {}).get("accuracy")}
        for g in games
    ]}


class GameReviewRequest(BaseModel):
    username: str
    game_id: str | None = None
    pgn: str | None = None
    day: date | None = None  # where to look for game_id on chess.com
    tz_offset: int = 0
    depth: int | None = None


def _find_game(req: GameReviewRequest) -> dict:
    if req.pgn:
        game = chess.pgn.read_game(io.StringIO(req.pgn))
        if game is None:
            raise HTTPException(400, "Invalid PGN")
        h = game.headers
        color = "white" if h.get("White", "").lower() == req.username.lower() else (
            "black" if h.get("Black", "").lower() == req.username.lower() else None)
        return {"id": req.game_id or "pgn-" + hashlib.sha1(req.pgn.encode()).hexdigest()[:12], "url": h.get("Link", ""),
                "pgn": req.pgn, "end_time": int(time.time()), "time_class": "", "time_control": h.get("TimeControl", ""),
                "rated": False, "white": h.get("White", "?"), "black": h.get("Black", "?"),
                "white_rating": None, "black_rating": None,
                "white_result": "win" if h.get("Result") == "1-0" else ("agreed" if h.get("Result") == "1/2-1/2" else "lose"),
                "black_result": "win" if h.get("Result") == "0-1" else ("agreed" if h.get("Result") == "1/2-1/2" else "lose"),
                "eco": h.get("ECO"), "opening": chesscom.opening_name_from_url(h.get("ECOUrl")), "player_color": color}
    candidates = (chesscom.fetch_games_for_day(req.username, req.day, req.tz_offset) if req.day
                  else chesscom.fetch_recent_games(req.username, limit=100))
    for g in candidates:
        if g.id == req.game_id:
            return {**g.to_dict(), "pgn": g.pgn}
    raise HTTPException(404, "Game not found in this player's chess.com archive")


@app.post("/api/review/game")
def review_game(req: GameReviewRequest) -> dict:
    """Start (or return cached) review of one game. Returns a job id or the finished review."""
    store = get_store()
    depth = req.depth or get_settings().engine_depth
    if req.game_id and (cached := store.get_review(req.game_id)) and cached.get("depth", 0) >= depth:
        return {"status": "done", "game_id": req.game_id, "review": cached}
    game = _find_game(req)

    def work(progress):
        review = review_pgn(game["pgn"], get_engine(), depth=depth, player_color=game.get("player_color"),
                            progress=lambda d, t: progress(f"Analyzing move {d}/{t}", d / t))
        review["game"] = {k: v for k, v in game.items() if k != "pgn"}
        store.save_review(req.username, game, review)
        return {"game_id": game["id"], "review": review}

    return {"status": "queued", "game_id": game["id"], "job_id": jobs.submit("game_review", work)}


@app.get("/api/review/game/{game_id}")
def get_review(game_id: str) -> dict:
    review = get_store().get_review(game_id)
    if not review:
        raise HTTPException(404, "Not reviewed yet")
    return review


class DayReviewRequest(BaseModel):
    username: str
    day: date
    tz_offset: int = 0
    depth: int | None = None


@app.post("/api/review/day")
def review_day(req: DayReviewRequest) -> dict:
    depth = req.depth or get_settings().engine_depth
    job_id = jobs.submit("day_review", lambda progress: run_day_review(
        req.username, req.day.isoformat(), req.tz_offset, depth, progress=progress))
    return {"job_id": job_id}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str) -> dict:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Unknown job")
    return job


class ExplainRequest(BaseModel):
    game_id: str
    ply: int


@app.post("/api/explain")
def explain(req: ExplainRequest) -> dict:
    review = get_store().get_review(req.game_id)
    if not review:
        raise HTTPException(404, "Not reviewed yet")
    move = next((m for m in review["moves"] if m["ply"] == req.ply), None)
    if not move:
        raise HTTPException(404, "No such move")
    return explain_move(move, review.get("player_color"))


@app.get("/api/players/{username}/profile")
def profile(username: str) -> dict:
    prof = get_store().weakness_profile(username)
    prof["motif_info"] = {m["motif"]: coaching.motif_info(m["motif"]) for m in prof["motifs"]}
    return prof


@app.get("/api/players/{username}/history")
def history(username: str, days: int = 365) -> dict:
    since = int(time.time()) - days * 86400
    return {"games": get_store().list_games(username, since=since)}


@app.get("/api/players/{username}/puzzles")
def puzzles(username: str, motif: str | None = None, limit: int = 20) -> dict:
    return {"puzzles": get_store().puzzles(username, motif=motif, limit=limit)}


class AttemptRequest(BaseModel):
    username: str
    solved: bool


@app.post("/api/puzzles/{puzzle_id}/attempt")
def attempt(puzzle_id: str, req: AttemptRequest) -> dict:
    return get_store().record_attempt(req.username, puzzle_id, req.solved)


@app.get("/api/players/{username}/progress")
def get_progress(username: str) -> dict:
    """Opening-course progress (XP, spaced-repetition state) synced from the web app."""
    return {"progress": get_store().get_progress(username)}


@app.put("/api/players/{username}/progress")
def put_progress(username: str, progress: dict) -> dict:
    if not isinstance(progress.get("lines"), dict) or len(json.dumps(progress)) > 2_000_000:
        raise HTTPException(400, "Invalid progress payload")
    get_store().save_progress(username, progress)
    return {"ok": True}


@app.get("/api/openings")
def openings() -> dict:
    return {"openings": coaching.openings()}


@app.get("/api/endgames")
def endgames() -> dict:
    return coaching.endgame_course()


class AnalyzeRequest(BaseModel):
    fen: str
    depth: int = Field(16, ge=1, le=30)
    multipv: int = Field(3, ge=1, le=5)


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest) -> dict:
    try:
        board = chess.Board(req.fen)
    except ValueError as exc:
        raise HTTPException(400, "Invalid FEN") from exc
    lines = get_engine().analyse(board, depth=req.depth, multipv=req.multipv)
    return {"lines": [{**l.to_dict(), "san": _san_line(board, l.pv, 10)} for l in lines]}


class ChatRequest(BaseModel):
    username: str
    message: str
    fen: str | None = None
    history: list[dict] = []


@app.post("/api/coach/chat")
def chat(req: ChatRequest) -> dict:
    return ask_coach(req.username, req.message, req.fen, req.history)
