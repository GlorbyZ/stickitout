"""Module 2: video landmarks and form detection (spec section 5).

Runs MediaPipe Tasks PoseLandmarker and HandLandmarker in VIDEO mode on every
frame, keeps frames where both wrists are visible (visibility >= 0.5), and
turns the kept frames into shoulder-width-normalised tracks. Session metrics
(symmetry, posture drift, shoulder angle, experimental grip proxy) live here;
per-stroke metrics (stroke height, arm vs wrist index) need the audio onsets
and are computed in fusion.py from the tracks built here.

MediaPipe 1.x ships only the Tasks API (the legacy mp.solutions Pose/Hands API
was removed), so the .task model files are downloaded once into ./models.
"""
from __future__ import annotations

import math
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import cv2
import numpy as np
from scipy.signal import find_peaks

MODEL_DIR = Path(__file__).resolve().parent.parent / "models"
MODELS = {
    "pose": ("pose_landmarker_full.task",
             "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task"),
    "hand": ("hand_landmarker.task",
             "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"),
}
POSE_IDS = {"ls": 11, "rs": 12, "le": 13, "re": 14, "lw": 15, "rw": 16}
MIN_WRIST_VISIBILITY = 0.5
DEGRADED_BELOW = 0.5
MAX_PROCESS_WIDTH = 960           # frames are downscaled before inference to save time
SIDE_VIEW_RATIO = 0.5             # shoulder width < 0.5 x upper arm length means a side-on camera
STRIKE_MIN_PROMINENCE = 0.02      # wrist low point must drop this many shoulder widths
STRIKE_MIN_GAP_S = 0.05
TRAJECTORY_POINTS = 1500
FINGERTIPS = (4, 8, 12, 16, 20)
PALM = (0, 5, 9, 13, 17)


def ensure_models() -> dict[str, Path]:
    """Download the MediaPipe task models on first use."""
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    paths = {}
    for key, (name, url) in MODELS.items():
        path = MODEL_DIR / name
        if not path.exists() or path.stat().st_size < 1_000_000:
            tmp = path.with_suffix(".part")
            urllib.request.urlretrieve(url, tmp)
            tmp.replace(path)
        paths[key] = path
    return paths


