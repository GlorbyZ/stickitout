"""Confidence gate: weak video does not produce a Verified number or a sticking claim."""
from app import confidence, scoring
from app.coaching import coach


def _report(coverage=1.0, agreement=90.0, seen=40, degraded=False, low_fps=False, checked=True):
    strokes = [{"verification": "verified", "hand": "R", "t": i * 0.1} for i in range(seen)]
    return {
        "source": {"fps": 30.0 if low_fps else 60.0},
        "quality": {"low_fps": low_fps},
        "video": {"degraded": degraded, "degraded_reason": "No pose." if degraded else None,
                  "landmark_coverage": coverage},
        "verification": {"agreement_pct": agreement, "verified_stroke_count": seen},
        "sticking": {"checked": checked, "strokes_checked": seen, "sticking_accuracy_pct": 95,
                     "wrong_hand": 0, "resyncs": 0, "pattern": "RLRR LRLL", "breaks": []},
        "strokes": strokes,
        "scores": scoring.score_report(
            {"timing": {"mean_abs_error_ms": 4}, "ioi": {"cv": 0.05},
             "dynamics": {"dynamics_evenness": 0.9}, "target_bpm": None},
            {"degraded": degraded, "form": {}},
            [],
            {"agreement_pct": agreement},
        ),
    }


def test_weak_coverage_hides_verified_and_has_no_em_dash():
    report = _report(coverage=0.55, agreement=22.4, seen=10)
    gate = confidence.assess(report)
    scored = scoring.gate_verified(report["scores"], gate)
    assert gate["video"] == "weak"
    assert gate["show_verified"] is False and gate["show_sticking"] is False
    assert scored["verified"] is None
    assert "—" not in gate["message"] and "—" not in gate["hint"]
    assert "audio" in gate["message"]


def test_good_video_keeps_the_verified_number():
    report = _report()
    gate = confidence.assess(report)
    scored = scoring.gate_verified(report["scores"], gate)
    assert gate["video"] == "good" and gate["show_verified"] is True and gate["show_sticking"] is True
    assert scored["verified"] == report["scores"]["verified"]


def test_degraded_video_is_none_and_coaching_skips_hands():
    report = _report(degraded=True, coverage=0, agreement=0, seen=0)
    report["audio"] = {"onsets": [{"t": i * 0.25, "grid_index": i, "velocity": 1} for i in range(20)],
                       "grid": {"subdivision": 4, "step_ms": 250}, "tempo_bpm": 60}
    report["strokes"] = [{"t": i * 0.25, "hand": "R"} for i in range(20)]
    report["confidence"] = confidence.assess(report)
    assert report["confidence"]["video"] == "none"
    result = coach(report)
    assert not any(f.get("hand") for f in result["findings"])
    assert "sticking" not in {f["id"] for f in result["findings"]}
