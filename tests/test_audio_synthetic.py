"""Spec 10.1: synthetic 120 BPM click, 60 s, 720 onsets."""
from scripts.make_click_test import write_click_wav

from app.audio import analyze_audio


def test_click_120_bpm(tmp_path):
    audio = analyze_audio(write_click_wav(tmp_path / "click_120bpm.wav"))
    assert abs(audio["tempo_bpm"] - 120.0) <= 1.0
    assert audio["timing"]["mean_abs_error_ms"] < 5.0
    assert abs(audio["onset_count"] - 720) <= 0.02 * 720
    assert audio["onset_method"] == "specdiff"
