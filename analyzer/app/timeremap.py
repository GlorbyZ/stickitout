"""Slow motion detection and the real-time clock.

Phones save slow motion in two ways:

* Real-time originals (iPhone .MOV, Samsung files with an SEF "SlowMotion_Data" trailer): the
  frames carry their true capture timestamps (120/240 fps) and the phone only slows playback.
  Nothing needs remapping; the packet timestamps are already real time.
* Baked-in exports: the slow part is re-timed into an ordinary 30/60 fps file, so a stroke that
  took 50 ms appears to take 200 ms, and the sound in that part is slowed (lower pitch, less
  treble) or muted. Scoring such a file as is gives wrong tempo, timing and verification.

detect() looks at metadata first (Android com.android.capture.fps higher than the file's frame
rate means the whole file is slowed by that ratio; the Samsung SEF trailer lists the slowed
segments of a real-time original) and then at the content: a stretch where the picture moves a
consistent 2, 4 or 8 times less than the rest AND the sound confirms it (silent, or its bandwidth
drops by the same factor). Motion alone is never enough when there is sound, because players
also just slow down.

TimeMap maps file time to real time piecewise. The pipeline analyses sound and movement on the
real-time clock and converts the times shown with the video back to file time, so the playback
skeleton and timestamp chips still line up with the file as it plays.
"""
from __future__ import annotations

import math
import re
import subprocess
import wave
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .media import VideoInfo, ffmpeg_exe, frame_times, looks_slowed

FACTORS = (2, 4, 8)
SNAP_TOLERANCE = 0.4          # |log2(measured) - log2(factor)| accepted when snapping
MIN_SLOW_S = 0.5              # shortest slowed stretch found from content
MIN_FAST_S = 0.4              # normal-speed footage needed outside it to compare against
MAX_SCAN_S = 180             # the movement scan decodes every frame; baked-in slow motion clips are short
MUTED_DB = -50.0              # a slowed stretch this quiet has no usable sound
MOTION_WIDTH = 64             # frame width for the motion measure
NO_SOUND = "video only (slow motion section, no usable sound)"


@dataclass
class Segment:
    file_start: float
    file_end: float
    factor: float
    audio: str = "slowed"      # slowed (time-compressed for onsets), muted (no usable sound) or none

    @property
    def real_len(self) -> float:
        return (self.file_end - self.file_start) / self.factor


@dataclass
class TimeMap:
    segments: list[Segment] = field(default_factory=list)

    def to_real(self, t: float) -> float:
        out = t
        for s in self.segments:
            over = min(t, s.file_end) - s.file_start
            if over > 0:
                out -= over * (1.0 - 1.0 / s.factor)
        return out

    def to_file(self, r: float) -> float:
        file_t, real_t = 0.0, 0.0
        for s in sorted(self.segments, key=lambda s: s.file_start):
            gap = s.file_start - file_t                   # normal speed before this segment
            if r <= real_t + gap:
                return file_t + (r - real_t)
            file_t, real_t = s.file_start, real_t + gap
            if r <= real_t + s.real_len:
                return file_t + (r - real_t) * s.factor
            file_t, real_t = s.file_end, real_t + s.real_len
        return file_t + (r - real_t)

    def muted(self, r: float) -> bool:
        """True when real time r falls in a slowed stretch without usable sound."""
        f = self.to_file(r)
        return any(s.audio in ("muted", "none") and s.file_start <= f <= s.file_end for s in self.segments)


def snap(ratio: float) -> int | None:
    if not ratio or ratio <= 1.0:
        return None
    best = min(FACTORS, key=lambda f: abs(math.log2(ratio) - math.log2(f)))
    return best if abs(math.log2(ratio) - math.log2(best)) <= SNAP_TOLERANCE else None


def clock(t: float) -> str:
    s = int(round(max(0.0, t)))
    return f"{s // 60}:{s % 60:02d}"


# ---------- metadata ----------

