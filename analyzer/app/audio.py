"""Module 1: audio analysis (spec section 4).

Input is the mono 44.1 kHz WAV extracted from the member's video. Produces
onsets (aubio), tempo and a subdivision grid (librosa beat tracking, refined by
a least-squares fit of the onsets to the grid), per-onset timing error and
velocity, inter-onset statistics, rolling tempo, and a small waveform summary
for the dashboard.

Grid note: the spec asks for a 16th-note grid, and its synthetic test expects
720 onsets from a 60 s, 120 BPM click (6 per beat). The grid subdivision is
therefore chosen from the inter-onset intervals: 4 per beat (16ths) by default,
6 per beat (16th-note triplets) when onsets clearly arrive 6 to a beat.
"""
from __future__ import annotations

from pathlib import Path

import aubio
import librosa
import numpy as np
from scipy.io import wavfile

from . import tuning

SR = 44100
# Onset method, sensitivity (threshold), silence gate, minimum stroke spacing (min_ioi_ms,
# default 40 ms; the fastest real strokes are about 60 ms apart) and the room-noise guard
# (min_rel_velocity, default 5% of the loudest hit) are tuning settings: see app/tuning.py.
ONSET_FALLBACK = "hfc"          # used when the main onset method finds almost nothing
ONSET_WIN = 1024
ONSET_HOP = 128                 # 2.9 ms resolution at 44.1 kHz
ENV_HOP = 256
VELOCITY_WINDOW_S = 0.030
ROLL_WINDOW_S = 4.0
ROLL_HOP_S = 1.0
SUSTAIN_S = 10.0
HIST_EDGES_MS = list(range(-50, 55, 5))
TEMPO_MIN, TEMPO_MAX = 40.0, 260.0
WAVEFORM_POINTS = 1500


def load_wav(path: Path) -> tuple[np.ndarray, int]:
    """Read a WAV as mono float32 at 44.1 kHz."""
    sr, data = wavfile.read(str(path))
    y = data.astype(np.float32)
    if data.dtype.kind in "iu":
        y /= float(np.iinfo(data.dtype).max)
    if y.ndim > 1:
        y = y.mean(axis=1)
    if sr != SR:
        y = librosa.resample(y, orig_sr=sr, target_sr=SR)
    return y.astype(np.float32), SR


def detect_onsets(y: np.ndarray, sr: int, method: str | None = None) -> list[dict]:
    """aubio onset detection. Returns [{t, strength}] with strength 0-1 of the session max."""
    tune = tuning.current()
    det = aubio.onset(method or tune.onset_method, ONSET_WIN, ONSET_HOP, sr)
    det.set_threshold(float(tune.onset_threshold))
    det.set_silence(float(tune.onset_silence_db))
    det.set_minioi_ms(float(tune.min_ioi_ms))
    padded = np.concatenate([y, np.zeros(ONSET_HOP, dtype=np.float32)])
    desc, times = [], []
    for start in range(0, len(y), ONSET_HOP):
        frame = padded[start:start + ONSET_HOP]
        if det(frame)[0]:
            times.append(det.get_last_s())
        desc.append(det.get_descriptor())
    desc = np.asarray(desc)
    onsets = []
    for t in times:
        i = int(round(t * sr / ONSET_HOP))
        onsets.append({"t": float(t), "strength": float(desc[max(0, i - 2):i + 6].max(initial=0.0))})
    peak = max((o["strength"] for o in onsets), default=0.0)
    for o in onsets:
        o["strength"] = round(o["strength"] / peak, 4) if peak > 0 else 0.0
    return onsets


def onset_velocities(y: np.ndarray, sr: int, times: list[float]) -> np.ndarray:
    """RMS in the 30 ms after each onset, normalised 0-1 to the session max."""
    n = int(VELOCITY_WINDOW_S * sr)
    rms = np.array([
        float(np.sqrt(np.mean(np.square(y[int(t * sr):int(t * sr) + n])))) if int(t * sr) < len(y) else 0.0
        for t in times
    ])
    return rms / rms.max() if rms.size and rms.max() > 0 else rms


def estimate_tempo(y: np.ndarray, sr: int) -> tuple[float, list[float]]:
    """librosa beat tracking on the onset envelope, clamped to 40-260 BPM."""
    env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=ENV_HOP)
    tempo, beats = librosa.beat.beat_track(onset_envelope=env, sr=sr, hop_length=ENV_HOP, units="time")
    bpm = float(np.atleast_1d(tempo)[0]) if np.size(tempo) else 0.0
    return float(np.clip(bpm, TEMPO_MIN, TEMPO_MAX)) if bpm > 0 else 0.0, [float(b) for b in beats]


def choose_subdivision(times: np.ndarray, beat_period: float) -> int:
    """4 (16ths) unless the typical gap is a third or sixth of a beat."""
    if len(times) < 3:
        return 4
    ratio = beat_period / float(np.median(np.diff(times)))
    return 6 if int(round(ratio)) in (3, 6) else 4