def extract_landmarks(video_path: Path, progress: Callable[[float], None] | None = None) -> dict:
    """Per-frame pose (landmarks 11-16) and both hands (21 landmarks), in pixel coordinates."""
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    paths = ensure_models()
    pose = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(paths["pose"])),
        running_mode=vision.RunningMode.VIDEO, num_poses=1))
    hands = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(paths["hand"])),
        running_mode=vision.RunningMode.VIDEO, num_hands=2))
    cap = cv2.VideoCapture(str(video_path))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    nominal_fps = cap.get(cv2.CAP_PROP_FPS) or 60.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    scale = min(1.0, MAX_PROCESS_WIDTH / max(width, 1))
    frames, last_ms, index = [], -1, 0
    try:
        while True:
            ok, bgr = cap.read()
            if not ok:
                break
            pos = cap.get(cv2.CAP_PROP_POS_MSEC)
            t_ms = int(round(pos)) if pos > 0 else int(round(index * 1000.0 / nominal_fps))
            t_ms = max(t_ms, last_ms + 1)            # Tasks VIDEO mode needs strictly increasing timestamps
            last_ms = t_ms
            if scale < 1.0:
                bgr = cv2.resize(bgr, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
            frame = {"t": t_ms / 1000.0, "pose": None, "hands": []}
            res = pose.detect_for_video(image, t_ms)
            if res.pose_landmarks:
                lm = res.pose_landmarks[0]
                frame["pose"] = {k: (lm[i].x * width, lm[i].y * height, float(lm[i].visibility or 0.0))
                                 for k, i in POSE_IDS.items()}
            hres = hands.detect_for_video(image, t_ms)
            for hand in hres.hand_landmarks:
                frame["hands"].append([(p.x * width, p.y * height) for p in hand])
            frames.append(frame)
            index += 1
            if progress and index % 30 == 0:
                progress(min(1.0, index / total))
    finally:
        cap.release()
        pose.close()
        hands.close()
    return {"frames": frames, "width": width, "height": height}


@dataclass
class Tracks:
    """Kept frames as arrays. y grows downward; coordinates are in pixels until divided by scale."""
    t: np.ndarray
    pts: dict[str, np.ndarray]                      # key -> (n, 2) pixel coords for ls, rs, le, re, lw, rw
    hands: dict[str, list] = field(default_factory=dict)   # "L"/"R" -> list of (21, 2) arrays
    scale: float = 1.0
    normalization: str = "shoulder_width"
    total_frames: int = 0

    @property
    def coverage(self) -> float:
        return len(self.t) / self.total_frames if self.total_frames else 0.0

    def y(self, key: str) -> np.ndarray:
        """Normalised vertical position (shoulder widths, downward positive)."""
        return self.pts[key][:, 1] / self.scale

    def elbow_angle(self, side: str) -> np.ndarray:
        """Shoulder-elbow-wrist angle in degrees for side 'l' or 'r'."""
        a, b, c = self.pts[f"{side}s"], self.pts[f"{side}e"], self.pts[f"{side}w"]
        v1, v2 = a - b, c - b
        cos = np.sum(v1 * v2, axis=1) / (np.linalg.norm(v1, axis=1) * np.linalg.norm(v2, axis=1) + 1e-9)
        return np.degrees(np.arccos(np.clip(cos, -1.0, 1.0)))


def build_tracks(raw: dict) -> Tracks:
    """Drop frames without both wrists visible, attach hands to wrists, pick the normalisation scale."""
    kept = [f for f in raw["frames"] if f["pose"]
            and f["pose"]["lw"][2] >= MIN_WRIST_VISIBILITY and f["pose"]["rw"][2] >= MIN_WRIST_VISIBILITY]
    t = np.array([f["t"] for f in kept])
    pts = {k: np.array([f["pose"][k][:2] for f in kept]).reshape(-1, 2) for k in POSE_IDS}
    hands: dict[str, list] = {"L": [], "R": []}
    for f in kept:
        for hand in f["hands"]:
            arr = np.asarray(hand)
            # Hand labels from MediaPipe assume a mirrored selfie image, so match hands to pose wrists instead.
            dl = np.linalg.norm(arr[0] - np.asarray(f["pose"]["lw"][:2]))
            dr = np.linalg.norm(arr[0] - np.asarray(f["pose"]["rw"][:2]))
            hands["L" if dl <= dr else "R"].append(arr)
    tracks = Tracks(t=t, pts=pts, hands=hands, total_frames=len(raw["frames"]))
    if len(t):
        shoulder = float(np.median(np.linalg.norm(pts["ls"] - pts["rs"], axis=1)))
        upper_arm = float(np.median(np.concatenate([np.linalg.norm(pts["ls"] - pts["le"], axis=1),
                                                    np.linalg.norm(pts["rs"] - pts["re"], axis=1)])))
        if shoulder < SIDE_VIEW_RATIO * upper_arm:
            tracks.scale, tracks.normalization = max(upper_arm, 1e-6), "upper_arm_length (side view)"
        else:
            tracks.scale = max(shoulder, 1e-6)
    return tracks


def detect_strikes(tracks: Tracks) -> list[dict]:
    """Video strikes: low points of each wrist (local maxima of downward position)."""
    strikes = []
    if len(tracks.t) < 5:
        return strikes
    dt = float(np.median(np.diff(tracks.t)))
    for hand, key in (("L", "lw"), ("R", "rw")):
        y = np.convolve(tracks.y(key), np.ones(3) / 3, mode="same")
        peaks, _ = find_peaks(y, prominence=STRIKE_MIN_PROMINENCE, distance=max(1, int(STRIKE_MIN_GAP_S / dt)))
        strikes += [{"t": float(tracks.t[p]), "hand": hand} for p in peaks]
    return sorted(strikes, key=lambda s: s["t"])


def symmetry(tracks: Tracks) -> float | None:
    """Peak normalised cross-correlation (0-1) of left vs right wrist height, resampled to a common 60 Hz base."""
    if len(tracks.t) < 30:
        return None
    base = np.arange(tracks.t[0], tracks.t[-1], 1 / 60.0)
    left = np.interp(base, tracks.t, tracks.y("lw"))
    right = np.interp(base, tracks.t, tracks.y("rw"))
    left, right = left - left.mean(), right - right.mean()
    denom = np.sqrt(np.sum(left ** 2) * np.sum(right ** 2))
    if denom <= 0:
        return None
    corr = np.correlate(left, right, mode="full") / denom
    lag = min(60, len(base) - 1)                    # search +/- 1 s
    mid = len(base) - 1
    return float(np.clip(corr[mid - lag: mid + lag + 1].max(), 0.0, 1.0))


def posture(tracks: Tracks) -> dict:
    """Shoulder-midpoint drift (normalised units per minute) and mean shoulder-line angle."""
    if len(tracks.t) < 10:
        return {"posture_drift_per_min": None, "shoulder_line_angle_deg": None}
    mid_y = (tracks.y("ls") + tracks.y("rs")) / 2.0
    slope, _ = np.polyfit(tracks.t / 60.0, mid_y, 1)
    d = tracks.pts["ls"] - tracks.pts["rs"]
    angles = np.degrees(np.arctan2(-d[:, 1], d[:, 0]))
    angles = (angles + 90.0) % 180.0 - 90.0          # fold into -90..90 so left/right order does not matter
    return {"posture_drift_per_min": round(float(slope), 5), "shoulder_line_angle_deg": round(float(angles.mean()), 2)}


def grip_proxy(tracks: Tracks) -> dict:
    """EXPERIMENTAL, never scored: mean fingertip-to-palm-centre distance per hand (normalised units)."""
    out = {"experimental": True}
    for hand in ("L", "R"):
        vals = [float(np.mean(np.linalg.norm(h[list(FINGERTIPS)] - h[list(PALM)].mean(axis=0), axis=1)))
                for h in tracks.hands.get(hand, [])]
        out[hand] = round(float(np.mean(vals)) / tracks.scale, 4) if vals else None
    return out


def trajectories(tracks: Tracks) -> dict:
    """Downsampled wrist heights for the dashboard chart (height = upward positive)."""
    if not len(tracks.t):
        return {"t": [], "left_wrist_height": [], "right_wrist_height": []}
    step = max(1, int(math.ceil(len(tracks.t) / TRAJECTORY_POINTS)))
    sl = slice(None, None, step)
    return {"t": [round(float(v), 4) for v in tracks.t[sl]],
            "left_wrist_height": [round(float(-v), 4) for v in tracks.y("lw")[sl]],
            "right_wrist_height": [round(float(-v), 4) for v in tracks.y("rw")[sl]]}


def session_metrics(tracks: Tracks) -> dict:
    """Session-level part of the report's video section."""
    coverage = tracks.coverage
    degraded = coverage < DEGRADED_BELOW
    return {
        "frames_total": tracks.total_frames,
        "frames_kept": int(len(tracks.t)),
        "landmark_coverage": round(coverage, 4),
        "degraded": degraded,
        "degraded_reason": (f"Both wrists were visible in only {coverage:.0%} of frames (need 50%). "
                            "Check the camera guide: full torso, both arms and the pad in frame, good light.")
                           if degraded else None,
        "normalization": tracks.normalization,
        "form": {
            "symmetry": None if degraded else _round(symmetry(tracks)),
            **({"posture_drift_per_min": None, "shoulder_line_angle_deg": None} if degraded else posture(tracks)),
            "grip_proxy": {"experimental": True, "L": None, "R": None} if degraded else grip_proxy(tracks),
        },
        "trajectories": trajectories(tracks),
    }


def _round(v: float | None, n: int = 4) -> float | None:
    return round(v, n) if v is not None else None
