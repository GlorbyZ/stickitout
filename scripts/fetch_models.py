"""Download the MediaPipe Tasks models (pose_landmarker_full, hand_landmarker) into ./models.

The pipeline also downloads them on first use; run this once ahead of time for offline use.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.video import ensure_models  # noqa: E402

if __name__ == "__main__":
    for name, path in ensure_models().items():
        print(f"{name}: {path} ({path.stat().st_size / 1e6:.1f} MB)")
