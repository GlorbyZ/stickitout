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


def _sha(b):
    import hashlib
    return hashlib.sha256(b).hexdigest()


def start_upload(client, name, data):
    res = client.post("/api/uploads", data={"filename": name, "size": str(len(data))})
    assert res.status_code == 201, res.text
    return res.json()


def put_piece(client, uid, data, i, step, sha=None, body=None):
    piece = data[i * step:(i + 1) * step]
    return client.put(f"/api/uploads/{uid}/pieces/{i}?sha256={sha or _sha(piece)}", content=piece if body is None else body)


def test_slow_motion_120fps_resumable_upload(client, tmp_path, report_schema, monkeypatch):
    """A 120 fps clip in pieces, out of order, with a duplicate, a damaged and a cut-off piece."""
    import app.main as m
    monkeypatch.setattr(m, "PIECE_BYTES", 256 * 1024)
    video = make_video(tmp_path / "slowmo120.mp4", fps=120, seconds=4.0, bpm=100.0)
    data = video.read_bytes()
    st = start_upload(client, video.name, data)
    uid, step, n = st["upload_id"], st["piece_bytes"], st["pieces"]
    assert step == 256 * 1024 and n == -(-len(data) // step) and n >= 3
    order = list(range(n))[::-1]
    for i in order[: n // 2]:
        assert put_piece(client, uid, data, i, step).status_code == 200
    # the connection drops: a cut-off piece and a damaged one are refused and not stored
    cut = put_piece(client, uid, data, 0, step, body=data[:1000])
    assert cut.status_code == 400 and "expected" in cut.json()["error"]
    bad = put_piece(client, uid, data, 0, step, sha="0" * 64)
    assert bad.status_code == 400 and "checksum" in bad.json()["error"]
    # "reload": the status says which pieces are there, only the rest are sent
    status = client.get(f"/api/uploads/{uid}").json()
    assert status["have"] == sorted(order[: n // 2]) and status["complete"] is False and status["size"] == len(data)
    early = client.post(f"/api/uploads/{uid}/finish", data={"rudiment": "Single Paradiddle"})
    assert early.status_code == 409 and early.json()["missing"] == sorted(order[n // 2:])
    for i in order[n // 2:]:
        assert put_piece(client, uid, data, i, step).status_code == 200
    assert put_piece(client, uid, data, 1, step).status_code == 200            # duplicate piece is fine
    assert client.get(f"/api/uploads/{uid}").json()["complete"] is True
    res = client.post(f"/api/uploads/{uid}/finish", data={"rudiment": "Single Paradiddle"})
    assert res.status_code == 202, res.text
    body = res.json()
    assert body["job_id"] == uid and body["slow_motion"] is True and abs(body["fps"] - 120) < 1
    again = client.post(f"/api/uploads/{uid}/finish", data={"rudiment": "Single Paradiddle"})
    assert again.status_code == 202 and again.json()["job_id"] == uid                 # finish is idempotent
    assert client.get(f"/api/jobs/{uid}").json()["status"] == "done"
    report = client.get(f"/api/results/{uid}").json()
    jsonschema.Draft202012Validator(report_schema).validate(report)
    assert abs(report["source"]["fps"] - 120) < 1 and report["quality"]["low_fps"] is False
    assert abs(report["audio"]["tempo_bpm"] - 100.0) <= 1.0
    video_file = next(p for p in (m.jobs.job_dir(uid)).iterdir() if p.name.startswith("video."))
    assert video_file.read_bytes() == data                                        # joined exactly
    assert not list(m.jobs.job_dir(uid).glob("piece-*"))


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


def test_upload_errors_and_abandoned_cleanup(client, monkeypatch):
    import os
    import time
    import app.main as m
    assert client.put("/api/uploads/" + "0" * 32 + "/pieces/0?sha256=" + "0" * 64, content=b"x").status_code == 404
    assert client.get("/api/uploads/not-an-id").status_code == 404
    assert client.post("/api/uploads", data={"filename": "a.txt", "size": "10"}).status_code == 415
    assert client.post("/api/uploads", data={"filename": "a.mp4", "size": str(10 ** 13)}).status_code == 413
    st = start_upload(client, "a.mp4", b"x" * 10)
    uid = st["upload_id"]
    assert client.put(f"/api/uploads/{uid}/pieces/5?sha256={_sha(b'x' * 10)}", content=b"x" * 10).status_code == 422
    assert client.put(f"/api/uploads/{uid}/pieces/0?sha256=nothex", content=b"x" * 10).status_code == 422
    assert client.post(f"/api/uploads/{uid}/finish").status_code == 409
    cfg = client.get("/api/config").json()
    assert cfg["slow_motion_fps"] == 100 and cfg["piece_bytes"] == 8 * 1024 * 1024
    # abandoned for more than 24 h: removed; a fresh one stays
    fresh = start_upload(client, "b.mp4", b"y" * 10)["upload_id"]
    old = time.time() - 25 * 3600
    for f in m.jobs.job_dir(uid).iterdir():
        os.utime(f, (old, old))
    assert m.cleanup_abandoned_uploads() == 1
    assert client.get(f"/api/uploads/{uid}").status_code == 404
    assert client.get(f"/api/uploads/{fresh}").status_code == 200
