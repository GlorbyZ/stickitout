"""Playback skeleton data: every frame analysed, keyed by the frame's presentation time.

The fast test builds a synthetic cache (no MediaPipe). The slow test makes a fast paradiddle
drummer clip, blurs the motion, re-times it to a variable frame rate with a 0.25 s start offset
(like a phone MP4 with an edit list), runs a real job and checks /api/jobs/{id}/landmarks,
then checks that scripts/backfill_landmarks.py adds the same data to an older analysis.
"""
import gzip
import json
import shutil
import subprocess

import imageio_ffmpeg
import pytest
from fastapi.testclient import TestClient

from app import jobs, media, pipeline
from app.main import app


def _write_cache(path, frames, width=1280, height=720):
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        json.dump({"key": {}, "raw": {"frames": frames, "width": width, "height": height, "pts_source": "packets"}}, fh)


def _pose(x=640.0, y=360.0, vis=0.9):
    return {k: (x, y, vis) for k in ("ls", "rs", "le", "re", "lw", "rw")}


def test_playback_landmarks_shape_and_rates(tmp_path):
    frames = []
    for i in range(10):
        pts = 0.25 + i / 60 + (0.006 if i % 7 > 3 else 0.0)
        frames.append({"t": i / 60, "pts": pts, "pose": _pose() if i != 4 else None,
                       "body": {"nose": (640.0, 100.0, 0.99), "lh": (600.0, 700.0, 0.4), "rh": (680.0, 700.0, 0.4)},
                       "hands": [[(10.0, 20.0)] * 21, [(30.0, 40.0)] * 21] if i % 2 == 0 else []})
    cache = tmp_path / "landmarks.json.gz"
    _write_cache(cache, frames)
    data = pipeline.playback_landmarks(cache)
    assert data["t"] == [round(f["pts"], 5) for f in frames]
    assert data["pose"][4] is None                        # a frame without a pose stays empty, never a copy of the last one
    assert len(data["pose"][0]) == 3 * len(pipeline.PLAYBACK_POINTS)
    assert data["pose"][0][:3] == [0.5, round(100 / 720, 4), 0.99]    # nose first, normalised
    assert len(data["hands"][0]) == 2 and len(data["hands"][0][0]) == 42 and data["hands"][1] == []
    assert data["stats"]["frames"] == 10 and data["stats"]["pose_rate"] == 0.9 and data["stats"]["two_hands_rate"] == 0.5


def test_old_cache_without_pts_is_not_served(tmp_path):
    cache = tmp_path / "landmarks.json.gz"
    _write_cache(cache, [{"t": 0.0, "pose": _pose(), "hands": []}])
    assert pipeline.playback_landmarks(cache) is None
    assert pipeline.playback_landmarks(tmp_path / "missing.json.gz") is None


def test_landmarks_endpoint_errors(job_store):
    client = TestClient(app)
    assert client.get("/api/jobs/" + "0" * 32 + "/landmarks").status_code == 404
    job_id = jobs.create("x.mp4")
    assert client.get(f"/api/jobs/{job_id}/landmarks").status_code == 409


@pytest.fixture(scope="module")
def fast_vfr_video(tmp_path_factory):
    from scripts.make_test_video import make_video
    d = tmp_path_factory.mktemp("fastvfr")
    try:
        src = make_video(d / "fast60.mp4", fps=60, seconds=6.0, bpm=160.0, drummer=True)
    except OSError as exc:
        pytest.skip(f"could not fetch the test photo: {exc}")
    out = d / "fast_vfr_offset.mp4"
    # Motion blur (3-frame mix), then uneven frame timing (+6 ms on 3 of every 7 frames) and a 0.25 s start offset.
    vf = "tmix=frames=3,settb=1/90000,setpts='(N/60+if(gt(mod(N\\,7)\\,3)\\,0.006\\,0))/TB'"
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), "-vf", vf,
                    "-fps_mode", "passthrough", "-c:v", "libx264", "-preset", "veryfast", "-bf", "2", "-pix_fmt", "yuv420p",
                    "-video_track_timescale", "90000", "-c:a", "copy", "-output_ts_offset", "0.25", str(out)], check=True)
    return out


def test_fast_vfr_clip_every_frame_keyed_by_pts(fast_vfr_video, job_store):
    pts = media.frame_times(fast_vfr_video)
    info = media.probe_video(fast_vfr_video)
    assert len(pts) == info.frame_count and abs(pts[0] - 0.25) < 0.002
    gaps = {round(b - a, 3) for a, b in zip(pts, pts[1:])}
    assert len(gaps) > 1, "the clip should have a variable frame rate"

    job_id = jobs.create(fast_vfr_video.name)
    params = {"rudiment": "Single Paradiddle", "target_bpm": 160.0, "av_offset_ms": 0.0, "verify_window_ms": 40.0}
    pipeline.run(job_id, fast_vfr_video, params)
    job = jobs.read(job_id)
    assert job["status"] == "done", job["error"]
    report = jobs.read_report(job_id)
    if report["video"]["degraded"] and "failed" in (report["video"]["degraded_reason"] or ""):
        pytest.skip(f"MediaPipe unavailable here: {report['video']['degraded_reason']}")
    data = TestClient(app).get(f"/api/jobs/{job_id}/landmarks").json()
    assert data["pts_source"] == "packets"
    assert len(data["t"]) == len(pts) == len(data["pose"])        # every frame analysed
    assert all(abs(a - b) < 1e-4 for a, b in zip(data["t"], pts))   # keyed by the frame's own presentation time
    assert data["stats"]["pose_rate"] >= 0.95, data["stats"]
    print("fast VFR clip detection:", data["stats"], "fps", info.fps)

    # Analyses made before playback data existed get it from scripts/backfill_landmarks.py.
    from scripts.backfill_landmarks import backfill
    d = jobs.job_dir(job_id)
    shutil.copy(fast_vfr_video, d / "video.mp4")
    jobs.update(job_id, video_file="video.mp4")
    (d / pipeline.LANDMARKS_FILE).unlink()
    assert TestClient(app).get(f"/api/jobs/{job_id}/landmarks").status_code == 404
    assert backfill([job_id], log=lambda m: None) == [job_id]
    assert backfill(None, log=lambda m: None) == []          # nothing left to add
    again = TestClient(app).get(f"/api/jobs/{job_id}/landmarks").json()
    assert again["t"] == data["t"] and again["stats"] == data["stats"]
