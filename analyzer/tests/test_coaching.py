"""Coaching engine (app/coaching.py) on synthetic reports with known problems.

make_report() builds only the report fields coaching reads: audio onsets on a 16th-note grid (with
optional tempo drift, per-hand and per-position timing offsets, jitter and velocities), strokes with
hands and wrist travel, the real sticking check, and the video, verification and quality sections.
"""
import json

import jsonschema
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import coaching, jobs, tuning
from app.sticking import PATTERN, check_sticking


def make_report(bpm=100.0, end_bpm=None, seconds=12.0, offsets=None, jitter_ms=2.0, vel=None, heights=(0.08, 0.08),
                fps=60.0, coverage=1.0, verified=90.0, wrong_hands=(), rudiment="Single Paradiddle", target=None, seed=1):
    rng = np.random.default_rng(seed)
    sub = 4
    step0 = 60.0 / bpm / sub
    step1 = 60.0 / (end_bpm or bpm) / sub
    n = int(seconds / step0)
    t, cur = [], 0.5
    for i in range(n):
        t.append(cur)
        cur += step0 + (step1 - step0) * i / max(1, n - 1)
    onsets, strokes = [], []
    for i, ti in enumerate(t):
        hand = PATTERN[i % 8]
        played = ("L" if hand == "R" else "R") if i in wrong_hands else hand
        pos = i % 4
        off = offsets(i, played, pos) if offsets else 0.0
        ts = ti + (off + rng.normal(0, jitter_ms)) / 1000.0
        v = vel(i, played, pos) if vel else 0.8
        onsets.append({"t": round(ts, 5), "grid_index": i, "velocity": round(float(v), 4), "strength": 1.0, "timing_error_ms": 0.0})
        strokes.append({"t": round(ts, 5), "hand": played, "timing_error_ms": 0.0, "velocity": round(float(v), 4),
                        "stroke_height": heights[0] if played == "L" else heights[1], "arm_vs_wrist_index": None,
                        "elbow_angle_deg": None, "verification": "verified", "av_delta_ms": 0.0, "strike_hand": played})
    st = check_sticking(strokes, rudiment)
    for s in strokes:
        s.setdefault("expected_hand", None)
    per_hand = {h: {"strokes": sum(1 for s in strokes if s["hand"] == h),
                    "stroke_height_mean": heights[0] if h == "L" else heights[1]} for h in ("L", "R")}
    return {
        "job_id": "0" * 32, "source": {"fps": fps, "duration_s": seconds},
        "quality": {"low_fps": fps < 50, "measured_fps": fps},
        "params": {"rudiment": rudiment, "target_bpm": target},
        "audio": {"onsets": onsets, "onset_count": len(onsets), "tempo_bpm": round(bpm if not end_bpm else (bpm + end_bpm) / 2, 2),
                  "grid": {"subdivision": sub, "step_ms": step0 * 1000.0, "t0": t[0]}},
        "strokes": strokes, "sticking": st,
        "video": {"degraded": False, "landmark_coverage": coverage},
        "verification": {"agreement_pct": verified},
        "scores": {"per_hand": per_hand},
    }


def ids(c):
    return [f["id"] for f in c["findings"]]


def by_id(c, fid):
    return next(f for f in c["findings"] if f["id"] == fid)


def all_text(c):
    out = [c.get("focus") or "", c.get("message") or ""] + c["notes"]
    for f in c["findings"]:
        out += [f["title"], f["saw"], f["why"], f["focus"], f["drill"]["name"], f["drill"]["text"], f["caveat"] or ""]
        out += f["fix"] + [e["label"] for e in f["examples"]]
    for s in c["strengths"]:
        out += [s["title"], s["saw"]]
    return out


@pytest.fixture(scope="module")
def coaching_schema():
    from pathlib import Path
    return json.loads((Path(__file__).resolve().parent.parent / "schema" / "report.schema.json").read_text())["properties"]["coaching"]


