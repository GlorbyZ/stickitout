"""API contract and spec 10.3 schema test on a real end-to-end run.

A synthetic 60 fps video (test pattern + click) goes through POST /api/analyze;
form degrades because there is no drummer in the picture, audio results must
still come back, and the report must validate against the schema. A 30 fps clip
is accepted with the low frame rate flag and a widened verify window; a clip
below MIN_FPS is rejected with a clear error.
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

    # 60 fps behaviour is unchanged: no flag, the requested 40 ms window is used as is.
    assert report["quality"]["low_fps"] is False and report["quality"]["message"] is None
    assert report["verification"]["window_ms"] == 40.0 and report["verification"]["window_widened"] is False


def test_30fps_accepted_with_low_fps_flag(client, tmp_path, report_schema):
    video = make_video(tmp_path / "synthetic30.mp4", fps=30, seconds=4.0, bpm=100.0)
    res = post_video(client, video, verify_window_ms="40")
    assert res.status_code == 202, res.text
    job_id = res.json()["job_id"]
    assert client.get(f"/api/jobs/{job_id}").json()["status"] == "done"
    report = client.get(f"/api/results/{job_id}").json()
    jsonschema.Draft202012Validator(report_schema).validate(report)

    assert 29 <= report["source"]["fps"] <= 31
    q = report["quality"]
    assert q["low_fps"] is True and q["full_accuracy_fps"] == 50
    assert q["message"].startswith("Recorded at 30 fps.") and "record at 60 fps" in q["message"]
    assert "\u2014" not in q["message"]
    assert report["params"]["verify_window_ms"] == 40.0                 # what was asked for
    assert report["verification"]["window_ms"] == 60.0                  # what was used
    assert report["verification"]["window_requested_ms"] == 40.0
    assert report["verification"]["window_widened"] is True and q["verify_window_ms"] == 60.0
    assert report["audio"]["onset_count"] > 0


def test_below_min_fps_rejected_with_clear_error(client, tmp_path, job_store):
    video = make_video(tmp_path / "synthetic15.mp4", fps=15, seconds=3.0)
    res = post_video(client, video)
    assert res.status_code == 422
    msg = res.json()["error"]
    assert "15 fps" in msg and "at least 24 fps" in msg and "60 fps" in msg
    assert not job_store.exists() or not any(job_store.iterdir())      # rejected upload is not kept


def test_low_fps_report_needs_message(report_schema):
    """Schema check: a low_fps report must carry the disclaimer; a normal one must not be widened."""
    quality = jsonschema.Draft202012Validator(report_schema["properties"]["quality"])
    good = {"low_fps": True, "measured_fps": 30.0, "min_fps": 23.5, "full_accuracy_fps": 50.0,
            "verify_window_ms": 60.0, "verify_window_widened": True, "message": "Recorded at 30 fps."}
    assert quality.is_valid(good)
    assert not quality.is_valid({**good, "message": None})
    assert not quality.is_valid({k: v for k, v in good.items() if k != "low_fps"})
    assert not quality.is_valid({**good, "low_fps": False})              # widened window without the flag
    assert quality.is_valid({**good, "low_fps": False, "verify_window_widened": False, "message": None,
                             "measured_fps": 60.0, "verify_window_ms": 40.0})
    assert "quality" in report_schema["required"]


def test_config_exposes_fps_limits(client):
    cfg = client.get("/api/config").json()
    assert cfg["min_fps"] == 23.5 and cfg["full_accuracy_fps"] == 50


def test_error_contracts(client, tmp_path):
    assert client.get("/api/jobs/" + "0" * 32).status_code == 404
    assert client.get("/api/results/not-a-job").json() == {"error": "Job not found."}
    bad = tmp_path / "notes.txt"
    bad.write_text("hello")
    assert post_video(client, bad).status_code == 415
    video = make_video(tmp_path / "v.mp4", fps=60, seconds=2.0)
    res = post_video(client, video, verify_window_ms="900")
    assert res.status_code == 422 and "verify_window_ms" in res.json()["error"]


def test_slow_motion_120fps_chunked_upload(client, tmp_path, report_schema):
    """A 120 fps clip sent in pieces through /api/uploads (the path big slow motion files take)."""
    video = make_video(tmp_path / "slowmo120.mp4", fps=120, seconds=4.0, bpm=100.0)
    data = video.read_bytes()
    res = client.post("/api/uploads", data={"filename": video.name, "size": str(len(data))})
    assert res.status_code == 201, res.text
    uid = res.json()["upload_id"]
    step = max(1, len(data) // 3)
    off = 0
    while off < len(data):
        r = client.put(f"/api/uploads/{uid}?offset={off}", content=data[off:off + step])
        assert r.status_code == 200, r.text
        off = r.json()["received"]
    assert off == len(data)
    bad = client.put(f"/api/uploads/{uid}?offset=0", content=b"x")          # out of order piece
    assert bad.status_code == 409 and bad.json()["received"] == len(data)
    res = client.post(f"/api/uploads/{uid}/finish", data={"rudiment": "Single Paradiddle"})
    assert res.status_code == 202, res.text
    body = res.json()
    assert body["job_id"] == uid and body["slow_motion"] is True and abs(body["fps"] - 120) < 1
    assert client.get(f"/api/jobs/{uid}").json()["status"] == "done"
    report = client.get(f"/api/results/{uid}").json()
    jsonschema.Draft202012Validator(report_schema).validate(report)
    assert abs(report["source"]["fps"] - 120) < 1 and report["quality"]["low_fps"] is False
    assert abs(report["audio"]["tempo_bpm"] - 100.0) <= 1.0


def test_slow_motion_240fps_pose_sampled_audio_full(client, tmp_path):
    video = make_video(tmp_path / "slowmo240.mp4", fps=240, seconds=4.0, bpm=100.0)
    res = post_video(client, video, rudiment="Single Paradiddle")
    assert res.status_code == 202, res.text
    assert res.json()["slow_motion"] is True and abs(res.json()["fps"] - 240) < 2
    job_id = res.json()["job_id"]
    assert client.get(f"/api/jobs/{job_id}").json()["status"] == "done"
    report = client.get(f"/api/results/{job_id}").json()
    assert abs(report["source"]["fps"] - 240) < 2
    assert abs(report["audio"]["tempo_bpm"] - 100.0) <= 1.0


def test_chunked_upload_errors(client):
    assert client.put("/api/uploads/" + "0" * 32 + "?offset=0", content=b"x").status_code == 404
    assert client.post("/api/uploads/not-an-id/finish").status_code == 404
    assert client.post("/api/uploads", data={"filename": "a.txt"}).status_code == 415
    assert client.post("/api/uploads", data={"filename": "a.mp4", "size": str(10 ** 13)}).status_code == 413
    res = client.post("/api/uploads", data={"filename": "a.mp4"})
    assert client.post(f"/api/uploads/{res.json()['upload_id']}/finish").status_code == 422   # nothing sent
    cfg = client.get("/api/config").json()
    assert cfg["slow_motion_fps"] == 100 and cfg["chunk_bytes"] <= 95 * 1024 * 1024
