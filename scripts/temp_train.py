"""Fit a temporary threshold profile on the Creative Commons reference videos.

The pose model is not retrained. This sweeps a few hand-assignment and strike
settings, keeps a change only when the reference clips match better than the
shipped defaults, and writes tuning.temp.json. The remote server loads that
file when it is present (SIO_TEMP_TRAINING=1 in scripts/serve-remote.ps1).
Delete the file and restart to go back to the shipped defaults.

  $env:SIO_YOUTUBE_DIR = 'D:\\Stickitout-dataset\\reference-videos'
  python -m scripts.temp_train
"""
from __future__ import annotations

import json
import os
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import tuning  # noqa: E402
from scripts.youtube_batch import CLIPS, analyse_clip  # noqa: E402
from scripts.youtube_download import OUT  # noqa: E402

CANDIDATES = [
    {},
    {"hand_source": "strike_first"},
    {"strike_min_prominence": 0.012},
    {"strike_min_prominence": 0.03},
    {"hand_window_ms": 60},
    {"hand_source": "strike_first", "strike_min_prominence": 0.012},
    {"hand_source": "strike_first", "hand_window_ms": 60},
    {"strike_min_prominence": 0.012, "hand_window_ms": 60},
]


def clips() -> list[dict]:
    rows = []
    seen = set()
    csv_rows = []
    path = OUT / "downloads.csv"
    if path.exists():
        import csv
        csv_rows = list(csv.DictReader(open(path, encoding="utf-8")))
    by_id = {r["video_id"]: r for r in csv_rows}
    for video in sorted(CLIPS.rglob("*.mp4")):
        if video.parent.name.startswith("_"):
            continue
        vid = video.stem
        if vid in seen:
            continue
        seen.add(vid)
        meta = by_id.get(vid, {})
        if meta and meta.get("status") not in ("", "ok"):
            continue
        rows.append({
            "video_id": vid,
            "rudiment": video.parent.name,
            "file": video.relative_to(CLIPS).as_posix(),
            "angle_frames": meta.get("angle_frames") or "",
        })
    return rows


def score(rows: list[dict]) -> float | None:
    ok = [r for r in rows if not r.get("error") and r.get("match_rate_pct") is not None]
    if not ok:
        return None
    match = statistics.median(r["match_rate_pct"] for r in ok)
    lifts = [r["lift_pct"] for r in ok if r.get("lift_pct") is not None]
    lift = statistics.median(lifts) if lifts else 0.0
    return round(match + lift, 2)


def run(values: dict, items: list[dict]) -> list[dict]:
    rows = []
    with tuning.override(values):
        for d in items:
            try:
                rows.append(analyse_clip(d, 12.0))
            except Exception as exc:
                rows.append({"video_id": d["video_id"], "rudiment": d["rudiment"], "error": f"{type(exc).__name__}: {exc}"})
    return rows


def main() -> int:
    if not CLIPS.exists():
        print(f"No reference folder at {CLIPS}. Set SIO_YOUTUBE_DIR.", flush=True)
        return 1
    items = clips()
    if not items:
        print(f"No reference videos in {CLIPS}", flush=True)
        return 1
    print(f"{len(items)} reference clips in {CLIPS}", flush=True)
    best_values: dict = {}
    best_score = None
    best_rows: list[dict] = []
    for i, values in enumerate(CANDIDATES, 1):
        t0 = time.time()
        rows = run(values, items)
        s = score(rows)
        label = json.dumps(values) if values else "defaults"
        print(f"[{i}/{len(CANDIDATES)}] {label} score {s} [{time.time() - t0:.0f}s]", flush=True)
        if s is None:
            continue
        if best_score is None or s > best_score + 0.5:
            best_score, best_values, best_rows = s, values, rows
    default_rows = best_rows if best_values == {} else run({}, items)
    default_score = score(default_rows)
    chosen = best_values if (best_score or 0) > (default_score or 0) + 0.5 else {}
    chosen_score = best_score if chosen else default_score
    out = {
        "_comment": (
            "Temporary profile fit on the CC-BY reference videos in "
            f"{CLIPS}. Score {chosen_score} versus shipped defaults {default_score}. "
            "Delete this file and restart the analyzer to restore shipped thresholds."
        ),
        **chosen,
    }
    dest = ROOT / "tuning.temp.json"
    dest.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    report = ROOT / "reports" / "temp-training.json"
    report.parent.mkdir(exist_ok=True)
    report.write_text(json.dumps({
        "clips": len(items),
        "default_score": default_score,
        "chosen_score": chosen_score,
        "chosen": chosen,
        "rows": best_rows if chosen else default_rows,
    }, indent=1), encoding="utf-8")
    print(f"wrote {dest} ({'no threshold change' if not chosen else chosen})", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