def check_shape(c, schema, tempo):
    jsonschema.Draft202012Validator(schema).validate(c)
    for f in c["findings"]:
        assert f["drill"]["tempo_bpm"] % 10 == 0 and f["drill"]["tempo_bpm"] < tempo, f["drill"]
        assert 2 <= len(f["fix"]) <= 3
        assert len(f["examples"]) <= 3
        assert all(e["t"] >= 0 for e in f["examples"])
    assert 1 <= len(c["strengths"]) <= 2
    assert not any("\u2014" in s or "\u2013" in s for s in all_text(c)), "no em or en dashes in coaching copy"


def test_rushing_left_hand(coaching_schema):
    # Left hand 14 ms ahead of the right on every note.
    c = coaching.coach(make_report(offsets=lambda i, h, p: -14.0 if h == "L" else 0.0))
    check_shape(c, coaching_schema, 100)
    f = by_id(c, "timing_bias")
    assert f["hand"] == "L" and f["metric"]["kind"] == "hands"
    assert f["title"].startswith("Your left hand rushes") and "ahead of your right" in f["title"]
    assert "ms" not in f["title"] and "ms" not in f["saw"]
    assert 11 <= abs(f["metric"]["diff_ms"]) <= 17
    assert len(f["examples"]) == 3 and all(e["hand"] == "L" for e in f["examples"])
    assert c["findings"][0]["id"] == "timing_bias" and c["focus"].endswith(f["focus"])
    assert c["focus"].startswith("Single Paradiddle. ")
    assert any("Single paradiddle" in n for n in c["notes"])


def test_left_hand_rushes_offbeats():
    # Left hand early only on the e's and a's (paradiddle positions 1 and 3).
    c = coaching.coach(make_report(offsets=lambda i, h, p: -18.0 if h == "L" and p in (1, 3) else 0.0))
    f = by_id(c, "timing_bias")
    assert f["metric"]["kind"] == "position" and f["hand"] == "L" and f["metric"]["position"] == "ea"
    assert "left hand rushes the e's and a's" in f["title"]


def test_dragging_slows_down(coaching_schema):
    c = coaching.coach(make_report(bpm=120.0, end_bpm=106.0, seconds=14.0))
    check_shape(c, coaching_schema, 106)
    f = by_id(c, "tempo_drift")
    assert f["severity"] == "fix_first" and "slowed down" in f["title"]
    assert f["metric"]["change_bpm"] < -8
    assert f["drill"]["tempo_bpm"] <= 90            # slower than the slowest part of the take
    assert c["findings"][0]["id"] == "tempo_drift"
    assert "timing_spread" not in ids(c)             # drift is reported once, not again as uneven notes


def test_uneven_hands_volume_and_wrist_travel(coaching_schema):
    c = coaching.coach(make_report(vel=lambda i, h, p: 0.55 if h == "L" else 0.9, heights=(0.03, 0.09)))
    check_shape(c, coaching_schema, 100)
    vol, travel = by_id(c, "hand_volume"), by_id(c, "wrist_travel")
    assert vol["hand"] == "L" and "left hand plays about" in vol["title"]
    assert travel["hand"] == "L" and "about a third as much as your right" in travel["title"]
    assert "stick tips are not tracked" in travel["caveat"]


def test_clean_take_gives_strengths_and_no_scary_findings(coaching_schema):
    c = coaching.coach(make_report(bpm=100.0, jitter_ms=1.5))
    check_shape(c, coaching_schema, 1000)
    assert not [f for f in c["findings"] if f["severity"] in ("fix_first", "work_on")], c["findings"]
    got = [s["id"] for s in c["strengths"]]
    assert got[0] == "tight_timing" and got[1] in ("clean_sticking", "even_volume")   # two different areas
    assert c["focus"].startswith("Single Paradiddle. Everything we measured looks solid") and "110 BPM" in c["focus"]


def test_low_fps_widens_hand_thresholds_and_skips_wrists(coaching_schema):
    # 10 ms left-hand lead and a big wrist difference: reported at 60 fps, not at 30 fps.
    kw = dict(offsets=lambda i, h, p: -10.0 if h == "L" else 0.0, heights=(0.03, 0.09), end_bpm=112.0, seconds=14.0)
    hi, lo = coaching.coach(make_report(fps=60.0, **kw)), coaching.coach(make_report(fps=30.0, **kw))
    assert "wrist_travel" in ids(hi) and "wrist_travel" not in ids(lo)
    assert any("30 fps" in n for n in lo["notes"]) and lo["low_fps"] is True
    hb = [f for f in hi["findings"] if f["id"] == "timing_bias"]
    assert hb and hb[0]["metric"]["kind"] == "hands"
    assert not [f for f in lo["findings"] if f["id"] == "timing_bias" and f["metric"]["kind"] == "hands"]
    assert "tempo_drift" in ids(lo)                  # audio timing advice is not affected by the frame rate
    check_shape(lo, coaching_schema, 100)