def read_metadata(path: Path) -> dict:
    """Slow motion hints from the container: Android capture fps and the Samsung SEF trailer."""
    out: dict = {"android_capture_fps": None, "samsung_sef_segments": [], "samsung_model": None}
    try:
        header = subprocess.run([ffmpeg_exe(), "-hide_banner", "-i", str(path)], capture_output=True,
                                text=True, encoding="utf-8", errors="replace", timeout=60).stderr
        m = re.search(r"com\.android\.capture\.fps\s*:\s*([\d.]+)", header)
        out["android_capture_fps"] = float(m.group(1)) if m else None
    except Exception:
        pass
    try:
        out["samsung_sef_segments"] = read_sef_slow_motion(path)
    except Exception:
        pass
    return out


def read_sef_slow_motion(path: Path) -> list[dict]:
    """Segments of the Samsung Extension Format "SlowMotion_Data" record, if the file has one.

    Layout (as read by Android Media3 SefReader): the file ends with a directory
    "SEFH" version count {00 00, type u16, offset u32, size u32}* size "SEFT"; each record is
    00 00, type u16, name_len u32, name, data. SlowMotion_Data is ASCII "start_ms:end_ms:mode"
    joined by '*', and the slow down is 2^(mode - 1).
    """
    with open(path, "rb") as fh:
        fh.seek(0, 2)
        end = fh.tell()
        if end < 16:
            return []
        fh.seek(end - 8)
        tail = fh.read(8)
        if tail[4:] != b"SEFT":
            return []
        size = int.from_bytes(tail[:4], "little")
        dir_pos = end - 8 - size
        fh.seek(dir_pos)
        d = fh.read(size + 8)
        if d[:4] != b"SEFH":
            return []
        count = int.from_bytes(d[8:12], "little")
        segs = []
        for i in range(count):
            e = 12 + 12 * i
            off = int.from_bytes(d[e + 4:e + 8], "little")
            rsize = int.from_bytes(d[e + 8:e + 12], "little")
            fh.seek(dir_pos - off)
            rec = fh.read(rsize)
            name_len = int.from_bytes(rec[4:8], "little")
            name = rec[8:8 + name_len].decode("utf-8", "replace")
            if name.replace("_", "").lower() != "slowmotiondata":
                continue
            for part in rec[8 + name_len:].decode("ascii", "replace").strip("\x00 ").split("*"):
                vals = part.strip().split(":")
                if len(vals) == 3 and all(v.strip().lstrip("-").isdigit() for v in vals):
                    start, stop, mode = (int(v) for v in vals)
                    segs.append({"start_s": start / 1000, "end_s": stop / 1000, "slow_down": 2 ** max(0, mode - 1)})
        return segs


# ---------- content ----------

def motion_series(path: Path) -> tuple[np.ndarray, np.ndarray]:
    """(frame time in file seconds, mean absolute frame difference) from a small grey decode."""
    p = subprocess.run([ffmpeg_exe(), "-v", "error", "-i", str(path), "-vsync", "0", "-vf",
                        f"scale={MOTION_WIDTH}:-2,format=gray", "-f", "rawvideo", "-"],
                       capture_output=True, timeout=1800)
    pts = frame_times(path)
    raw = np.frombuffer(p.stdout, dtype=np.uint8)
    if not pts or raw.size == 0:
        return np.array([]), np.array([])
    n = len(pts)
    px = raw.size // n
    if px == 0 or px % MOTION_WIDTH:
        return np.array([]), np.array([])
    frames = raw[: n * px].reshape(n, px).astype(np.float32)
    diff = np.abs(np.diff(frames, axis=0)).mean(axis=1)
    t = np.asarray(pts, dtype=float) - pts[0]
    return t[1:], diff


