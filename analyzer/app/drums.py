"""Split a pad recording into the drum stem and the click.

Demucs (htdemucs) is the separator. It is loaded from SIO_PACKAGES when that
folder exists, so the model and PyTorch can live off the small system drive.
A pure click, with no dull snare onsets, is left alone.
"""
from __future__ import annotations

import os
import sys

import numpy as np
from scipy.signal import butter, sosfilt

_MODEL = None
_PACKAGES = os.environ.get("SIO_PACKAGES", r"D:\sio-packages")
if _PACKAGES and _PACKAGES not in sys.path and os.path.isdir(_PACKAGES):
    sys.path.insert(0, _PACKAGES)


def enabled() -> bool:
    return os.environ.get("SIO_DRUMSEP", "1") != "0"


def _band_rms(sig: np.ndarray, sr: int, t: float) -> float:
    a = max(0, int(t * sr))
    n = int(0.02 * sr)
    w = sig[a:a + n]
    if len(w) < 8:
        return 0.0
    return float(np.sqrt(np.mean(w * w)))


def has_drums_besides_click(y: np.ndarray, sr: int, onset_times: np.ndarray) -> bool:
    """True when several onsets are dull snare hits rather than the bright click."""
    if len(onset_times) < 8:
        return False
    hi = sosfilt(butter(4, 3000, btype="highpass", fs=sr, output="sos"), y)
    lo = sosfilt(butter(4, 800, btype="lowpass", fs=sr, output="sos"), y)
    dull = 0
    for t in onset_times:
        ratio = _band_rms(hi, sr, float(t)) / (_band_rms(lo, sr, float(t)) + 1e-9)
        if ratio < 0.08:
            dull += 1
    return dull >= 4


def drum_stem(y: np.ndarray, sr: int) -> np.ndarray | None:
    """Mono drum stem at the same rate as y, or None if separation cannot run."""
    global _MODEL
    if not enabled():
        return None
    os.environ.setdefault("TORCH_HOME", "/data/models" if os.name != "nt" else r"D:\sio-models")
    try:
        import torch
        from demucs.apply import apply_model
        from demucs.pretrained import get_model
    except Exception:
        return None
    try:
        if _MODEL is None:
            _MODEL = get_model("htdemucs")
            _MODEL.cpu().eval()
        model = _MODEL
        wav = torch.from_numpy(np.ascontiguousarray(y, dtype=np.float32))
        if wav.dim() == 1:
            wav = wav.repeat(model.audio_channels, 1)
        ref = wav.mean(0)
        scale = float(ref.std()) or 1e-8
        mix = (wav - ref.mean()) / scale
        with torch.no_grad():
            sources = apply_model(model, mix[None], device="cpu", shifts=0, split=True,
                                   overlap=0.25, progress=False)[0]
        drums = sources[model.sources.index("drums")].mean(0)
        drums = drums * scale + float(ref.mean())
        out = drums.detach().cpu().numpy().astype(np.float32)
        if float(np.sqrt(np.mean(out * out))) < 0.01 * float(np.sqrt(np.mean(y * y)) + 1e-9):
            return None
        return out
    except Exception:
        return None