def grid_indices(times: np.ndarray, step: float) -> np.ndarray:
    """Integer grid index per onset, counted from the first onset by local gaps."""
    k = [0]
    for gap in np.diff(times):
        k.append(k[-1] + max(1, int(round(gap / step))))
    return np.asarray(k)


def steady_beat(beat_times: list[float]) -> tuple[float, float] | None:
    """(first beat, period in seconds) when the beats are a metronome, not the player's drift.

    A click stays within about 2 percent. The player's own hits are not used to move the tempo.
    """
    beats = np.asarray(beat_times, dtype=float)
    if len(beats) < 5:
        return None
    gaps = np.diff(beats)
    gaps = gaps[gaps > 0.05]
    if len(gaps) < 4:
        return None
    if float(np.std(gaps) / np.mean(gaps)) > 0.02:
        return None
    return float(beats[0]), float(np.median(gaps))


def fit_grid(times: np.ndarray, idx: np.ndarray) -> tuple[float, float]:
    """Least-squares fit t = t0 + step * k. Returns (t0, step)."""
    step, t0 = np.polyfit(idx.astype(float), times, 1)
    return float(t0), float(step)


def rolling_tempo(times: np.ndarray, idx: np.ndarray, subdivision: int) -> list[dict]:
    """Tempo re-estimated in 4 s windows (1 s hop) from the grid fit inside each window."""
    out = []
    if len(times) < 4:
        return out
    start = float(times[0])
    while start + ROLL_WINDOW_S <= times[-1] + 1e-9:
        sel = (times >= start) & (times < start + ROLL_WINDOW_S)
        bpm = None
        if sel.sum() >= 4 and len(set(idx[sel])) >= 3:
            _, step = fit_grid(times[sel], idx[sel])
            if step > 0:
                bpm = round(60.0 / (step * subdivision), 2)
        out.append({"t_start": round(start, 3), "t_end": round(start + ROLL_WINDOW_S, 3), "bpm": bpm})
        start += ROLL_HOP_S
    return out


def top_sustained(rolling: list[dict]) -> float | None:
    """Highest BPM held (every window at or above it) for at least 10 seconds."""
    need = int(np.ceil((SUSTAIN_S - ROLL_WINDOW_S) / ROLL_HOP_S)) + 1
    best = None
    for i in range(0, len(rolling) - need + 1):
        run = [w["bpm"] for w in rolling[i:i + need]]
        if all(b is not None for b in run):
            best = max(best or 0.0, min(run))
    return round(best, 2) if best is not None else None


def pattern_guess(times: np.ndarray, subdivision: int) -> str:
    """Informational only: even strokes versus 2:1 groupings. Never raises."""
    if len(times) < 6:
        return "not enough strokes to guess"
    ioi = np.diff(times)
    ratios = ioi[1:] / np.maximum(ioi[:-1], 1e-6)
    even = float(np.mean((ratios > 0.8) & (ratios < 1.25)))
    two_one = float(np.mean(((ratios > 1.6) & (ratios < 2.5)) | ((ratios > 0.4) & (ratios < 0.625))))
    if even >= 0.75:
        return "even 16ths" if subdivision == 4 else "even 16th-note triplets"
    if two_one >= 0.3:
        return "grouped doubles (2:1 gaps, doubles or paradiddle groupings)"
    return "irregular spacing"


def timing_stats(errors_ms: np.ndarray) -> dict:
    if errors_ms.size == 0:
        return {"mean_abs_error_ms": None, "std_error_ms": None, "max_abs_error_ms": None,
                "histogram": {"bin_edges_ms": HIST_EDGES_MS, "counts": [0] * (len(HIST_EDGES_MS) - 1),
                              "below": 0, "above": 0}}
    counts, _ = np.histogram(errors_ms, bins=HIST_EDGES_MS)
    return {
        "mean_abs_error_ms": round(float(np.mean(np.abs(errors_ms))), 3),
        "std_error_ms": round(float(np.std(errors_ms)), 3),
        "max_abs_error_ms": round(float(np.max(np.abs(errors_ms))), 3),
        "histogram": {"bin_edges_ms": HIST_EDGES_MS, "counts": [int(c) for c in counts],
                      "below": int(np.sum(errors_ms < HIST_EDGES_MS[0])),
                      "above": int(np.sum(errors_ms >= HIST_EDGES_MS[-1]))},
    }


def waveform_summary(y: np.ndarray, sr: int) -> dict:
    bins = np.array_split(np.abs(y), min(WAVEFORM_POINTS, max(1, len(y))))
    peaks = [round(float(b.max(initial=0.0)), 4) for b in bins]
    top = max(peaks, default=0.0) or 1.0
    return {"duration_s": round(len(y) / sr, 3), "peaks": [round(p / top, 4) for p in peaks]}


