"""Scoring (spec section 7). Every score is 0-100 and the formulas are shown in the UI.

  timing      = max(0, 100 - mean_abs_error_ms * 2)
  consistency = max(0, 100 - (std(ioi) / mean(ioi)) * 100)
  dynamics    = max(0, dynamics_evenness * 100)
  form        = mean of stroke-height consistency, symmetry * 100 and posture
                (null with a reason when the video is degraded)
  overall     = mean of the non-null scores above
  verified    = agreement_pct from cross-verification (shown on its own, not part of overall)
"""
from __future__ import annotations

import numpy as np


def _clip(v: float) -> float:
    return round(float(min(100.0, max(0.0, v))), 1)


def timing_score(mean_abs_error_ms: float | None) -> float | None:
    return None if mean_abs_error_ms is None else _clip(100 - mean_abs_error_ms * 2)


def score_report(audio: dict, video: dict, strokes: list[dict], verification: dict) -> dict:
    timing = timing_score(audio["timing"]["mean_abs_error_ms"])
    cv = audio["ioi"]["cv"]
    consistency = None if cv is None else _clip(100 - cv * 100)
    evenness = audio["dynamics"]["dynamics_evenness"]
    dynamics = None if evenness is None else _clip(evenness * 100)

    components, form, form_reason = {}, None, None
    if video.get("degraded", True):
        form_reason = video.get("degraded_reason") or "Video analysis unavailable."
    else:
        heights = np.array([s["stroke_height"] for s in strokes if s["stroke_height"] is not None])
        if heights.size >= 2 and heights.mean() > 0:
            components["stroke_height_consistency"] = _clip(100 - heights.std() / heights.mean() * 100)
        form_data = video.get("form", {})
        if form_data.get("symmetry") is not None:
            components["symmetry"] = _clip(form_data["symmetry"] * 100)
        if form_data.get("posture_drift_per_min") is not None:
            components["posture"] = _clip(100 - abs(form_data["posture_drift_per_min"]) * 500)
        if components:
            form = round(float(np.mean(list(components.values()))), 1)
        else:
            form_reason = "Not enough tracked strokes to score form."

    present = [s for s in (timing, consistency, dynamics, form) if s is not None]
    per_hand = {}
    for hand in ("L", "R"):
        errs = np.array([abs(s["timing_error_ms"]) for s in strokes if s["hand"] == hand and s["timing_error_ms"] is not None])
        heights = np.array([s["stroke_height"] for s in strokes if s["hand"] == hand and s["stroke_height"] is not None])
        per_hand[hand] = {
            "strokes": int(sum(1 for s in strokes if s["hand"] == hand)),
            "mean_abs_error_ms": round(float(errs.mean()), 3) if errs.size else None,
            "timing": timing_score(float(errs.mean())) if errs.size else None,
            "stroke_height_mean": round(float(heights.mean()), 4) if heights.size else None,
            "stroke_height_std": round(float(heights.std()), 4) if heights.size else None,
            "stroke_height_consistency": _clip(100 - heights.std() / heights.mean() * 100)
            if heights.size >= 2 and heights.mean() > 0 else None,
        }
    return {
        "timing": timing, "consistency": consistency, "dynamics": dynamics,
        "form": form, "form_null_reason": form_reason, "form_components": components,
        "overall": round(float(np.mean(present)), 1) if present else None,
        "verified": _clip(verification["agreement_pct"]),
        "verified_reason": None,
        "per_hand": per_hand,
    }


def gate_verified(scores: dict, confidence: dict) -> dict:
    """Drop the Verified number when the video is not good enough to show it."""
    if confidence.get("show_verified"):
        return scores
    reason = confidence.get("message") or "The video is not clear enough to show a Verified score."
    return {**scores, "verified": None, "verified_reason": reason}
