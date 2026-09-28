"""Flat-file job store: one folder per job under ./data/jobs/{id}/ holding the
upload, audio.wav, job.json (status) and report.json.

v1 runs one pipeline at a time through FastAPI BackgroundTasks. To scale out,
replace this module and the BackgroundTasks call with a Celery (or RQ) worker
backed by Redis, and job.json with a database row; the pipeline itself does
not change.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from . import config

DATA_DIR = config.DATA_DIR
JOB_ID_RE = re.compile(r"^[0-9a-f]{32}$")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def job_dir(job_id: str) -> Path:
    if not JOB_ID_RE.match(job_id):
        raise KeyError(job_id)
    return DATA_DIR / job_id


def _write(path: Path, data: dict) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def create(filename: str) -> str:
    job_id = uuid.uuid4().hex
    d = DATA_DIR / job_id
    d.mkdir(parents=True, exist_ok=False)
    _write(d / "job.json", {"id": job_id, "status": "queued", "progress": 0.0, "stage": "uploaded",
                            "error": None, "filename": filename, "created_at": now_iso()})
    return job_id


def read(job_id: str) -> dict:
    path = job_dir(job_id) / "job.json"
    if not path.exists():
        raise KeyError(job_id)
    return json.loads(path.read_text(encoding="utf-8"))


def update(job_id: str, **fields) -> dict:
    job = {**read(job_id), **fields}
    _write(job_dir(job_id) / "job.json", job)
    return job


def delete(job_id: str) -> None:
    shutil.rmtree(job_dir(job_id), ignore_errors=True)


def write_report(job_id: str, report: dict) -> None:
    _write(job_dir(job_id) / "report.json", report)


def read_report(job_id: str) -> dict:
    return json.loads((job_dir(job_id) / "report.json").read_text(encoding="utf-8"))


def cleanup(max_age_hours: float) -> int:
    """Delete job folders (upload, audio, report) older than max_age_hours. Returns the count.

    Age comes from the folder's newest file, so a job still being processed is kept.
    """
    if max_age_hours <= 0 or not DATA_DIR.exists():
        return 0
    cutoff, removed = time.time() - max_age_hours * 3600, 0
    for d in DATA_DIR.iterdir():
        if not (d.is_dir() and JOB_ID_RE.match(d.name)):
            continue
        newest = max((f.stat().st_mtime for f in d.iterdir()), default=d.stat().st_mtime)
        if newest < cutoff:
            shutil.rmtree(d, ignore_errors=True)
            removed += 1
    return removed
