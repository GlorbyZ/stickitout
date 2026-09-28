"""Accuracy-training dataset: real clips plus hand-made labels, one folder per clip.

  DATASET_DIR/<clip_id>/            (DATASET_DIR defaults to DATA_DIR/dataset)
    video.<ext>        the original upload, byte for byte
    labels.json        strokes and clip metadata (app/labels.py, schema/labels.schema.json)
    labels.prev.json   the previous save, as a one-step backup
    analysis.json      the analyzer's report at intake (pre-fills the stroke list)
    status.json        intake progress: queued, processing, ready or error
    audio.wav          extracted soundtrack
    waveform.json      200 peaks per second for the labeling timeline
    preview.mp4        H.264 copy for browsers, only when the original codec will not play (HEVC and so on)
    cache/             MediaPipe landmarks cache, so evaluation re-runs are quick

Clips are never deleted automatically (job cleanup only touches job folders).
"""
from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import config, jobs, labels, pipeline, tuning
from .audio import load_wav
from .media import MediaError, _run

DATASET_DIR = config.DATASET_DIR
WAVEFORM_RATE = 200                     # peaks per second
BROWSER_CODECS = {"h264", "vp8", "vp9", "av1"}
BROWSER_CONTAINERS = {".mp4", ".m4v", ".mov", ".webm"}
DEFAULT_RUDIMENT = "Single Paradiddle"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def clip_dir(clip_id: str) -> Path:
    if not isinstance(clip_id, str) or not labels.CLIP_ID_RE.match(clip_id):
        raise KeyError(clip_id)
    return Path(DATASET_DIR) / clip_id


def new_clip_id(filename: str) -> str:
    stem = re.sub(r"[^a-z0-9]+", "-", Path(filename or "clip").stem.lower()).strip("-")[:28].strip("-") or "clip"
    return f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{stem}-{secrets.token_hex(2)}"


