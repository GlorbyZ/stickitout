"""Runtime settings from environment variables (same names in Docker, compose and local runs).

  PORT            HTTP port (read by the start scripts and the Docker CMD; default 8800)
  DATA_DIR        job storage folder (default ./data/jobs; ANALYZER_DATA_DIR also accepted)
  MAX_UPLOAD_MB   upload size cap in MB (default 1024; behind Cloudflare the page sends files over 80 MB in 64 MB pieces)
  ACCESS_TOKEN    if set, the UI and API require this key (see app/access.py)
  JOB_TTL_HOURS   jobs older than this are deleted, uploads included (default 72; 0 keeps them)
  DATASET_DIR     training clips and their labels (default DATA_DIR/dataset). Never cleaned up.
  TUNING_FILE     JSON file of analyzer thresholds (default ./tuning.json if present; see app/tuning.py)
  MIN_FPS         lowest measured frame rate accepted for analysis (default 23.5, so 24 fps and
                  23.976 fps film rate pass). Clips under 50 fps are analysed with a low
                  frame rate flag and a disclaimer in the report.
"""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    try:
        return float(raw) if raw else default
    except ValueError:
        raise SystemExit(f"{name} must be a number, got {raw!r}")


PORT = int(_float("PORT", 8800))
DATA_DIR = Path(os.environ.get("DATA_DIR") or os.environ.get("ANALYZER_DATA_DIR") or ROOT / "data" / "jobs")
MAX_UPLOAD_MB = _float("MAX_UPLOAD_MB", 1024)
ACCESS_TOKEN = os.environ.get("ACCESS_TOKEN", "").strip()
JOB_TTL_HOURS = _float("JOB_TTL_HOURS", 72)
MIN_FPS = _float("MIN_FPS", 23.5)
DATASET_DIR = Path(os.environ.get("DATASET_DIR") or DATA_DIR / "dataset")
