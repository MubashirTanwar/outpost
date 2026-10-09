"""Tiny in-process job runner so long engine work can report progress to the UI."""

from __future__ import annotations

import threading
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

# One worker: the engine is a single process, so analyses queue rather than fight over it.
_pool = ThreadPoolExecutor(max_workers=1)
_jobs: dict[str, dict[str, Any]] = {}
_lock = threading.Lock()


def submit(kind: str, fn: Callable[[Callable[[str, float], None]], Any]) -> str:
    job_id = uuid.uuid4().hex[:12]
    with _lock:
        _jobs[job_id] = {"id": job_id, "kind": kind, "status": "queued", "stage": "Queued", "progress": 0.0,
                         "result": None, "error": None}

    def progress(stage: str, frac: float) -> None:
        with _lock:
            _jobs[job_id].update(stage=stage, progress=round(min(max(frac, 0.0), 1.0), 3))

    def run() -> None:
        with _lock:
            _jobs[job_id]["status"] = "running"
        try:
            result = fn(progress)
            with _lock:
                _jobs[job_id].update(status="done", progress=1.0, stage="Done", result=result)
        except Exception as exc:  # surfaced to the UI
            traceback.print_exc()
            with _lock:
                _jobs[job_id].update(status="error", error=str(exc))

    _pool.submit(run)
    return job_id


def get(job_id: str) -> dict[str, Any] | None:
    with _lock:
        job = _jobs.get(job_id)
        return dict(job) if job else None
