"""HTTP API for the chess coach."""

from __future__ import annotations

import hashlib
import io
import json
import logging
import time
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone

import chess
import chess.pgn
import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from . import chesscom, coaching, jobs, llm
from .agents import insights
from .agents.coach import ask_coach, explain_move, stream_coach
from .agents.day_review import run_day_review
from .backfill import run_backfill
from .config import get_settings
from .engine import get_engine
from .graph_store import get_store
from .review import _san_line, review_for, review_pgn
from .review_cache import cached_review, color_of

@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    # Without this, a Stockfish process (or the node one running the WASM build) keeps
    # uvicorn from exiting on Ctrl-C / --reload.
    get_engine().close()
    get_store().close()


app = FastAPI(title="Outpost API", version="0.1.0", lifespan=lifespan)
log = logging.getLogger(__name__)


# Registered before CORS so CORS wraps it: an unexpected crash becomes a JSON 500 the browser can
# read, instead of a header-less 500 that browsers report as "TypeError: Failed to fetch".
@app.exception_handler(chesscom.ChessComError)
async def chesscom_not_found(request: Request, exc: chesscom.ChessComError):
    return JSONResponse({"detail": str(exc)}, status_code=404)


@app.middleware("http")
async def json_errors(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception as exc:  # noqa: BLE001
        log.exception("Unhandled error on %s", request.url.path)
        return JSONResponse({"detail": f"{type(exc).__name__}: {exc}"}, status_code=500)

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
def list_games(username: str, day: date | None = None, tz_offset: int = Query(0, ge=-840, le=840)) -> dict:
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
    tz_offset: int = Field(0, ge=-840, le=840)  # minutes east of UTC
    depth: int | None = Field(None, ge=1, le=30)


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
    try:
        candidates = (chesscom.fetch_games_for_day(req.username, req.day, req.tz_offset) if req.day
                      else chesscom.fetch_recent_games(req.username, limit=100))
    except httpx.HTTPError as exc:  # rate limits, chess.com down
        raise HTTPException(502, f"chess.com request failed: {exc}") from exc
    for g in candidates:
        if g.id == req.game_id:
            return {**g.to_dict(), "pgn": g.pgn}
    raise HTTPException(404, "Game not found in this player's chess.com archive")


@app.post("/api/review/game")
def review_game(req: GameReviewRequest) -> dict:
    """Start (or return cached) review of one game. Returns a job id or the finished review."""
    store = get_store()
    depth = req.depth or get_settings().engine_depth
    if req.game_id and (cached := cached_review(store, req.username, req.game_id, depth)):
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
def get_review(game_id: str, username: str | None = None) -> dict:
    """A stored review; with `username`, seen from that player's side."""
    review = get_store().get_review(game_id)
    if not review:
        raise HTTPException(404, "Not reviewed yet")
    return review_for(review, color_of(review, username)) if username else review


class DayReviewRequest(BaseModel):
    username: str
    day: date
    tz_offset: int = Field(0, ge=-840, le=840)  # minutes east of UTC
    depth: int | None = Field(None, ge=1, le=30)


@app.post("/api/review/day")
def review_day(req: DayReviewRequest) -> dict:
    depth = req.depth or get_settings().engine_depth
    job_id = jobs.submit("day_review", lambda progress: run_day_review(
        req.username, req.day.isoformat(), req.tz_offset, depth, progress=progress))
    return {"job_id": job_id}


class BackfillRequest(BaseModel):
    days: int = Field(30, ge=1, le=365)
    depth: int | None = Field(None, ge=1, le=30)


_backfills: dict[str, str] = {}  # username -> its latest backfill job


@app.post("/api/players/{username}/backfill")
def start_backfill(username: str, req: BackfillRequest) -> dict:
    """Analyse the last N days of games in the background (one job per player at a time)."""
    user = username.lower()
    current = jobs.get(_backfills.get(user, ""))
    if current and current["status"] in {"queued", "running"}:
        return current
    depth = req.depth or get_settings().engine_depth
    job_id = jobs.submit("backfill", lambda progress: run_backfill(username, req.days, depth, progress),
                         background=True)
    _backfills[user] = job_id
    return jobs.get(job_id)


@app.get("/api/players/{username}/backfill")
def backfill_status(username: str) -> dict:
    """The player's latest background analysis, if any (so the page can pick it up after a reload)."""
    return {"job": jobs.get(_backfills.get(username.lower(), ""))}


@app.delete("/api/players/{username}/backfill")
def stop_backfill(username: str) -> dict:
    return {"stopped": jobs.cancel(_backfills.get(username.lower(), ""))}


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
    tz_offset: int = Field(0, ge=-840, le=840)


@app.post("/api/coach/stream")
def chat_stream(req: ChatRequest) -> StreamingResponse:
    """The coach answer as server-sent events: progress while games are reviewed, the report,
    then the answer text piece by piece as the model writes it."""

    def events():
        try:
            for event in stream_coach(req.username, req.message, req.fen, req.history, tz_offset=req.tz_offset):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as exc:  # noqa: BLE001 - the stream has started, so report it in-band
            log.exception("Coach stream failed")
            yield f"data: {json.dumps({'type': 'error', 'detail': f'{type(exc).__name__}: {exc}'})}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/coach/chat")
def chat(req: ChatRequest) -> dict:
    """Coach answer. Questions about your own games may need engine reviews first, so those run as
    a job ({"job_id"}, poll /api/jobs/...); everything else answers straight away."""
    if insights.wants_games(req.message) and not req.fen:
        job_id = jobs.submit("coach", lambda progress: ask_coach(
            req.username, req.message, req.fen, req.history, tz_offset=req.tz_offset, progress=progress))
        return {"job_id": job_id}
    return ask_coach(req.username, req.message, req.fen, req.history)
