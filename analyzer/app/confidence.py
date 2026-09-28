"""Decide whether the results page may show video-derived verdicts.

Audio scores are never gated here. A missing verdict is allowed. A confident
number the video does not support is not.
"""
from __future__ import annotations

from app import tuning

WEAK_COPY = (
    "We could not see your hands clearly enough to check sticking on this take. "
    "Your timing results below are from the audio and are unaffected."
)
NONE_COPY = "Video analysis did not run on this take, so only the audio results are shown."
HINT = "How to get the video check: side view on a tripod, 60 fps, and brighter light."


def _count(report: dict) -> int:
    verification = report.get("verification") or {}
    if verification.get("verified_stroke_count") is not None:
        return int(verification["verified_stroke_count"])
    return sum(1 for s in report.get("strokes") or [] if s.get("verification") == "verified")


def assess(report: dict) -> dict:
    """Build report['confidence'] from coverage, agreement, and how many hits were seen."""
    tune = tuning.current()
    video = report.get("video") or {}
    verification = report.get("verification") or {}
    quality = report.get("quality") or {}
    sticking = report.get("sticking") or {}
    coverage = float(video.get("landmark_coverage") or 0.0)
    agreement = float(verification.get("agreement_pct") or 0.0)
    seen = _count(report)
    low_fps = bool(quality.get("low_fps"))
    reasons: list[str] = []

    if video.get("degraded", True):
        level = "none"
        reasons.append(video.get("degraded_reason") or "Video analysis did not run.")
    else:
        weak = False
        if coverage < tune.conf_min_coverage:
            weak = True
            reasons.append(f"Hands were only tracked on {round(100 * coverage)}% of frames.")
        if agreement < tune.conf_min_agreement:
            weak = True
            reasons.append(f"The video matched {agreement:.1f}% of the hits.")
        if seen < tune.conf_min_verified_strokes:
            weak = True
            reasons.append(f"Only {seen} hits were seen in the video.")
        near = (
            coverage < tune.conf_near_coverage
            or agreement < tune.conf_near_agreement
            or seen < tune.conf_near_strokes
        )
        if low_fps and near:
            weak = True
            fps = (report.get("source") or {}).get("fps")
            reasons.append(
                f"Recorded at {round(fps) if fps else 'under 50'} fps, and the video match is not strong enough to call."
            )
        level = "weak" if weak else "good"

    show_verified = level == "good"
    show_hand = level == "good"
    show_sticking = (
        show_verified
        and bool(sticking.get("checked"))
        and seen >= tune.conf_min_sticking_strokes
    )
    return {
        "version": 1,
        "video": level,
        "reasons": reasons,
        "show_verified": show_verified,
        "show_sticking": show_sticking,
        "show_hand_metrics": show_hand,
        "landmark_coverage": round(coverage, 4),
        "agreement_pct": round(agreement, 1),
        "message": NONE_COPY if level == "none" else WEAK_COPY if level == "weak" else "",
        "hint": "" if level == "good" else HINT,
    }