def test_sticking_slips_and_hand_caveat():
    c = coaching.coach(make_report(wrong_hands=(10, 30, 50, 70, 90), verified=30.0))
    f = by_id(c, "sticking")
    assert f["severity"] in ("work_on", "polish") and "slipped" in f["title"] and "strokes" in f["title"]
    assert f["caveat"] and f["confidence"] == "medium"
    assert any("30%" in n for n in c["notes"])


def test_doubles_quieter_second_note():
    c = coaching.coach(make_report(vel=lambda i, h, p: 0.5 if p == 3 else 0.85))
    f = by_id(c, "double_volume")
    assert "second note of your doubles is about 4" in f["title"]


def test_accent_off_the_beat_is_a_hedged_finding():
    c = coaching.coach(make_report(vel=lambda i, h, p: 1.0 if p == 3 else 0.4))
    f = by_id(c, "accent_position")
    assert "a (the second note of the double)" in f["title"] and f["confidence"] == "medium"
    r = make_report(vel=lambda i, h, p: 1.0 if p == 0 else 0.4)
    assert "accent_position" not in ids(coaching.coach(r))
    _, strengths = coaching.dynamics(coaching._Take(r))
    assert "clear_accents" in {s["id"] for s in strengths}


def test_target_tempo():
    c = coaching.coach(make_report(bpm=100.0, target=120.0))
    f = by_id(c, "target_tempo")
    assert "20 BPM under your 120 BPM target" in f["title"]


def test_not_enough_hits():
    c = coaching.coach(make_report(seconds=1.5))
    assert c["status"] == "not_enough_data" and c["findings"] == [] and "at least 16" in c["message"]


def test_no_video_means_no_hand_advice():
    r = make_report(offsets=lambda i, h, p: -14.0 if h == "L" else 0.0, heights=(0.03, 0.09))
    r["video"]["degraded"] = True
    c = coaching.coach(r)
    assert not [f for f in c["findings"] if f["hand"]] and "sticking" not in ids(c)
    assert any("sound only" in n for n in c["notes"])


def test_drill_tempo_rounding():
    assert coaching.drill_tempo(129.1) == 100 and coaching.drill_tempo(151.4) == 120
    assert coaching.drill_tempo(45) == 40 and coaching.drill_tempo(52) == 40
    assert all(coaching.drill_tempo(b) % 10 == 0 and coaching.drill_tempo(b) < b for b in range(50, 260, 7))


def test_thresholds_are_tuning_settings():
    r = make_report(offsets=lambda i, h, p: -14.0 if h == "L" else 0.0)
    assert "timing_bias" in ids(coaching.coach(r))
    with tuning.override({"coach_hand_bias_ms": 30, "coach_position_bias_ms": 30}):
        assert "timing_bias" not in ids(coaching.coach(r))


def test_results_endpoint_and_backfill_add_coaching(job_store):
    from app.main import app
    from scripts.backfill_coaching import backfill
    job_id = jobs.create("old.mp4")
    report = make_report(end_bpm=112.0, seconds=14.0)
    report["job_id"] = job_id
    jobs.write_report(job_id, report)
    jobs.update(job_id, status="done")
    body = TestClient(app).get(f"/api/results/{job_id}").json()
    assert body["coaching"]["version"] == coaching.VERSION and "tempo_drift" in ids(body["coaching"])
    assert "coaching" not in jobs.read_report(job_id)            # computed on the fly, file untouched
    assert backfill([job_id], log=lambda m: None) == [job_id]
    assert jobs.read_report(job_id)["coaching"]["focus"] == body["coaching"]["focus"]
    assert backfill(None, log=lambda m: None) == []              # already current
    assert backfill(None, force=True, log=lambda m: None) == [job_id]
