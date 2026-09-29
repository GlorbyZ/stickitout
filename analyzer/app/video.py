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
import os
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import cv2
import numpy as np
from scipy.signal import find_peaks

from . import tuning

MODEL_DIR = Path(__file__).resolve().parent.parent / "models"
# Pose model: "full" by default. POSE_MODEL=heavy is more robust on fast, blurred strokes but
# about 3x slower per frame; "lite" is the fastest.
POSE_MODEL = os.environ.get("POSE_MODEL", "full").strip().lower()
if POSE_MODEL not in ("lite", "full", "heavy"):
    POSE_MODEL = "full"
MODELS = {
    "pose": (f"pose_landmarker_{POSE_MODEL}.task",
             f"https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_{POSE_MODEL}/float16/latest/pose_landmarker_{POSE_MODEL}.task"),
    "hand": ("hand_landmarker.task",
             "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"),
}
# Detection and tracking confidences, below the MediaPipe default of 0.5 so fast strokes with
# motion blur keep a pose (tracking re-detects on its own when confidence falls under these).
# Frames still need wrist visibility >= min_wrist_visibility (tuning) to count for scoring.
MIN_DETECTION_CONFIDENCE = 0.3
MIN_PRESENCE_CONFIDENCE = 0.3
MIN_TRACKING_CONFIDENCE = 0.3
# Slow motion: pose and hands run on at most this many frames per second (a 240 fps clip uses
# every other frame, 120 fps and below use every frame). Audio is never downsampled.
MAX_POSE_FPS = float(os.environ.get("MAX_POSE_FPS", "120") or 0)
POSE_IDS = {"ls": 11, "rs": 12, "le": 13, "re": 14, "lw": 15, "rw": 16}
# Extra points kept only for drawing the playback skeleton (nose and hips).
BODY_IDS = {"nose": 0, "lh": 23, "rh": 24}
# Wrist visibility cutoff and the strike detector (prominence, minimum gap, smoothing) are
# tuning settings: see app/tuning.py (defaults 0.5, 0.02 body units, 50 ms, 3 frames).
DEGRADED_BELOW = 0.5
MAX_PROCESS_WIDTH = 960           # frames are downscaled before inference to save time
SIDE_VIEW_RATIO = 0.5             # shoulder width < 0.5 x upper arm length means a side-on camera
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


