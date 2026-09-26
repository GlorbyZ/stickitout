"""Integration test with real MediaPipe on the synthetic paradiddle drummer
(scripts/make_test_video.py --drummer): coverage, cross-verification, hand
assignment and sticking, then schema validation of the full report.

Skipped where MediaPipe cannot run (no EGL/GL libraries) or when the photo or
models cannot be downloaded (offline).
"""
import json

import jsonschema
import pytest

from app import jobs, pipeline


@pytest.fixture(scope="module")
def drummer_video(tmp_path_factory):
    from scripts.make_test_video import make_video
    try:
        return make_video(tmp_path_factory.mktemp("drummer") / "drummer60.mp4", fps=60, seconds=8.0, bpm=100.0, drummer=True)
    except OSError as exc:
        pytest.skip(f"could not fetch the test photo: {exc}")


def test_drummer_end_to_end(drummer_video, job_store, report_schema):
    job_id = jobs.create(drummer_video.name)
    params = {"rudiment": "Single Paradiddle", "target_bpm": 100.0, "av_offset_ms": 0.0, "verify_window_ms": 40.0}
    pipeline.run(job_id, drummer_video, params)
    job = jobs.read(job_id)
    assert job["status"] == "done", job["error"]
    report = jobs.read_report(job_id)
    if report["video"]["degraded"] and "failed" in (report["video"]["degraded_reason"] or ""):
        pytest.skip(f"MediaPipe unavailable here: {report['video']['degraded_reason']}")
    jsonschema.Draft202012Validator(report_schema).validate(json.loads(json.dumps(report)))

    assert report["video"]["landmark_coverage"] > 0.85
    v = report["verification"]
    assert v["agreement_pct"] >= 85 and v["verified_stroke_count"] >= 45
    assert abs(v["verified_tempo_bpm"] - 100.0) < 1.0
    assert abs(v["median_av_delta_ms"]) <= 20
    assert report["sticking"]["checked"] and report["sticking"]["sticking_accuracy_pct"] >= 90
    assert report["scores"]["form"] is not None and report["scores"]["verified"] >= 85