def _write_json(path: Path, data: dict) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def _read_json(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def exists(clip_id: str) -> bool:
    try:
        return (clip_dir(clip_id) / "labels.json").exists()
    except KeyError:
        return False


def read_labels(clip_id: str) -> dict:
    data = _read_json(clip_dir(clip_id) / "labels.json")
    if data is None:
        raise KeyError(clip_id)
    return data


def read_status(clip_id: str) -> dict:
    return _read_json(clip_dir(clip_id) / "status.json", {"state": "ready", "stage": None, "progress": 1.0, "error": None})


def set_status(clip_id: str, **fields) -> dict:
    status = {**read_status(clip_id), **fields, "updated_at": now_iso()}
    _write_json(clip_dir(clip_id) / "status.json", status)
    return status


def create(filename: str, ext: str, source: str = "upload", meta: dict | None = None) -> tuple[str, Path]:
    """Make the clip folder, labels.json skeleton and status. Returns (clip_id, path for the video)."""
    clip_id = new_clip_id(filename)
    d = clip_dir(clip_id)
    d.mkdir(parents=True, exist_ok=False)
    video_file = f"video{ext}"
    data = labels.new_labels(clip_id, video_file, Path(filename).name, source, now_iso(), labels.validate_meta(meta or {}))
    _write_json(d / "labels.json", data)
    _write_json(d / "status.json", {"state": "queued", "stage": "uploaded", "progress": 0.0, "error": None})
    return clip_id, d / video_file


def delete(clip_id: str) -> None:
    shutil.rmtree(clip_dir(clip_id), ignore_errors=True)


def add_from_job(job_id: str) -> str:
    """Copy a finished analysis job (its original upload and report) into the dataset."""
    job = jobs.read(job_id)
    if job["status"] != "done":
        raise ValueError("Only a finished analysis can be added to the training set.")
    jd = jobs.job_dir(job_id)
    src = jd / job.get("video_file", "")
    if not job.get("video_file") or not src.exists():
        raise ValueError("The original video for this analysis is gone (old analyses are deleted after a few days).")
    report = jobs.read_report(job_id)
    params = report.get("params", {})
    meta = {"rudiment": params.get("rudiment") or "", "click_bpm": params.get("target_bpm"),
            "fps": report.get("source", {}).get("fps")}
    for d in Path(DATASET_DIR).glob("*/labels.json"):          # the same job added twice points to the first copy
        if (_read_json(d.parent / "analysis.json", {}) or {}).get("job_id") == job_id:
            return d.parent.name
    clip_id, video_path = create(job.get("filename") or src.name, src.suffix.lower(), "job", meta)
    d = clip_dir(clip_id)
    shutil.copy2(src, video_path)
    _write_json(d / "analysis.json", report)
    if (jd / "audio.wav").exists():
        shutil.copy2(jd / "audio.wav", d / "audio.wav")
    return clip_id


def analysis_params(meta: dict) -> dict:
    return {"rudiment": (meta.get("rudiment") or DEFAULT_RUDIMENT).strip()[:80] or DEFAULT_RUDIMENT,
            "target_bpm": meta.get("click_bpm"), "av_offset_ms": 0.0,
            "verify_window_ms": float(tuning.current().verify_window_ms)}


def video_codec(path: Path) -> str:
    header = _run(["-i", str(path)]).stderr
    m = re.search(r"Video: ([A-Za-z0-9_]+)", header)
    return m.group(1).lower() if m else ""


def needs_preview(path: Path) -> bool:
    return path.suffix.lower() not in BROWSER_CONTAINERS or video_codec(path) not in BROWSER_CODECS


def make_preview(src: Path, out: Path) -> Path:
    """H.264/AAC copy (max 720 px tall) with the original frame timing, for browsers that cannot play the original."""
    tmp = out.with_name(out.stem + ".tmp.mp4")
    res = _run(["-y", "-i", str(src), "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast",
                "-crf", "22", "-pix_fmt", "yuv420p", "-vf", "scale=-2:'min(720,ih)'", "-fps_mode", "passthrough",
                "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(tmp)], timeout=1800)
    if res.returncode != 0 or not tmp.exists():
        tmp.unlink(missing_ok=True)
        raise MediaError("Could not make a browser-playable copy of this video.")
    os.replace(tmp, out)
    return out


def write_waveform(wav: Path, out: Path) -> dict:
    y, sr = load_wav(wav)
    hop = max(1, sr // WAVEFORM_RATE)
    n = len(y) // hop
    peaks = np.abs(y[: n * hop]).reshape(n, hop).max(axis=1) if n else np.zeros(0)
    top = float(peaks.max()) if peaks.size and peaks.max() > 0 else 1.0
    data = {"rate": sr / hop, "duration_s": round(len(y) / sr, 3), "peaks": [round(float(p) / top, 3) for p in peaks]}
    _write_json(out, data)
    return data


def process(clip_id: str, reanalyze: bool = False) -> None:
    """Background intake: analyse (unless a report came with the clip), waveform, preview, pre-fill."""
    d = clip_dir(clip_id)

    def stage(name: str, progress: float) -> None:
        set_status(clip_id, state="processing", stage=name, progress=round(progress * 0.9, 3))

    try:
        data = read_labels(clip_id)
        video = d / data["video_file"]
        report = None if reanalyze else _read_json(d / "analysis.json")
        if report is None:
            info, audio, analysed = pipeline.analyze_file(video, analysis_params(data["meta"]), d, stage,
                                                          landmarks_cache=d / "cache" / "landmarks.json.gz")
            report = pipeline.build_report(clip_id, data["created_at"], data["original_filename"], info,
                                           analysis_params(data["meta"]), audio, analysed)
            _write_json(d / "analysis.json", report)
        if not (d / "audio.wav").exists():
            from .media import extract_audio, probe_video
            extract_audio(video, d / "audio.wav", probe_video(video))
        set_status(clip_id, state="processing", stage="waveform", progress=0.92)
        write_waveform(d / "audio.wav", d / "waveform.json")
        if needs_preview(video) and not (d / "preview.mp4").exists():
            set_status(clip_id, state="processing", stage="making a browser copy", progress=0.95)
            make_preview(video, d / "preview.mp4")
        data = read_labels(clip_id)                           # re-read: the labeler may have saved meanwhile
        if not data["strokes"] and data["updated_at"] == data["created_at"]:
            data["strokes"] = labels.strokes_from_report(report)
            data["prefill"] = {"engine": report.get("engine", {}).get("engine", pipeline.ENGINE_VERSION),
                               "stroke_count": len(data["strokes"]), "at": now_iso()}
        if data["meta"].get("fps") is None and report.get("source", {}).get("fps"):
            data["meta"]["fps"] = report["source"]["fps"]
        _write_json(d / "labels.json", labels.validate(data))
        set_status(clip_id, state="ready", stage="ready", progress=1.0, error=None)
    except MediaError as exc:
        set_status(clip_id, state="error", stage="error", error=str(exc))
    except (subprocess.SubprocessError, Exception) as exc:  # keep the clip, report the problem
        set_status(clip_id, state="error", stage="error", error=f"Intake failed: {type(exc).__name__}: {exc}")


def summary(clip_id: str) -> dict:
    data = read_labels(clip_id)
    status = read_status(clip_id)
    report = _read_json(clip_dir(clip_id) / "analysis.json", {}) or {}
    m = data["meta"]
    return {"clip_id": clip_id, "original_filename": data.get("original_filename"), "created_at": data.get("created_at"),
            "updated_at": data.get("updated_at"), "status": data["status"], "labeler": data.get("labeler"),
            "intake": status.get("state"), "intake_stage": status.get("stage"), "intake_progress": status.get("progress"),
            "intake_error": status.get("error"), "stroke_count": len(data["strokes"]),
            "edited_count": sum(1 for s in data["strokes"] if s["source"] == "manual" or s["edited"]),
            "player": m.get("player"), "rudiment": m.get("rudiment"), "click_bpm": m.get("click_bpm"),
            "surface": m.get("surface"), "form_grade": m.get("form_grade"),
            "duration_s": report.get("source", {}).get("duration_s"), "fps": report.get("source", {}).get("fps")}


def list_clips() -> list[dict]:
    root = Path(DATASET_DIR)
    if not root.exists():
        return []
    out = []
    for d in sorted(root.iterdir(), reverse=True):
        if d.is_dir() and labels.CLIP_ID_RE.match(d.name) and (d / "labels.json").exists():
            try:
                out.append(summary(d.name))
            except (KeyError, ValueError):
                continue
    return out


def detail(clip_id: str) -> dict:
    d = clip_dir(clip_id)
    data = read_labels(clip_id)
    report = _read_json(d / "analysis.json", {}) or {}
    src = report.get("source", {})
    return {
        "labels": data,
        "status": read_status(clip_id),
        "video": {"url": f"/api/dataset/{clip_id}/video", "fps": src.get("fps") or data["meta"].get("fps"),
                  "duration_s": src.get("duration_s"), "width": src.get("width"), "height": src.get("height"),
                  "preview": (d / "preview.mp4").exists()},
        "detections": labels.strokes_from_report(report) if report else [],
        "onsets": [round(o["t"], 4) for o in report.get("audio", {}).get("onsets", [])],
        "analysis": {"tempo_bpm": report.get("audio", {}).get("tempo_bpm"), "stroke_count": len(report.get("strokes", [])),
                     "form": report.get("scores", {}).get("form"), "overall": report.get("scores", {}).get("overall"),
                     "engine": report.get("engine", {}).get("engine")} if report else None,
    }


def save_labels(clip_id: str, incoming: dict) -> dict:
    """Validate and store a labeler's save. Identity fields always come from the stored file."""
    d = clip_dir(clip_id)
    stored = read_labels(clip_id)
    if not isinstance(incoming, dict):
        raise labels.LabelError("Labels must be a JSON object.")
    merged = {**stored, **{k: incoming[k] for k in ("status", "labeler", "meta", "strokes") if k in incoming}}
    for key in ("clip_id", "video_file", "original_filename", "source", "created_at", "prefill", "schema_version"):
        merged[key] = stored.get(key)
    merged["updated_at"] = now_iso()
    clean = labels.validate(merged)
    shutil.copy2(d / "labels.json", d / "labels.prev.json")
    _write_json(d / "labels.json", clean)
    return clean


def video_file(clip_id: str) -> Path:
    d = clip_dir(clip_id)
    preview = d / "preview.mp4"
    return preview if preview.exists() else d / read_labels(clip_id)["video_file"]


def waveform(clip_id: str) -> dict | None:
    return _read_json(clip_dir(clip_id) / "waveform.json")


SHARE_EXT = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}
SHARE_SETTLE_S = 20


def _share_ledger_path() -> Path:
    return Path(DATASET_DIR) / "_share" / "imported.json"


def _load_share_ledger() -> dict:
    data = _read_json(_share_ledger_path(), {"files": {}})
    if not isinstance(data, dict) or not isinstance(data.get("files"), dict):
        return {"files": {}}
    return data


def _save_share_ledger(data: dict) -> None:
    path = _share_ledger_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    _write_json(path, data)


def import_from_share(share: Path | None = None, settle_s: float = SHARE_SETTLE_S) -> list[dict]:
    """Copy finished videos from a shared drive into the dataset.

    A file is ready when it is non-empty and has not been written for settle_s seconds,
    so a phone that is still copying onto the share is left alone. The share is never
    modified. The same file (path, size, mtime) is imported once.
    """
    root = Path(share) if share is not None else config.CLIP_SHARE
    if root is None or not root.is_dir():
        return []
    dataset_root = Path(DATASET_DIR).resolve()
    ledger = _load_share_ledger()
    known = ledger["files"]
    added = []
    now = time.time()
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in SHARE_EXT:
            continue
        if path.name.startswith((".", "~")):
            continue
        try:
            resolved = path.resolve()
            if dataset_root in resolved.parents or resolved == dataset_root:
                continue
            st = path.stat()
        except OSError:
            continue
        if st.st_size <= 0 or now - st.st_mtime < settle_s:
            continue
        key = f"{resolved}|{st.st_size}|{st.st_mtime_ns}"
        if key in known:
            continue
        clip_id = ""
        try:
            clip_id, dest = create(path.name, path.suffix.lower(), "share")
            shutil.copy2(path, dest)
        except OSError:
            if clip_id:
                delete(clip_id)
            continue
        known[key] = {"clip_id": clip_id, "name": path.name, "at": now_iso()}
        _save_share_ledger(ledger)
        added.append({"clip_id": clip_id, "name": path.name, "source": str(resolved)})
    return added
