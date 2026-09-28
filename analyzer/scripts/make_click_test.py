"""Generate the synthetic 120 BPM click fixture for the audio test (spec 10.1).

60 seconds of metronome clicks at 120 BPM with 6 clicks per beat (16th-note
triplets), which gives the 720 onsets the spec expects. Beat clicks are
accented so beat tracking locks to 120 BPM rather than a multiple of it. A
-60 dBFS noise floor stands in for the room and microphone hiss every real
recording has (onset detectors misbehave on perfect digital silence).

Usage:  python scripts/make_click_test.py [out.wav]   (default data/fixtures/click_120bpm.wav)
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile

SR = 44100
BPM = 120.0
DURATION_S = 60.0
CLICKS_PER_BEAT = 6
FIRST_CLICK_S = 0.04


def click_times(bpm: float = BPM, duration_s: float = DURATION_S, per_beat: int = CLICKS_PER_BEAT) -> np.ndarray:
    step = 60.0 / bpm / per_beat
    n = int(np.floor((duration_s - FIRST_CLICK_S - 0.02) / step)) + 1
    return FIRST_CLICK_S + step * np.arange(n)


def render_click_track(bpm: float = BPM, duration_s: float = DURATION_S,
                       per_beat: int = CLICKS_PER_BEAT, sr: int = SR) -> np.ndarray:
    """Float32 mono click track in -1..1."""
    rng = np.random.default_rng(120)
    y = np.zeros(int(duration_s * sr), dtype=np.float32)
    n_click = int(0.012 * sr)
    t = np.arange(n_click) / sr
    env = np.exp(-t / 0.0025)
    body = np.sin(2 * np.pi * 2500 * t) * 0.6 + rng.uniform(-1, 1, n_click) * 0.4
    click = (body * env).astype(np.float32)
    for i, ct in enumerate(click_times(bpm, duration_s, per_beat)):
        s = int(round(ct * sr))
        amp = 0.9 if i % per_beat == 0 else 0.45
        y[s:s + n_click] += amp * click[: len(y) - s]
    y += rng.normal(0.0, 0.001, len(y)).astype(np.float32)
    return np.clip(y, -1.0, 1.0)


def write_click_wav(out: Path | str, **kwargs) -> Path:
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    y = render_click_track(**kwargs)
    wavfile.write(str(out), SR, (y * 32767).astype(np.int16))
    return out


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data/fixtures/click_120bpm.wav")
    print(write_click_wav(target))