def audio_features(y: np.ndarray, sr: int, hop_s: float = 0.05) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(window centre times, RMS dBFS, 95% spectral roll-off Hz) per hop_s window."""
    hop = max(1, int(sr * hop_s))
    n = len(y) // hop
    if n == 0:
        return np.array([]), np.array([]), np.array([])
    frames = y[: n * hop].reshape(n, hop)
    rms = 20 * np.log10(np.sqrt((frames ** 2).mean(axis=1)) + 1e-9)
    spec = np.abs(np.fft.rfft(frames * np.hanning(hop), axis=1)) ** 2
    freqs = np.fft.rfftfreq(hop, 1.0 / sr)
    cum = np.cumsum(spec, axis=1)
    total = cum[:, -1:] + 1e-20
    roll = freqs[np.minimum(np.argmax(cum >= 0.95 * total, axis=1), len(freqs) - 1)]
    return (np.arange(n) + 0.5) * hop_s, rms, roll


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    out, start = [], None
    for i, v in enumerate(mask):
        if v and start is None:
            start = i
        elif not v and start is not None:
            out.append((start, i))
            start = None
    if start is not None:
        out.append((start, len(mask)))
    return out


def find_slowed(t: np.ndarray, motion: np.ndarray, at: np.ndarray, rms: np.ndarray, roll: np.ndarray,
                has_audio: bool) -> tuple[list[Segment], list[str]]:
    """Slowed stretches confirmed by motion and sound. Returns (segments, notes)."""
    notes: list[str] = []
    if len(t) < 30:
        return [], notes
    fps = (len(t) - 1) / max(t[-1] - t[0], 1e-6)
    k = max(1, int(round(0.25 * fps))) | 1
    pad = np.pad(motion, (k // 2, k // 2), mode="edge")
    smooth = np.array([np.median(pad[i:i + k]) for i in range(len(motion))])
    lm = np.log2(smooth + 1e-3)
    lo, hi = np.percentile(lm, 10), np.percentile(lm, 90)
    if hi - lo < math.log2(1.8):
        return [], notes
    slow = lm < (lo + hi) / 2
    # fill short fast gaps inside a slow stretch, drop short slow blips
    for a, b in _runs(~slow):
        if 0 < a and b < len(slow) and t[min(b, len(t) - 1)] - t[a] < 0.2:
            slow[a:b] = True
    segs = []
    fast_mask = ~slow
    for a, b in _runs(slow):
        t0, t1 = t[a], t[min(b, len(t) - 1)]
        if t1 - t0 < MIN_SLOW_S:
            fast_mask[a:b] = True
            continue
        segs.append((a, b, t0, t1))
    if not segs:
        return [], notes
    if (t[fast_mask].size / fps if fast_mask.any() else 0.0) < MIN_FAST_S:
        notes.append("The whole clip moves slowly, so a baked-in slow down cannot be measured from the picture.")
        return [], notes
    fast_level = np.median(lm[fast_mask])
    out: list[Segment] = []
    for a, b, t0, t1 in segs:
        ratio = 2 ** (fast_level - np.median(lm[a:b]))
        factor = snap(ratio)
        if factor is None:
            notes.append(f"Slower movement at {clock(t0)} to {clock(t1)} (x{ratio:.1f}) is not a clean 2, 4 or 8 times slow down.")
            continue
        if not has_audio or not at.size:
            out.append(Segment(float(t0), float(t1), float(factor), "none"))
            continue
        inside = (at >= t0) & (at <= t1)
        outside = ~inside
        if inside.sum() < 3 or outside.sum() < 3:
            continue
        rin, rout = np.median(rms[inside]), np.median(rms[outside])
        floor = max(float(np.percentile(motion, 1)), 0.05)          # sensor / encoder noise on a still frame
        still_moving = np.median(smooth[a:b]) > 3 * floor
        if rin < MUTED_DB and rout > MUTED_DB + 10 and still_moving:     # a silent pause is not slow motion
            out.append(Segment(float(t0), float(t1), float(factor), "muted"))
            continue
        loud_in, loud_out = inside & (rms > MUTED_DB), outside & (rms > MUTED_DB)
        if loud_in.sum() >= 3 and loud_out.sum() >= 3:
            aratio = np.median(roll[loud_out]) / max(np.median(roll[loud_in]), 1.0)
            if snap(aratio) == factor:
                out.append(Segment(float(t0), float(t1), float(factor), "slowed"))
                continue
        notes.append(f"Slower movement at {clock(t0)} to {clock(t1)} but the sound does not show a slow down, "
                     "so it was treated as a real change of speed.")
    return out, notes


# ---------- detection ----------

def detect(path: Path, info: VideoInfo, y: np.ndarray | None, sr: int | None) -> tuple[TimeMap | None, dict]:
    """(TimeMap or None, report section) for one file. Never raises."""
    meta = read_metadata(path)
    section: dict = {"detected": False, "method": None, "remapped": False, "segments": [], "message": None,
                     "notes": [], "metadata": {**meta, "apple_slowmo_tag": info.slowmo_tag or None},
                     "real_duration_s": info.duration_s}
    cap = meta.get("android_capture_fps")
    if meta["samsung_sef_segments"]:
        segs = meta["samsung_sef_segments"]
        section.update(detected=True, method="metadata (Samsung SEF)")
        section["notes"].append("Samsung slow motion original: frames keep real capture timestamps, so no remapping is needed.")
        section["message"] = "Slow motion detected: " + ", ".join(
            f"{clock(s['start_s'])} to {clock(s['end_s'])} plays {s['slow_down']}x slower on the phone" for s in segs) + \
            f"; captured at {round(info.fps)} fps and analyzed at real speed"
        return None, section
    if is_slowmo_original(info):
        section.update(detected=True, method="frame timestamps")
        section["message"] = f"Slow motion detected: captured at {round(info.fps)} fps, analyzed at real speed"
        return None, section
    tmap = None
    if cap and info.fps > 0 and cap >= 1.5 * info.fps:
        factor = snap(cap / info.fps) or round(cap / info.fps)
        audio = "none"
        if y is not None and sr and len(y):
            audio = "muted" if 20 * np.log10(np.sqrt(np.mean(y ** 2)) + 1e-9) < MUTED_DB else "slowed"
        tmap = TimeMap([Segment(0.0, info.duration_s, float(factor), audio)])
        section["method"] = f"metadata (Android capture {cap:g} fps in a {info.fps:g} fps file)"
    elif info.duration_s > MAX_SCAN_S:
        section["notes"].append(f"Slow motion check by movement skipped for clips over {MAX_SCAN_S // 60} minutes.")
    else:
        try:
            t, motion = motion_series(path)
            at, rms, roll = audio_features(y, sr) if y is not None and sr else (np.array([]),) * 3
            segs, notes = find_slowed(t, motion, at, rms, roll, info.has_audio and y is not None and len(y) > 0)
            section["notes"] += notes
            if segs:
                tmap = TimeMap(segs)
                section["method"] = "content (movement and sound)"
        except Exception as exc:  # detection must never break an analysis
            section["notes"].append(f"Slow motion check skipped: {type(exc).__name__}")
    if looks_slowed(info) and tmap is None:
        section["notes"].append("The file is tagged as a slowed slow motion export, but the slow part could not be "
                                "measured, so tempo and timing may be off. Upload the original file for best results.")
    if tmap is None:
        return None, section
    section.update(detected=True, remapped=True,
                   real_duration_s=round(tmap.to_real(info.duration_s), 3),
                   segments=[{"file_start_s": round(s.file_start, 3), "file_end_s": round(s.file_end, 3),
                              "factor": s.factor, "capture_fps": round(info.fps * s.factor),
                              "audio": s.audio} for s in tmap.segments])
    section["message"] = "Slow motion detected: " + ", ".join(
        f"{clock(s.file_start)} to {clock(s.file_end)} captured at ~{round(info.fps * s.factor)} fps"
        for s in tmap.segments) + ", analyzed at real speed"
    return tmap, section


def is_slowmo_original(info: VideoInfo) -> bool:
    return info.fps >= 100


def from_section(section: dict | None) -> TimeMap | None:
    if not section or not section.get("remapped"):
        return None
    return TimeMap([Segment(s["file_start_s"], s["file_end_s"], s["factor"], s["audio"]) for s in section["segments"]])


# ---------- applying the map ----------

def real_time_audio(y: np.ndarray, sr: int, tmap: TimeMap) -> np.ndarray:
    """File audio on the real-time clock: slowed stretches compressed, muted ones silent."""
    from scipy.signal import resample_poly
    parts, pos = [], 0
    for s in sorted(tmap.segments, key=lambda s: s.file_start):
        a, b = int(round(s.file_start * sr)), int(round(s.file_end * sr))
        parts.append(y[pos:a])
        seg = y[a:b]
        n_real = int(round(len(seg) / s.factor))
        if s.audio == "slowed" and len(seg) > 0:
            f = int(round(s.factor))
            comp = resample_poly(seg, 1, f) if abs(s.factor - f) < 1e-6 else np.interp(
                np.linspace(0, len(seg) - 1, n_real), np.arange(len(seg)), seg)
            parts.append(comp[:n_real].astype(np.float32))
        else:
            parts.append(np.zeros(n_real, dtype=np.float32))
        pos = b
    parts.append(y[pos:])
    return np.concatenate([np.asarray(p, dtype=np.float32) for p in parts]) if parts else y


def write_wav(path: Path, y: np.ndarray, sr: int) -> None:
    pcm = (np.clip(y, -1.0, 1.0) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def remap_frames(raw: dict, tmap: TimeMap) -> dict:
    """Landmark frames on the real-time clock (pts stay on the file timeline for playback)."""
    frames = [{**f, "t": tmap.to_real(f["t"])} for f in raw["frames"]]
    return {**raw, "frames": frames}


def split_video_only(verification: dict, tmap: TimeMap) -> None:
    """Strikes seen in a slowed stretch with no usable sound are not 'seen, not heard'."""
    keep, quiet = [], []
    for v in verification.get("video_only", []):
        (quiet if tmap.muted(v["t"]) else keep).append(v)
    if not quiet:
        return
    for v in quiet:
        v["note"] = NO_SOUND
    verification["video_only"] = keep
    verification["video_only_no_sound"] = quiet
    verification["video_only_strikes"] = len(keep)
    n_v, n_u = verification["verified_stroke_count"], verification["unverified_onsets"]
    total = n_v + n_u + len(keep)
    verification["agreement_pct"] = round(100.0 * n_v / total, 2) if total else 0.0


def to_file_times(report: dict, tmap: TimeMap) -> None:
    """Convert the times shown with the video (strokes, onsets, chips, charts) back to file time."""
    def conv(v):
        return round(tmap.to_file(float(v)), 4)

    audio = report.get("audio") or {}
    for o in audio.get("onsets") or []:
        o["t_real"], o["t"] = o["t"], conv(o["t"])
    if audio.get("beat_times"):
        audio["beat_times"] = [conv(x) for x in audio["beat_times"]]
    for s in report.get("strokes") or []:
        s["t_real"], s["t"] = s["t"], conv(s["t"])
    ver = report.get("verification") or {}
    for key in ("video_only", "video_only_no_sound"):
        for v in ver.get(key) or []:
            v["t_real"], v["t"] = v["t"], conv(v["t"])
    traj = ((report.get("video") or {}).get("trajectories") or {})
    if traj.get("t"):
        traj["t"] = [conv(x) for x in traj["t"]]

    def walk(x):
        if isinstance(x, dict):
            if isinstance(x.get("t"), (int, float)) and "t_real" not in x:
                x["t_real"], x["t"] = x["t"], conv(x["t"])
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    walk(report.get("coaching"))
