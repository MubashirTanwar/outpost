"""Tiny in-process job runner so long engine work can report progress to the UI."""

from __future__ import annotations

import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

# One worker: the engine is a single process, so analyses queue rather than fight over it.
_pool = ThreadPoolExecutor(max_workers=1)
# Long background work (e.g. analysing a month of games) gets its own worker so it doesn't hold up
# interactive reviews for an hour; the two share the engine position by position.
_background = ThreadPoolExecutor(max_workers=1)
_jobs: dict[str, dict[str, Any]] = {}
_lock = threading.Lock()


class Cancelled(Exception):
    """Raised inside a job's progress callback once the job has been cancelled."""


KEEP_FINISHED_S = 3600  # finished jobs (and their results) are forgotten after an hour


def _evict_finished(now: float) -> None:
    for jid in [j for j, job in _jobs.items() if job.get("finished_at") and now - job["finished_at"] > KEEP_FINISHED_S]:
        del _jobs[jid]


def submit(kind: str, fn: Callable[[Callable[[str, float], None]], Any], background: bool = False) -> str:
    job_id = uuid.uuid4().hex[:12]
    with _lock:
        _evict_finished(time.time())
        _jobs[job_id] = {"id": job_id, "kind": kind, "status": "queued", "stage": "Queued", "progress": 0.0,
                         "result": None, "error": None, "cancel": False}

    def progress(stage: str, frac: float) -> None:
        with _lock:
            if _jobs[job_id]["cancel"]:
                raise Cancelled()
            _jobs[job_id].update(stage=stage, progress=round(min(max(frac, 0.0), 1.0), 3))

    def run() -> None:
        with _lock:
            _jobs[job_id]["status"] = "running"
        try:
            result = fn(progress)
            with _lock:
                _jobs[job_id].update(status="done", progress=1.0, stage="Done", result=result, finished_at=time.time())
        except Cancelled:
            with _lock:
                _jobs[job_id].update(status="cancelled", stage="Stopped", finished_at=time.time())
        except Exception as exc:  # surfaced to the UI
            traceback.print_exc()
            with _lock:
                _jobs[job_id].update(status="error", error=str(exc), finished_at=time.time())

    (_background if background else _pool).submit(run)
    return job_id


def get(job_id: str) -> dict[str, Any] | None:
    with _lock:
        job = _jobs.get(job_id)
        return {k: v for k, v in job.items() if k not in {"cancel", "finished_at"}} if job else None


def cancel(job_id: str) -> bool:
    """Ask a job to stop; it does at its next progress report."""
    with _lock:
        job = _jobs.get(job_id)
        if not job or job["status"] not in {"queued", "running"}:
            return False
        job["cancel"] = True
        return True
