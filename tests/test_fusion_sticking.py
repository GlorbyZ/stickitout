"""Cross-verification, hand assignment and the paradiddle sticking check on
synthetic wrist tracks (no camera needed), plus schema validation of the
resulting non-degraded report."""
import jsonschema
import numpy as np
import pytest
from scripts.make_click_test import write_click_wav

from app.audio import analyze_audio
from app.fusion import effective_verify_window
from app.media import VideoInfo
from app.pipeline import analyse, build_report
from app.sticking import PATTERN, check_sticking
from app.video import Tracks, session_metrics

FPS = 60.0
SHOULDER_PX = 200.0


def synthetic_tracks(strikes, duration, fps=FPS):
    """Wrist dips (downward = +y) at each (time, hand) strike on a 60 fps (or given fps) timeline."""
    t = np.arange(0, duration, 1 / fps)
    y = {"L": np.full_like(t, 400.0), "R": np.full_like(t, 400.0)}
    for ts, hand in strikes:
        y[hand] += 40.0 * np.exp(-(((t - ts) / 0.025) ** 2))
    elbow_drop = {h: (y[h] - 400.0) * 0.5 for h in "LR"}
    n = len(t)
    pts = {
        "ls": np.column_stack([np.full(n, 400.0), np.full(n, 200.0)]),
        "rs": np.column_stack([np.full(n, 200.0), np.full(n, 200.0)]),
        "le": np.column_stack([np.full(n, 430.0), 300.0 + elbow_drop["L"]]),
        "re": np.column_stack([np.full(n, 170.0), 300.0 + elbow_drop["R"]]),
        "lw": np.column_stack([np.full(n, 380.0), y["L"]]),
        "rw": np.column_stack([np.full(n, 220.0), y["R"]]),
    }
    return Tracks(t=t, pts=pts, hands={"L": [], "R": []}, scale=SHOULDER_PX, total_frames=n)


@pytest.fixture(scope="module")
def paradiddle_audio(tmp_path_factory):
    wav = write_click_wav(tmp_path_factory.mktemp("pd") / "pd.wav", bpm=100.0, duration_s=12.0, per_beat=4)
    return analyze_audio(wav)


def test_verification_and_sticking(paradiddle_audio, report_schema):
    onsets = [o["t"] for o in paradiddle_audio["onsets"]]
    hands = [PATTERN[i % 8] for i in range(len(onsets))]
    strikes = [(t, h) for i, (t, h) in enumerate(zip(onsets, hands)) if i != 20]   # onset 20 has no visible strike
    strikes.append((onsets[-1] + 0.5, "L"))                                         # a strike with no sound
    tracks = synthetic_tracks(strikes, onsets[-1] + 1.0)
    video = session_metrics(tracks)
    params = {"rudiment": "Single Paradiddle", "target_bpm": 100.0, "av_offset_ms": 0.0, "verify_window_ms": 40.0}
    out = analyse(paradiddle_audio, tracks, video, params)

    v = out["verification"]
    assert v["unverified_onsets"] == 1
    assert v["video_only_strikes"] == 1
    assert v["verified_stroke_count"] == len(onsets) - 1
    assert v["agreement_pct"] > 95
    assert abs(v["verified_tempo_bpm"] - 100.0) < 1.0
    assert out["strokes"][20]["verification"] == "unverified"

    assigned = [s["hand"] for s in out["strokes"]]
    assert sum(a == h for a, h in zip(assigned, hands)) >= len(hands) - 2
    assert out["sticking"]["checked"] and out["sticking"]["sticking_accuracy_pct"] >= 97
    assert out["scores"]["verified"] > 95 and out["scores"]["form"] is not None

    info = VideoInfo(60.0, 60.0, 12.0, 720, 1920, 1080, True, "mov,mp4,m4a,3gp,3g2,mj2")
    report = build_report("0" * 32, "2026-09-26T19:00:00+00:00", "synthetic.mp4", info, params, paradiddle_audio, out)
    jsonschema.Draft202012Validator(report_schema).validate(report)
    assert report["quality"]["low_fps"] is False and v["window_ms"] == 40.0 and not v["window_widened"]


