"""API contract and spec 10.3 schema test on a real end-to-end run.

A synthetic 60 fps video (test pattern + click) goes through POST /api/analyze;
form degrades because there is no drummer in the picture, audio results must
still come back, and the report must validate against the schema. A 30 fps clip
must be rejected with a clear error.
"""
import jsonschema
import pytest
from fastapi.testclient import TestClient
from scripts.make_test_video import make_video

from app.main import app


@pytest.fixture
def client(job_store):
    return TestClient(app)


def post_video(client, path, **fields):
    with path.open("rb") as fh:
        return client.post("/api/analyze", files={"video": (path.name, fh, "video/mp4")}, data=fields)


def test_60fps_end_to_end_report_validates(client, tmp_path, report_schema):
    video = make_video(tmp_path / "synthetic60.mp4", fps=60, seconds=6.0, bpm=100.0)
    res = post_video(client, video, rudiment="Single Paradiddle")
    assert res.status_code == 202, res.text
    job_id = res.json()["job_id"]

    status = client.get(f"/api/jobs/{job_id}").json()       # TestClient runs background tasks before returning
    assert status["status"] == "done", status
    report = client.get(f"/api/results/{job_id}").json()
    jsonschema.Draft202012Validator(report_schema).validate(report)

    assert abs(report["audio"]["tempo_bpm"] - 100.0) <= 1.0
    assert report["audio"]["onset_count"] > 0
    assert report["video"]["degraded"] is True and report["video"]["degraded_reason"]
    assert report["scores"]["form"] is None and report["scores"]["form_null_reason"]
    assert report["scores"]["timing"] is not None and report["scores"]["overall"] is not None
    assert report["verification"]["verified_stroke_count"] == 0
    assert report["sticking"]["checked"] is False


def test_30fps_rejected_with_clear_error(client, tmp_path):
    video = make_video(tmp_path / "synthetic30.mp4", fps=30, seconds=3.0)
    res = post_video(client, video)
    assert res.status_code == 422
    msg = res.json()["error"]
    assert "30 fps" in msg and "60 fps" in msg


def test_error_contracts(client, tmp_path):
    assert client.get("/api/jobs/" + "0" * 32).status_code == 404
    assert client.get("/api/results/not-a-job").json() == {"error": "Job not found."}
    bad = tmp_path / "notes.txt"
    bad.write_text("hello")
    assert post_video(client, bad).status_code == 415
    video = make_video(tmp_path / "v.mp4", fps=60, seconds=2.0)
    res = post_video(client, video, verify_window_ms="900")
    assert res.status_code == 422 and "verify_window_ms" in res.json()["error"]