def extract_landmarks(video_path: Path, progress: Callable[[float], None] | None = None,
                      pts: list[float] | None = None) -> dict:
    """Per-frame pose (landmarks 11-16, plus nose and hips for drawing) and both hands (21
    landmarks), in pixel coordinates, for every decoded frame.

    `pts` is the presentation time of every frame from media.frame_times(). Each frame gets
    "pts" on the file's own timeline (what a browser reports as mediaTime) so playback can draw
    the landmarks of exactly the frame on screen. When the decoded frame count does not match,
    the decoder's timestamps are used, shifted onto the same timeline.
    """
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    paths = ensure_models()
    pose = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(paths["pose"])),
        running_mode=vision.RunningMode.VIDEO, num_poses=1,
        min_pose_detection_confidence=MIN_DETECTION_CONFIDENCE,
        min_pose_presence_confidence=MIN_PRESENCE_CONFIDENCE,
        min_tracking_confidence=MIN_TRACKING_CONFIDENCE))
    hands = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(paths["hand"])),
        running_mode=vision.RunningMode.VIDEO, num_hands=2,
        min_hand_detection_confidence=MIN_DETECTION_CONFIDENCE,
        min_hand_presence_confidence=MIN_PRESENCE_CONFIDENCE,
        min_tracking_confidence=MIN_TRACKING_CONFIDENCE))
    cap = cv2.VideoCapture(str(video_path))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    nominal_fps = cap.get(cv2.CAP_PROP_FPS) or 60.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    scale = min(1.0, MAX_PROCESS_WIDTH / max(width, 1))
    frames, last_ms, index = [], -1, 0
    decoded_index = []                           # source frame number of every processed frame
    next_due = -1.0e9
    min_gap_ms = (1000.0 / MAX_POSE_FPS - 1.0) if MAX_POSE_FPS > 0 else 0.0
    
    image_quality = None
    drum_pad = None
    
    # Import the ray-cast stick tracker
    from .stick_tracker import StickTracker
    tracker = StickTracker()
    
    try:
        while True:
            if not cap.grab():
                break
            pos = cap.get(cv2.CAP_PROP_POS_MSEC)
            t_raw = pos if pos > 0 else index * 1000.0 / nominal_fps
            if t_raw < next_due:                 # above MAX_POSE_FPS: skip this frame for pose
                index += 1
                continue
            ok, bgr = cap.retrieve()
            if not ok:
                break
            next_due = t_raw + min_gap_ms
            decoded_index.append(index)
            t_ms = int(round(t_raw))
            t_ms = max(t_ms, last_ms + 1)            # Tasks VIDEO mode needs strictly increasing timestamps
            last_ms = t_ms
            
            # Grayscale for stick tracker, lighting, and pad detection
            gray_full = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
            
            # Analyze image quality on the first processed frame
            if image_quality is None:
                b, c = float(np.mean(gray_full)), float(np.std(gray_full))
                image_quality = {"brightness": b, "contrast": c, "bad_lighting": b < 40.0 or c < 20.0}
                
            # Attempt to find drum pad once
            if drum_pad is None and index > total // 4:
                blur = cv2.GaussianBlur(gray_full, (9, 9), 2)
                h, w = gray_full.shape
                sy = int(h * 0.4)
                edges = cv2.Canny(blur[sy:, :], 50, 150)
                circles = cv2.HoughCircles(edges, cv2.HOUGH_GRADIENT, dp=1, minDist=50,
                                           param1=150, param2=30, minRadius=20, maxRadius=int(h/2))
                if circles is not None:
                    c = circles[0, 0]
                    drum_pad = {"x": float(c[0]), "y": float(c[1] + sy), "r": float(c[2]), "detected": True}
                else:
                    drum_pad = {"detected": False}
            
            if scale < 1.0:
                bgr = cv2.resize(bgr, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
            frame = {"t": t_ms / 1000.0, "pts": None, "pose": None, "body": None, "hands": [], "sticks": []}
            res = pose.detect_for_video(image, t_ms)
            if res.pose_landmarks:
                lm = res.pose_landmarks[0]
                frame["pose"] = {k: (lm[i].x * width, lm[i].y * height, float(lm[i].visibility or 0.0))
                                 for k, i in POSE_IDS.items()}
                frame["body"] = {k: (lm[i].x * width, lm[i].y * height, float(lm[i].visibility or 0.0))
                                 for k, i in BODY_IDS.items()}
            hres = hands.detect_for_video(image, t_ms)
            
            hand_arrays = []
            for hand in hres.hand_landmarks:
                hand_xy = [(p.x * width, p.y * height) for p in hand]
                frame["hands"].append(hand_xy)
                hand_arrays.append(np.asarray(hand_xy))
            
            # Ray-cast stick tracking: use the full-resolution grayscale and hand landmarks
            if hand_arrays and frame["pose"]:
                # Downscale gray for tracker (match frontend: max 480px wide)
                tracker_w = min(width, 480)
                tracker_scale = tracker_w / width
                tracker_h = max(2, int(height * tracker_scale))
                if tracker_scale < 1.0:
                    tracker_gray = cv2.resize(gray_full, (tracker_w, tracker_h), interpolation=cv2.INTER_AREA).astype(np.float32)
                else:
                    tracker_gray = gray_full.astype(np.float32)
                    tracker_w, tracker_h = width, height
                
                # Scale hand landmarks to tracker resolution
                scaled_hands = [h * tracker_scale for h in hand_arrays]
                pose_wrists = {
                    "lw": (frame["pose"]["lw"][0] * tracker_scale, frame["pose"]["lw"][1] * tracker_scale),
                    "rw": (frame["pose"]["rw"][0] * tracker_scale, frame["pose"]["rw"][1] * tracker_scale),
                }
                tips = tracker.track_frame(tracker_gray, scaled_hands, pose_wrists, t_ms / 1000.0)
                
                # Scale tip coordinates back to full resolution
                for side in ("L", "R"):
                    if tips[side] is not None:
                        tx, ty = tips[side]
                        frame["sticks"].append((tx / tracker_scale, ty / tracker_scale))
                    else:
                        frame["sticks"].append(None)
            else:
                # No hands detected: still give the tracker a frame to update prev_gray
                if frame["pose"]:
                    tracker_w = min(width, 480)
                    tracker_scale = tracker_w / width
                    tracker_h = max(2, int(height * tracker_scale))
                    if tracker_scale < 1.0:
                        tracker_gray = cv2.resize(gray_full, (tracker_w, tracker_h), interpolation=cv2.INTER_AREA).astype(np.float32)
                    else:
                        tracker_gray = gray_full.astype(np.float32)
                    tracker.track_frame(tracker_gray, [], {"lw": (0, 0), "rw": (0, 0)}, t_ms / 1000.0)
                
            frames.append(frame)
            index += 1
            if progress and index % 30 == 0:
                progress(min(1.0, index / total))
    finally:
        cap.release()
        pose.close()
        hands.close()
    pts_source = "packets"
    if pts and len(pts) == index:                # every decoded frame has a packet time
        for frame, i in zip(frames, decoded_index):
            frame["pts"] = pts[i]
    elif frames:
        pts_source = "decoder"
        offset = (pts[0] - frames[0]["t"]) if pts else 0.0
        for frame in frames:
            frame["pts"] = round(frame["t"] + offset, 6)
            
    if drum_pad is None:
        drum_pad = {"detected": False}
        
    return {"frames": frames, "width": width, "height": height, "pts_source": pts_source,
            "pose_model": POSE_MODEL, "image_quality": image_quality, "drum_pad": drum_pad}


@dataclass
class Tracks:
    """Kept frames as arrays. y grows downward; coordinates are in pixels until divided by scale."""
    t: np.ndarray
    pts: dict[str, np.ndarray]                      # key -> (n, 2) pixel coords for ls, rs, le, re, lw, rw
    hands: dict[str, list] = field(default_factory=dict)   # "L"/"R" -> list of (21, 2) arrays
    stick_tips: dict[str, list] = field(default_factory=dict) # "L"/"R" -> list of (2,) arrays
    drum_pad: dict = field(default_factory=dict)    # "x", "y", "r"
    image_quality: dict = field(default_factory=dict) # "brightness", "contrast", "bad_lighting"
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

    def velocity(self, key: str) -> np.ndarray:
        """Vertical velocity (downward positive) in normalised units per second."""
        y = self.y(key)
        return np.gradient(y, self.t) if len(y) > 1 else np.zeros_like(y)

    def acceleration(self, key: str) -> np.ndarray:
        """Vertical acceleration in normalised units per second squared."""
        v = self.velocity(key)
        return np.gradient(v, self.t) if len(v) > 1 else np.zeros_like(v)

    def interp_y(self, key: str, times: np.ndarray) -> np.ndarray:
        """Interpolated normalised Y at arbitrary timestamps."""
        return np.interp(times, self.t, self.y(key))

    def interp_velocity(self, key: str, times: np.ndarray) -> np.ndarray:
        """Interpolated vertical velocity at arbitrary timestamps."""
        return np.interp(times, self.t, self.velocity(key))

    def interp_acceleration(self, key: str, times: np.ndarray) -> np.ndarray:
        """Interpolated vertical acceleration at arbitrary timestamps."""
        return np.interp(times, self.t, self.acceleration(key))


def build_tracks(raw: dict) -> Tracks:
    """Drop frames without both wrists visible, attach hands and sticks to wrists, pick the normalisation scale.
    
    Hand-to-wrist assignment uses the Hungarian algorithm (bipartite matching) so that when
    two hands are detected, each is assigned to a different wrist even if both are closer to
    the same one.
    """
    from scipy.optimize import linear_sum_assignment

    vis = tuning.current().min_wrist_visibility
    kept = [f for f in raw["frames"] if f["pose"]
            and f["pose"]["lw"][2] >= vis and f["pose"]["rw"][2] >= vis]
    t = np.array([f["t"] for f in kept])
    pts = {k: np.array([f["pose"][k][:2] for f in kept]).reshape(-1, 2) for k in POSE_IDS}
    hands: dict[str, list] = {"L": [], "R": []}
    stick_tips: dict[str, list] = {"L": [], "R": []}
    for f in kept:
        hands["L"].append(None)
        hands["R"].append(None)
        stick_tips["L"].append(None)
        stick_tips["R"].append(None)

        frame_hands = list(f["hands"])
        frame_sticks = list(f.get("sticks", []))
        # Pad sticks to match hands length if needed
        while len(frame_sticks) < len(frame_hands):
            frame_sticks.append(None)

        if not frame_hands:
            continue

        lw = np.asarray(f["pose"]["lw"][:2])
        rw = np.asarray(f["pose"]["rw"][:2])

        if len(frame_hands) == 1:
            arr = np.asarray(frame_hands[0])
            dl = np.linalg.norm(arr[0] - lw)
            dr = np.linalg.norm(arr[0] - rw)
            side = "L" if dl <= dr else "R"
            hands[side][-1] = arr
            if frame_sticks[0] is not None:
                stick_tips[side][-1] = np.asarray(frame_sticks[0])
        elif len(frame_hands) >= 2:
            # Bipartite matching: build cost matrix (num_hands x 2) where columns are [L, R]
            hand_arrays = [np.asarray(h) for h in frame_hands[:2]]
            costs = np.array([
                [np.linalg.norm(h[0] - lw), np.linalg.norm(h[0] - rw)]
                for h in hand_arrays
            ])
            row_idx, col_idx = linear_sum_assignment(costs)
            for r, c in zip(row_idx, col_idx):
                side = "L" if c == 0 else "R"
                hands[side][-1] = hand_arrays[r]
                if frame_sticks[r] is not None:
                    stick_tips[side][-1] = np.asarray(frame_sticks[r])

    tracks = Tracks(t=t, pts=pts, hands=hands, stick_tips=stick_tips,
                    drum_pad=raw.get("drum_pad", {}),
                    image_quality=raw.get("image_quality", {}),
                    total_frames=len(raw["frames"]))
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
    """Video strikes from stick tip Y-position peaks, with wrist dips as fallback.

    When stick tips are available (from the ray-cast tracker), they provide the primary
    signal because the tip moves independently of the wrist during rebounds and diddles.
    Wrist dips are used as fallback for frames where no stick tip was tracked.
    Events from both signals within strike_same_stroke_ms are deduplicated, keeping
    the stick tip event (it is more temporally precise).
    """
    if len(tracks.t) < 5:
        return []
    tune = tuning.current()
    dt = float(np.median(np.diff(tracks.t)))
    gap = max(1, int(tune.strike_min_gap_ms / 1000.0 / dt))
    k = max(1, int(tune.strike_smooth_frames))
    kernel = np.ones(k) / k
    min_gap_s = tune.strike_min_gap_ms / 1000.0
    same_stroke_s = tune.strike_same_stroke_ms / 1000.0

    tip_events: list[tuple[float, str]] = []
    wrist_events: list[tuple[float, str]] = []

    for side in ("L", "R"):
        # Primary: stick tip Y peaks
        tips = tracks.stick_tips.get(side, [])
        valid_indices = [i for i in range(len(tips)) if tips[i] is not None]
        if len(valid_indices) >= 5:
            tip_t = np.array([tracks.t[i] for i in valid_indices])
            tip_y = np.array([tips[i][1] for i in valid_indices])
            smoothed = np.convolve(tip_y, kernel, mode="same")
            # Prominence in pixels scaled by shoulder width
            prominence = max(5.0, tune.strike_min_prominence * tracks.scale)
            tip_gap = max(1, int(tune.strike_min_gap_ms / 1000.0 / (float(np.median(np.diff(tip_t))) + 1e-9)))
            lows, _ = find_peaks(smoothed, prominence=prominence, distance=tip_gap)
            tip_events += [(float(tip_t[p]), side) for p in lows]

        # Fallback: wrist Y peaks (always computed)
        wrist_key = "lw" if side == "L" else "rw"
        y = np.convolve(tracks.y(wrist_key), kernel, mode="same")
        lows, _ = find_peaks(y, prominence=tune.strike_min_prominence, distance=gap)
        wrist_events += [(float(tracks.t[p]), side) for p in lows]
        # Speed spikes (second note of diddles via wrist)
        if tune.strike_speed_prominence > 0 and len(tracks.t) > 2:
            xy = tracks.pts[wrist_key] / tracks.scale
            speed = np.linalg.norm(np.gradient(xy, tracks.t, axis=0), axis=1)
            downward = np.gradient(y, tracks.t) > 0
            speed = np.where(downward, speed, 0.0)
            speed = np.convolve(speed, kernel, mode="same")
            spikes, _ = find_peaks(speed, prominence=tune.strike_speed_prominence, distance=gap)
            wrist_events += [(float(tracks.t[p]), side) for p in spikes]

    # Merge: prefer tip events, add wrist events only when no tip event is nearby
    kept: list[dict] = []
    taken: list[tuple[float, str]] = []

    def near_taken(t: float, hand: str) -> bool:
        return any(other == hand and abs(t - prev) < min_gap_s for prev, other in taken)

    # First pass: all tip events
    for t, hand in sorted(tip_events):
        if near_taken(t, hand):
            continue
        kept.append({"t": t, "hand": hand, "source": "tip"})
        taken.append((t, hand))

    # Second pass: wrist events that are not near any tip event
    for t, hand in sorted(wrist_events):
        if near_taken(t, hand):
            continue
        # Skip if a tip event already covers this stroke
        if any(other == hand and abs(t - prev) <= same_stroke_s for prev, other in
               [(e[0], e[1]) for e in tip_events]):
            continue
        kept.append({"t": t, "hand": hand, "source": "wrist"})
        taken.append((t, hand))

    kept.sort(key=lambda s: s["t"])
    return kept


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
                for h in tracks.hands.get(hand, []) if h is not None]
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
        "image_quality": tracks.image_quality,
        "drum_pad": tracks.drum_pad,
        "form": {
            "symmetry": None if degraded else _round(symmetry(tracks)),
            **({"posture_drift_per_min": None, "shoulder_line_angle_deg": None} if degraded else posture(tracks)),
            "grip_proxy": {"experimental": True, "L": None, "R": None} if degraded else grip_proxy(tracks),
        },
        "trajectories": trajectories(tracks),
    }


def _round(v: float | None, n: int = 4) -> float | None:
    return round(v, n) if v is not None else None
