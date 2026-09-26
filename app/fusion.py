"""Module 3: audio-video fusion and cross-verification (spec section 6 plus the
verification scope update).

Video timestamps are shifted by av_offset_ms (container sync is assumed). For
each audio onset:
  * hand: the wrist with the greater downward velocity within +/-40 ms of the
    onset; tie-break is the lower wrist.
  * verification: the onset is "verified" when a video strike (a wrist low
    point) lands within +/- verify_window_ms, matched one-to-one, closest pairs
    first. Onsets without a strike are "unverified"; strikes without an onset
    are reported as "video_only".
  * per-stroke form: stroke height and arm vs wrist index over the stroke
    cycle, i.e. from the same hand's previous onset (max 1 s back) to this one.
"""
from __future__ import annotations

import numpy as np

from .audio import fit_grid, timing_stats
from .video import Tracks, detect_strikes

HAND_WINDOW_S = 0.040
CYCLE_MAX_S = 1.0
FIRST_CYCLE_S = 0.3
ELBOW_MATCH_S = 0.05
DEFAULT_VERIFY_WINDOW_MS = 40.0
EPS = 1e-3


class _Motion:
    """Shifted time base plus per-wrist height, downward velocity and elbow angle."""

    def __init__(self, tracks: Tracks, av_offset_ms: float):
        self.t = tracks.t + av_offset_ms / 1000.0
        self.y = {"L": tracks.y("lw"), "R": tracks.y("rw")}
        self.vel = {h: np.gradient(v, self.t) if len(v) > 1 else np.zeros_like(v) for h, v in self.y.items()}
        self.elbow = {"L": tracks.elbow_angle("l"), "R": tracks.elbow_angle("r")}

    def hand_at(self, t: float) -> str | None:
        idx = np.where(np.abs(self.t - t) <= HAND_WINDOW_S)[0]
        if not len(idx):
            return None
        vl, vr = float(self.vel["L"][idx].max()), float(self.vel["R"][idx].max())
        if abs(vl - vr) > 1e-9:
            return "L" if vl > vr else "R"
        i = idx[np.argmin(np.abs(self.t[idx] - t))]
        return "L" if self.y["L"][i] >= self.y["R"][i] else "R"

    def cycle_metrics(self, hand: str, start: float, end: float) -> tuple[float | None, float | None]:
        m = (self.t >= start) & (self.t <= end)
        if m.sum() < 2:
            return None, None
        height = float(np.ptp(self.y[hand][m]))
        elbow_range = float(np.radians(np.ptp(self.elbow[hand][m])))
        return height, elbow_range / (height + EPS)

    def elbow_at(self, hand: str, t: float) -> float | None:
        if not len(self.t):
            return None
        i = int(np.argmin(np.abs(self.t - t)))
        return float(self.elbow[hand][i]) if abs(self.t[i] - t) <= ELBOW_MATCH_S else None


def match_strikes(onset_times: list[float], strikes: list[dict], window_ms: float) -> tuple[dict, set]:
    """One-to-one matching, closest pairs first. Returns ({onset_i: (strike_j, delta_ms)}, unmatched strike ids)."""
    w = window_ms / 1000.0
    pairs = sorted(
        (abs(s["t"] - t), i, j) for i, t in enumerate(onset_times) for j, s in enumerate(strikes) if abs(s["t"] - t) <= w
    )
    used_o, used_s, matches = set(), set(), {}
    for _, i, j in pairs:
        if i not in used_o and j not in used_s:
            used_o.add(i)
            used_s.add(j)
            matches[i] = (j, round((strikes[j]["t"] - onset_times[i]) * 1000.0, 2))
    return matches, set(range(len(strikes))) - used_s


