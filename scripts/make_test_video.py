"""Make synthetic test videos with a click track muxed in.

Two picture modes:
  default     an ffmpeg test pattern. No person, so form analysis degrades (by
              design) while the audio results still come back.
  --drummer   a "synthetic drummer" built from a still photo of a person with both
              arms visible (MediaPipe's public pose sample, downloaded once to
              data/fixtures). The photo is split down the middle and each half,
              carrying one arm, dips on that hand's strokes of a single paradiddle
              (RLRR LRLL) in time with the clicks. This exercises MediaPipe, the
              audio/video cross-check and the sticking check end to end.
Use --fps 30 to produce a clip the API must reject.

Usage:
  python scripts/make_test_video.py out.mp4 [--drummer] [--fps 60] [--seconds 20]
         [--bpm 100] [--per-beat 4] [--size 640x360]
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

import imageio_ffmpeg

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from scripts.make_click_test import FIRST_CLICK_S, write_click_wav  # noqa: E402

PERSON_URL = "https://storage.googleapis.com/mediapipe-assets/pose.jpg"
PERSON_PATH = ROOT / "data" / "fixtures" / "pose.jpg"
PARADIDDLE_R = (0, 2, 3, 5)  # positions of R in RLRRLRLL
DIP_PX, DIP_SIGMA_S = 45, 0.03


def person_image() -> Path:
    if not PERSON_PATH.exists():
        PERSON_PATH.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(PERSON_URL, PERSON_PATH)
    return PERSON_PATH


def _dip(positions: tuple[int, ...], step: float) -> str:
    """ffmpeg expression: downward offset for one image half at time t."""
    k = f"floor((t-{FIRST_CLICK_S})/{step}+0.5)"
    dt = f"(t-{FIRST_CLICK_S}-{k}*{step})"
    hit = "+".join(f"eq(mod({k},8),{p})" for p in positions)
    return f"30+({hit})*{DIP_PX}*exp(-pow({dt}/{DIP_SIGMA_S},2))"


def _drummer_filter(fps: int, step: float) -> str:
    left = PARADIDDLE_R
    right = tuple(p for p in range(8) if p not in left)
    return (
        "[0:v]crop=700:394:150:190,scale=1280:720,split[a][b];"
        "[a]crop=640:720:0:0[pl];[b]crop=640:720:640:0[pr];"
        f"color=c=0x87b5e0:s=1280x720:r={fps}[bg];"
        f"[bg][pl]overlay=x=0:y='{_dip(left, step)}':eval=frame[t1];"
        f"[t1][pr]overlay=x=640:y='{_dip(right, step)}':eval=frame,format=yuv420p[v]"
    )


def make_video(out: Path, fps: int = 60, seconds: float = 20.0, bpm: float = 100.0,
               per_beat: int = 4, size: str = "640x360", drummer: bool = False) -> Path:
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    with tempfile.TemporaryDirectory() as tmp:
        wav = write_click_wav(Path(tmp) / "click.wav", bpm=bpm, duration_s=seconds,
                              per_beat=4 if drummer else per_beat)
        if drummer:
            script = Path(tmp) / "filter.txt"
            script.write_text(_drummer_filter(fps, 60.0 / bpm / 4), encoding="utf-8")
            video_in = ["-loop", "1", "-framerate", str(fps), "-i", str(person_image())]
            mapping = ["-filter_complex_script", str(script), "-map", "[v]", "-map", "1:a"]
        else:
            video_in = ["-f", "lavfi", "-i", f"testsrc2=size={size}:rate={fps}"]
            mapping = ["-pix_fmt", "yuv420p"]
        cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", *video_in, "-i", str(wav), *mapping,
               "-r", str(fps), "-t", str(seconds), "-c:v", "libx264", "-preset", "veryfast",
               "-c:a", "aac", "-b:a", "192k", "-shortest", str(out)]
        subprocess.run(cmd, check=True)
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("out", type=Path)
    ap.add_argument("--drummer", action="store_true", help="animated person doing single paradiddles")
    ap.add_argument("--fps", type=int, default=60)
    ap.add_argument("--seconds", type=float, default=20.0)
    ap.add_argument("--bpm", type=float, default=100.0)
    ap.add_argument("--per-beat", type=int, default=4)
    ap.add_argument("--size", default="640x360")
    a = ap.parse_args()
    print(make_video(a.out, a.fps, a.seconds, a.bpm, a.per_beat, a.size, a.drummer))
