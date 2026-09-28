"""Label files for the accuracy-training dataset: DATASET_DIR/<clip_id>/labels.json.

The shape is documented as JSON Schema in schema/labels.schema.json; validate()
below enforces the same rules without needing the jsonschema package at runtime,
and returns a normalised copy (defaults filled in, strokes sorted by time).

  {
    "schema_version": 1,
    "clip_id": "20260926-150400-paradiddles-100-a1b2",
    "video_file": "video.mp4",              original upload, byte for byte
    "original_filename": "IMG_0421.MOV",
    "source": "upload" | "job",
    "created_at": "...", "updated_at": "...",
    "status": "draft" | "done",             only "done" clips are evaluated by default
    "labeler": "Mike Staus",
    "meta": {
      "player", "rudiment", "click_bpm", "notes_per_beat", "surface" (pad, snare, kit),
      "camera_angle" (side, front, 45, overhead, other), "fps", "lighting" (bright, ok, dim),
      "take_type" (clean, sloppy), "known_mistakes", "form_grade" (1 to 10), "form_comment",
      "clap_t", "eval_start_s", "eval_end_s", "sticking_errors_marked"
    },
    "strokes": [{"t": 1.2345, "hand": "L" | "R" | null, "type": "normal" | "accent" | "ghost",
                 "sticking_error": false, "source": "analyzer" | "manual", "edited": false}],
    "prefill": {"engine": "0.1.0", "stroke_count": 212, "at": "..."} | null
  }

Stroke times are seconds from the start of the video (the same clock as the
analyzer's report). A stroke with "sticking_error": true is one the player hit
with the wrong hand for the rudiment. Set meta.sticking_errors_marked when every
such stroke has been flagged; otherwise evaluation derives the expected errors
from the labeled hands and the rudiment pattern.
"""
from __future__ import annotations

import math
import re

SCHEMA_VERSION = 1
CLIP_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{5,79}$")
MAX_STROKES = 20000
STATUSES = ("draft", "done")
SOURCES = ("upload", "job")
HANDS = ("L", "R", None)
STROKE_TYPES = ("normal", "accent", "ghost")
STROKE_SOURCES = ("analyzer", "manual")
SURFACES = ("pad", "snare", "kit")
ANGLES = ("side", "front", "45", "overhead", "other")
LIGHTING = ("bright", "ok", "dim")
TAKE_TYPES = ("clean", "sloppy")

META_TEXT = {"player": 80, "rudiment": 80, "known_mistakes": 4000, "form_comment": 2000}
META_ENUM = {"surface": SURFACES, "camera_angle": ANGLES, "lighting": LIGHTING, "take_type": TAKE_TYPES}
META_NUMBER = {"click_bpm": (20, 400), "fps": (1, 480), "clap_t": (0, 86400), "eval_start_s": (0, 86400),
               "eval_end_s": (0, 86400)}
META_INT = {"notes_per_beat": (1, 12), "form_grade": (1, 10)}
META_BOOL = ("sticking_errors_marked",)
META_KEYS = set(META_TEXT) | set(META_ENUM) | set(META_NUMBER) | set(META_INT) | set(META_BOOL)
TOP_KEYS = {"schema_version", "clip_id", "video_file", "original_filename", "source", "created_at", "updated_at",
            "status", "labeler", "meta", "strokes", "prefill"}
STROKE_KEYS = {"t", "hand", "type", "sticking_error", "source", "edited"}


class LabelError(ValueError):
    """Raised for an invalid label file. The message is shown to the labeler."""


def empty_meta() -> dict:
    return {**{k: "" for k in META_TEXT}, **{k: None for k in META_ENUM}, **{k: None for k in META_NUMBER},
            **{k: None for k in META_INT}, "sticking_errors_marked": False}


def new_labels(clip_id: str, video_file: str, original_filename: str, source: str, created_at: str,
               meta: dict | None = None) -> dict:
    data = {"schema_version": SCHEMA_VERSION, "clip_id": clip_id, "video_file": video_file,
            "original_filename": original_filename, "source": source, "created_at": created_at,
            "updated_at": created_at, "status": "draft", "labeler": "", "meta": {**empty_meta(), **(meta or {})},
            "strokes": [], "prefill": None}
    return validate(data)


def _num(v, where: str, lo: float, hi: float, integer: bool = False):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise LabelError(f"{where} must be a number.")
    if integer and float(v) != int(v):
        raise LabelError(f"{where} must be a whole number.")
    if not lo <= v <= hi:
        raise LabelError(f"{where} must be between {lo:g} and {hi:g}.")
    return int(v) if integer else float(v)


def _text(v, where: str, limit: int) -> str:
    if v is None:
        return ""
    if not isinstance(v, str):
        raise LabelError(f"{where} must be text.")
    if len(v) > limit:
        raise LabelError(f"{where} is too long (limit {limit} characters).")
    return v