def fuse(audio: dict, tracks: Tracks | None, degraded: bool, av_offset_ms: float = 0.0,
         verify_window_ms: float = DEFAULT_VERIFY_WINDOW_MS) -> tuple[list[dict], dict, dict]:
    """Returns (strokes, verification, per-hand form aggregates)."""
    onsets = audio["onsets"]
    times = [o["t"] for o in onsets]
    use_video = tracks is not None and not degraded and len(tracks.t) > 1
    motion = _Motion(tracks, av_offset_ms) if use_video else None
    strikes = []
    if use_video:
        strikes = [{"t": s["t"] + av_offset_ms / 1000.0, "hand": s["hand"]} for s in detect_strikes(tracks)]
    matches, unmatched = match_strikes(times, strikes, verify_window_ms)

    strokes, last_by_hand = [], {}
    for i, o in enumerate(onsets):
        hand = motion.hand_at(o["t"]) if motion else None
        height = awi = elbow = None
        if hand:
            prev = last_by_hand.get(hand)
            start = prev if prev is not None and o["t"] - prev <= CYCLE_MAX_S else o["t"] - FIRST_CYCLE_S
            height, awi = motion.cycle_metrics(hand, start, o["t"])
            elbow = motion.elbow_at(hand, o["t"])
            last_by_hand[hand] = o["t"]
        match = matches.get(i)
        strokes.append({
            "t": o["t"], "hand": hand, "timing_error_ms": o["timing_error_ms"], "velocity": o["velocity"],
            "stroke_height": _r(height), "arm_vs_wrist_index": _r(awi), "elbow_angle_deg": _r(elbow, 2),
            "verification": "verified" if match else "unverified",
            "av_delta_ms": match[1] if match else None,
            "strike_hand": strikes[match[0]]["hand"] if match else None,
        })

    video_only = [{"t": round(strikes[j]["t"], 4), "hand": strikes[j]["hand"]} for j in sorted(unmatched)]
    verification = summarize_verification(audio, strokes, video_only, verify_window_ms, use_video, len(strikes))
    return strokes, verification, per_hand_form(strokes)


def summarize_verification(audio: dict, strokes: list[dict], video_only: list[dict], window_ms: float,
                           used_video: bool, strike_count: int) -> dict:
    verified = [(s, o) for s, o in zip(strokes, audio["onsets"]) if s["verification"] == "verified"]
    n_v, n_vo = len(verified), len(video_only)
    n_u = len(strokes) - n_v
    total = n_v + n_u + n_vo
    bpm = None
    grid = audio.get("grid")
    if grid and n_v >= 4:
        t = np.array([o["t"] for _, o in verified])
        k = np.array([o["grid_index"] for _, o in verified])
        if len(set(k)) >= 3:
            _, step = fit_grid(t, k)
            bpm = round(60.0 / (step * grid["subdivision"]), 2) if step > 0 else None
    errors = np.array([s["timing_error_ms"] for s, _ in verified if s["timing_error_ms"] is not None])
    deltas = [s["av_delta_ms"] for s, _ in verified]
    return {
        "window_ms": window_ms,
        "video_used": used_video,
        "video_strikes_detected": strike_count,
        "verified_stroke_count": n_v,
        "unverified_onsets": n_u,
        "video_only_strikes": n_vo,
        "agreement_pct": round(100.0 * n_v / total, 2) if total else 0.0,
        "verified_tempo_bpm": bpm,
        "verified_timing": timing_stats(errors),
        "median_av_delta_ms": round(float(np.median(deltas)), 2) if deltas else None,
        "video_only": video_only,
        "note": None if used_video else "Video was degraded or unavailable, so no onset could be verified.",
    }


def per_hand_form(strokes: list[dict]) -> dict:
    out = {}
    for hand in ("L", "R"):
        h = np.array([s["stroke_height"] for s in strokes if s["hand"] == hand and s["stroke_height"] is not None])
        a = np.array([s["arm_vs_wrist_index"] for s in strokes if s["hand"] == hand and s["arm_vs_wrist_index"] is not None])
        out[hand] = {
            "strokes": sum(1 for s in strokes if s["hand"] == hand),
            "stroke_height_mean": _r(float(h.mean())) if h.size else None,
            "stroke_height_std": _r(float(h.std())) if h.size else None,
            "arm_vs_wrist_index": _r(float(a.mean())) if a.size else None,
        }
    return out


def _r(v: float | None, n: int = 4) -> float | None:
    return round(v, n) if v is not None else None
