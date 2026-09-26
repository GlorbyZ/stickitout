"""Media ingest: probe uploaded videos and extract their audio track.

Uses the ffmpeg binary shipped with imageio-ffmpeg (override with the
IMAGEIO_FFMPEG_EXE environment variable), so no system ffmpeg is required.

The frame rate check measures the real average fps (decoded frame count over
stream duration) instead of trusting the container header, because phone and
browser (MediaRecorder) recordings are often variable frame rate and WebM files
from browsers frequently carry no duration at all.
"""
from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

import imageio_ffmpeg

from . import config

# Anything from about 24 fps up is analysed (MIN_FPS env var, default 23.5 so the
# 23.976 fps film rate passes). Ordinary 30 fps phone video, including uneven
# frame timing, passes. Below LOW_FPS_BELOW the report carries quality.low_fps
# and a disclaimer, and the audio/video verify window is widened (fusion.py).
# 60 fps class footage (59.94, or variable rate recordings averaging a little
# under 60) is analysed at full accuracy, exactly as before.
LOW_FPS_BELOW = 50.0
AUDIO_SR = 44100


class MediaError(ValueError):
    """Raised when an upload cannot be analysed. The message is user facing."""


@dataclass
class VideoInfo:
    fps: float            # measured average fps (frames / duration)
    nominal_fps: float    # fps declared in the stream header (0 if missing)
    duration_s: float
    frame_count: int
    width: int
    height: int
    has_audio: bool
    container: str


def ffmpeg_exe() -> str:
    return imageio_ffmpeg.get_ffmpeg_exe()


def _run(args: list[str], timeout: float = 600) -> subprocess.CompletedProcess:
    return subprocess.run(
        [ffmpeg_exe(), "-hide_banner", *args],
        capture_output=True, text=True, errors="replace", timeout=timeout,
    )


def _hms(text: str) -> float:
    h, m, s = text.split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


def probe_video(path: Path) -> VideoInfo:
    """Read stream info and measure the real frame rate.

    A stream copy to the null muxer counts every video packet without decoding,
    so it is fast even for long 1080p60 files and works for WebM without a
    duration header.
    """
    header = _run(["-i", str(path)]).stderr
    video_line = next((ln for ln in header.splitlines() if "Video:" in ln), None)
    if video_line is None:
        raise MediaError("No video stream found. Upload a video file recorded with your phone or camera.")
    size = re.search(r"(\d{2,5})x(\d{2,5})", video_line)
    width, height = (int(size.group(1)), int(size.group(2))) if size else (0, 0)
    fps_m = re.search(r"([\d.]+) fps", video_line) or re.search(r"([\d.]+) tbr", video_line)
    nominal = float(fps_m.group(1)) if fps_m else 0.0
    has_audio = any("Audio:" in ln for ln in header.splitlines())
    container_m = re.search(r"Input #0, ([^,]+)", header)
    container = container_m.group(1) if container_m else "unknown"

    # framecrc lists every video packet (dts, pts, duration) without decoding.
    # fps = packets / span of presentation timestamps, which is the true
    # average rate even for variable-frame-rate MediaRecorder or phone files.
    crc = _run(["-loglevel", "error", "-i", str(path), "-map", "0:v:0", "-c", "copy", "-f", "framecrc", "-"])
    tb_m = re.search(r"#tb 0: (\d+)/(\d+)", crc.stdout)
    tb = int(tb_m.group(1)) / int(tb_m.group(2)) if tb_m else 0.0
    pts, durs = [], []
    for ln in crc.stdout.splitlines():
        if ln and not ln.startswith("#"):
            cols = [c.strip() for c in ln.split(",")]
            if len(cols) >= 4 and cols[2].lstrip("-").isdigit():
                pts.append(int(cols[2]))
                durs.append(int(cols[3]) if cols[3].isdigit() else 0)
    frame_count = len(pts)
    if frame_count < 2 or tb <= 0:
        raise MediaError("Could not read any video frames from this file. It may be damaged or still uploading.")
    span = (max(pts) - min(pts)) * tb
    if span <= 0:
        raise MediaError("Could not read any video frames from this file. It may be damaged or still uploading.")
    fps = (frame_count - 1) / span
    duration = span + (durs[-1] * tb if durs[-1] else 1.0 / fps)
    return VideoInfo(round(fps, 2), round(nominal, 2), round(duration, 3), frame_count,
                     width, height, has_audio, container)


def frame_times(path: Path) -> list[float]:
    """Presentation time in seconds of every video frame, in display order, on the file's own timeline.

    ffmpeg -copyts keeps the stream start offset and edit list, which is the same timeline a
    browser reports as requestVideoFrameCallback mediaTime (verified in Chrome on a variable
    frame rate MP4 with B-frames and a 0.25 s start offset). Playback overlays look frames up
    by these values. Returns [] when the file cannot be read.
    """
    crc = _run(["-loglevel", "error", "-copyts", "-i", str(path), "-map", "0:v:0", "-c", "copy", "-f", "framecrc", "-"])
    tb_m = re.search(r"#tb 0: (\d+)/(\d+)", crc.stdout)
    if not tb_m:
        return []
    tb = int(tb_m.group(1)) / int(tb_m.group(2))
    pts = []
    for ln in crc.stdout.splitlines():
        if ln and not ln.startswith("#"):
            cols = [c.strip() for c in ln.split(",")]
            if len(cols) >= 4 and cols[2].lstrip("-").isdigit():
                pts.append(int(cols[2]))
    return [round(p * tb, 6) for p in sorted(pts)]


def min_fps() -> float:
    """Lowest accepted measured frame rate (config.MIN_FPS, read at call time)."""
    return float(config.MIN_FPS)


def check_frame_rate(info: VideoInfo) -> None:
    """Reject footage below MIN_FPS (about 24 fps) with an actionable message."""
    limit = min_fps()
    if info.fps < limit:
        declared = f", header says {info.nominal_fps:g} fps" if info.nominal_fps else ""
        raise MediaError(
            f"This video is about {round(info.fps)} fps (measured {info.fps:.1f} fps over "
            f"{info.duration_s:.1f} s{declared}). The analyzer needs at least {round(limit)} fps. "
            "60 fps gives the most accurate results and 30 fps also works. On iPhone use "
            "Settings > Camera > Record Video > 1080p at 60 fps. On Android pick 60 fps in the "
            "camera video settings. In Record mode, use good light: many cameras lower the frame "
            "rate when the room is dark."
        )


def is_low_fps(fps: float) -> bool:
    """True for accepted clips under the 60 fps class (roughly 24 to 49 fps)."""
    return fps < LOW_FPS_BELOW


def low_fps_message(fps: float) -> str:
    """Plain language disclaimer shown next to the Verified score for low frame rate clips."""
    return (f"Recorded at {round(fps)} fps. Fast strokes can fall between frames, so Verified, "
            "sticking and form scores are estimates. For the most accurate results, record at 60 fps.")


def extract_audio(video: Path, wav_out: Path, info: VideoInfo) -> Path:
    """Extract the video's audio track as mono 44.1 kHz 16-bit WAV."""
    if not info.has_audio:
        raise MediaError("This video has no audio track. Record with the microphone on so the hits can be heard.")
    res = _run(["-y", "-i", str(video), "-vn", "-ac", "1", "-ar", str(AUDIO_SR),
                "-c:a", "pcm_s16le", str(wav_out)])
    if res.returncode != 0 or not wav_out.exists():
        raise MediaError("Could not extract the audio track from this video.")
    return wav_out