def validate_meta(meta) -> dict:
    if not isinstance(meta, dict):
        raise LabelError("meta must be an object.")
    unknown = set(meta) - META_KEYS
    if unknown:
        raise LabelError(f"Unknown meta field(s): {', '.join(sorted(unknown))}.")
    out = empty_meta()
    for k, v in meta.items():
        where = f"meta.{k}"
        if k in META_TEXT:
            out[k] = _text(v, where, META_TEXT[k])
        elif v is None or v == "":
            out[k] = False if k in META_BOOL else None
        elif k in META_ENUM:
            if v not in META_ENUM[k]:
                raise LabelError(f"{where} must be one of {', '.join(META_ENUM[k])}.")
            out[k] = v
        elif k in META_NUMBER:
            out[k] = round(_num(v, where, *META_NUMBER[k]), 4)
        elif k in META_INT:
            out[k] = _num(v, where, *META_INT[k], integer=True)
        elif k in META_BOOL:
            if not isinstance(v, bool):
                raise LabelError(f"{where} must be true or false.")
            out[k] = v
    if out["eval_start_s"] is not None and out["eval_end_s"] is not None and out["eval_end_s"] <= out["eval_start_s"]:
        raise LabelError("meta.eval_end_s must be after meta.eval_start_s.")
    return out


def validate_stroke(s, i: int) -> dict:
    where = f"strokes[{i}]"
    if not isinstance(s, dict):
        raise LabelError(f"{where} must be an object.")
    unknown = set(s) - STROKE_KEYS
    if unknown:
        raise LabelError(f"Unknown field(s) in {where}: {', '.join(sorted(unknown))}.")
    if "t" not in s:
        raise LabelError(f"{where}.t is required.")
    hand = s.get("hand")
    if hand not in HANDS:
        raise LabelError(f"{where}.hand must be L, R or null.")
    kind = s.get("type", "normal")
    if kind not in STROKE_TYPES:
        raise LabelError(f"{where}.type must be one of {', '.join(STROKE_TYPES)}.")
    source = s.get("source", "manual")
    if source not in STROKE_SOURCES:
        raise LabelError(f"{where}.source must be analyzer or manual.")
    for flag in ("sticking_error", "edited"):
        if not isinstance(s.get(flag, False), bool):
            raise LabelError(f"{where}.{flag} must be true or false.")
    return {"t": round(_num(s["t"], f"{where}.t", 0, 86400), 4), "hand": hand, "type": kind,
            "sticking_error": bool(s.get("sticking_error", False)), "source": source,
            "edited": bool(s.get("edited", False))}


def validate(data) -> dict:
    """Check a labels document and return a normalised copy. Raises LabelError."""
    if not isinstance(data, dict):
        raise LabelError("Labels must be a JSON object.")
    unknown = set(data) - TOP_KEYS
    if unknown:
        raise LabelError(f"Unknown field(s): {', '.join(sorted(unknown))}.")
    if data.get("schema_version", SCHEMA_VERSION) != SCHEMA_VERSION:
        raise LabelError(f"schema_version must be {SCHEMA_VERSION}.")
    for key in ("clip_id", "video_file"):
        if not isinstance(data.get(key), str) or not data[key]:
            raise LabelError(f"{key} is required.")
    if not CLIP_ID_RE.match(data["clip_id"]):
        raise LabelError("clip_id may only use lowercase letters, digits and dashes (6 to 80 characters).")
    if "/" in data["video_file"] or "\\" in data["video_file"] or data["video_file"].startswith("."):
        raise LabelError("video_file must be a plain file name.")
    status = data.get("status", "draft")
    if status not in STATUSES:
        raise LabelError("status must be draft or done.")
    source = data.get("source", "upload")
    if source not in SOURCES:
        raise LabelError("source must be upload or job.")
    strokes = data.get("strokes", [])
    if not isinstance(strokes, list):
        raise LabelError("strokes must be a list.")
    if len(strokes) > MAX_STROKES:
        raise LabelError(f"Too many strokes (limit {MAX_STROKES}).")
    clean = sorted((validate_stroke(s, i) for i, s in enumerate(strokes)), key=lambda s: s["t"])
    prefill = data.get("prefill")
    if prefill is not None and not isinstance(prefill, dict):
        raise LabelError("prefill must be an object or null.")
    return {
        "schema_version": SCHEMA_VERSION,
        "clip_id": data["clip_id"],
        "video_file": data["video_file"],
        "original_filename": _text(data.get("original_filename"), "original_filename", 255),
        "source": source,
        "created_at": _text(data.get("created_at"), "created_at", 40),
        "updated_at": _text(data.get("updated_at"), "updated_at", 40),
        "status": status,
        "labeler": _text(data.get("labeler"), "labeler", 80),
        "meta": validate_meta(data.get("meta", {})),
        "strokes": clean,
        "prefill": prefill,
    }


def strokes_from_report(report: dict) -> list[dict]:
    """Pre-fill: the analyzer's detected strokes as label strokes (source "analyzer")."""
    return [{"t": round(float(s["t"]), 4), "hand": s.get("hand") if s.get("hand") in ("L", "R") else None,
             "type": "normal", "sticking_error": False, "source": "analyzer", "edited": False}
            for s in report.get("strokes", [])]