def test_verify_window_widens_only_under_50fps():
    assert effective_verify_window(40.0, 60.0) == 40.0          # 60 fps unchanged
    assert effective_verify_window(40.0, 59.94) == 40.0
    assert effective_verify_window(40.0, 50.0) == 40.0
    assert effective_verify_window(40.0, 30.0) == 60.0          # 1.75 frames = 58.3 ms, floor 60
    assert effective_verify_window(40.0, 29.5) == 60.0
    assert 72 <= effective_verify_window(40.0, 24.0) <= 73.5    # 1.75 frames at 24 fps
    assert effective_verify_window(100.0, 30.0) == 100.0        # a wider requested window is kept
    assert effective_verify_window(40.0, None) == 40.0


def test_30fps_hits_between_frames_still_verified(paradiddle_audio, report_schema):
    """At 30 fps the wrist low point snaps to the nearest frame (up to 17 ms away), so a strike
    about 42 ms from the sound can show up anywhere from about 25 to 59 ms away. Those must
    verify with the widened 60 ms window; many of them fail the 40 ms window."""
    onsets = [o["t"] for o in paradiddle_audio["onsets"]]
    hands = [PATTERN[i % 8] for i in range(len(onsets))]
    shift = [0.042 if i % 3 == 0 else (-0.042 if i % 3 == 1 else 0.02) for i in range(len(onsets))]
    strikes = [(t + d, h) for t, h, d in zip(onsets, hands, shift)]
    tracks = synthetic_tracks(strikes, onsets[-1] + 1.0, fps=30.0)
    video = session_metrics(tracks)
    params = {"rudiment": "Single Paradiddle", "target_bpm": 100.0, "av_offset_ms": 0.0, "verify_window_ms": 40.0}

    narrow = analyse(paradiddle_audio, tracks, video, params)                # no fps: old 40 ms behaviour
    wide = analyse(paradiddle_audio, tracks, video, params, fps=30.0)
    assert narrow["verification"]["window_ms"] == 40.0
    assert wide["verification"]["window_ms"] == 60.0 and wide["verification"]["window_widened"]
    assert wide["verification"]["verified_stroke_count"] > narrow["verification"]["verified_stroke_count"]
    assert wide["verification"]["agreement_pct"] >= 90

    info = VideoInfo(30.0, 30.0, 12.0, 360, 1920, 1080, True, "mov,mp4,m4a,3gp,3g2,mj2")
    report = build_report("1" * 32, "2026-09-26T19:00:00+00:00", "phone30.mp4", info, params, paradiddle_audio, wide)
    jsonschema.Draft202012Validator(report_schema).validate(report)
    assert report["quality"]["low_fps"] is True and report["quality"]["verify_window_ms"] == 60.0


def test_sticking_breaks_and_resync():
    seq = list("RLRRLRLL" * 3)
    seq[6] = "R"                       # one wrong hand (pattern has L here)
    del seq[12]                        # one dropped stroke
    strokes = [{"t": i * 0.15, "hand": h} for i, h in enumerate(seq)]
    res = check_sticking(strokes, "Single Paradiddle")
    assert res["checked"]
    assert res["wrong_hand"] >= 1
    assert any(b["kind"] == "wrong_hand" and b["stroke_index"] == 6 for b in res["breaks"])
    assert res["sticking_accuracy_pct"] >= 85


def test_sticking_left_lead_and_other_rudiments():
    strokes = [{"t": i * 0.15, "hand": h} for i, h in enumerate("LRLLRLRR" * 2)]
    res = check_sticking(strokes, "single paradiddle")
    assert res["sticking_accuracy_pct"] == 100.0 and res["leading_hand"] == "L"
    assert check_sticking(strokes, "Double Paradiddle")["checked"] is False