def analyze_audio(wav_path: Path, target_bpm: float | None = None, subdivision: int | None = None) -> dict:
    """Run the full audio module on a WAV file and return the report's audio section."""
    y, sr = load_wav(wav_path)
    tune = tuning.current()
    method = tune.onset_method
    onsets = detect_onsets(y, sr, method)
    if len(onsets) < 4 and np.max(np.abs(y), initial=0.0) > 0.01:
        method = ONSET_FALLBACK
        onsets = detect_onsets(y, sr, method)

    times = np.array([o["t"] for o in onsets])
    heard = y
    raw_bpm, beat_times = estimate_tempo(y, sr)
    locked = steady_beat(beat_times)
    if locked is not None:
        from .drums import drum_stem, has_drums_besides_click
        if has_drums_besides_click(y, sr, times):
            stem = drum_stem(y, sr)
            if stem is not None:
                drum_onsets = detect_onsets(stem, sr, method)
                if len(drum_onsets) >= 4:
                    onsets = drum_onsets
                    times = np.array([o["t"] for o in onsets])
                    heard = stem
    vel = onset_velocities(heard, sr, list(times))
    keep = vel >= tune.min_rel_velocity
    onsets = [o for o, k in zip(onsets, keep) if k]
    times, vel = times[keep], vel[keep]
    if vel.size and vel.max() > 0:
        vel = vel / vel.max()
    asked = subdivision if subdivision in (4, 6) else None
    tempo_bpm, subdivision, grid, errors = None, asked or 4, None, np.array([])
    idx = np.zeros(len(times), dtype=int)
    locked = steady_beat(beat_times)
    if locked and heard is not y and len(times) >= 4:
        t0, period = locked
        subdivision = asked or choose_subdivision(times, period)
        step = period / subdivision
        idx = np.round((times - t0) / step).astype(int)
        errors = (times - (t0 + step * idx)) * 1000.0
        tempo_bpm = round(float(np.clip(60.0 / period, TEMPO_MIN, TEMPO_MAX)), 2)
        grid = {"subdivision": subdivision, "step_ms": round(step * 1000, 4), "t0": round(t0, 5),
                "anchor_t": round(t0, 5), "metronome": True}
    elif len(times) >= 4 and raw_bpm > 0:
        subdivision = asked or choose_subdivision(times, 60.0 / raw_bpm)
        idx = grid_indices(times, 60.0 / raw_bpm / subdivision)
        t0, step = fit_grid(times, idx)
        tempo_bpm = round(float(np.clip(60.0 / (step * subdivision), TEMPO_MIN, TEMPO_MAX)), 2)
        errors = (times - (t0 + step * np.round((times - t0) / step))) * 1000.0
        grid = {"subdivision": subdivision, "step_ms": round(step * 1000, 4), "t0": round(t0, 5),
                "anchor_t": round(float(times[np.argmax(vel >= 0.5)]), 5), "metronome": False}
    elif raw_bpm > 0:
        tempo_bpm = round(raw_bpm, 2)

    for i, o in enumerate(onsets):
        o["velocity"] = round(float(vel[i]), 4)
        o["timing_error_ms"] = round(float(errors[i]), 3) if errors.size else None
        o["grid_index"] = int(idx[i])
        o["t"] = round(o["t"], 5)

    ioi = np.diff(times)
    if grid and grid.get("metronome") and tempo_bpm:
        rolling = []
        start = 0.0
        dur = len(y) / sr
        while start + ROLL_WINDOW_S <= dur + 1e-9:
            rolling.append({"t_start": round(start, 3), "t_end": round(start + ROLL_WINDOW_S, 3), "bpm": tempo_bpm})
            start += ROLL_HOP_S
    else:
        rolling = rolling_tempo(times, idx, subdivision) if grid else []
    evenness = float(np.clip(1.0 - np.std(vel) / np.mean(vel), 0.0, 1.0)) if vel.size and np.mean(vel) > 0 else None
    return {
        "sample_rate": sr,
        "duration_s": round(len(y) / sr, 3),
        "onset_method": method,
        "tempo_bpm": tempo_bpm,
        "tempo_bpm_beat_track": round(raw_bpm, 2) if raw_bpm else None,
        "target_bpm": target_bpm,
        "beat_times": [round(b, 4) for b in beat_times],
        "grid": grid,
        "top_sustained_bpm": top_sustained(rolling),
        "rolling_bpm": rolling,
        "onsets": onsets,
        "onset_count": len(onsets),
        "ioi": {"mean_ms": round(float(ioi.mean() * 1000), 3) if ioi.size else None,
                "std_ms": round(float(ioi.std() * 1000), 3) if ioi.size else None,
                "cv": round(float(ioi.std() / ioi.mean()), 5) if ioi.size and ioi.mean() > 0 else None},
        "timing": timing_stats(errors),
        "dynamics": {"dynamics_evenness": round(evenness, 4) if evenness is not None else None,
                     "velocity_mean": round(float(vel.mean()), 4) if vel.size else None,
                     "velocity_std": round(float(vel.std()), 4) if vel.size else None},
        "pattern_guess": pattern_guess(times, subdivision),
        "waveform": waveform_summary(y, sr),
    }
