"""Training dataset: the labels.json schema (Python validator and JSON Schema agree),
clip intake (upload and "Add to training set" from a finished job), pre-filled strokes,
saving labels, and the label page behind the access gate."""
import copy
import json

import jsonschema
import pytest
from fastapi.testclient import TestClient
from scripts.make_test_video import make_video

from app import dataset, labels, main
from app.access import AccessGate


def sample_labels():
    doc = labels.new_labels("20260926-150400-take-01-ab12", "video.mp4", "IMG_0001.MOV", "upload", "2026-09-26T21:04:00+00:00")
    doc["meta"].update(player="Zaylyn", rudiment="Single Paradiddle", click_bpm=100, notes_per_beat=4, surface="pad",
                       camera_angle="side", fps=59.94, lighting="bright", take_type="sloppy",
                       known_mistakes="flipped sticking at 0:12", form_grade=7, form_comment="Relaxed, left hand a bit high",
                       clap_t=0.8)
    doc["strokes"] = [
        {"t": 1.25, "hand": "R", "type": "accent", "sticking_error": False, "source": "analyzer", "edited": False},
        {"t": 1.1, "hand": "L", "type": "normal", "sticking_error": False, "source": "manual", "edited": False},
        {"t": 1.4, "hand": None, "type": "ghost", "sticking_error": True, "source": "analyzer", "edited": True},
    ]
    doc["status"] = "done"
    doc["labeler"] = "Mike Staus"
    return doc


def test_valid_labels_pass_both_validators(labels_schema):
    doc = sample_labels()
    clean = labels.validate(doc)
    jsonschema.Draft202012Validator(labels_schema).validate(clean)
    assert [s["t"] for s in clean["strokes"]] == [1.1, 1.25, 1.4]           # sorted by time
    assert clean["meta"]["form_grade"] == 7 and clean["meta"]["surface"] == "pad"
    minimal = labels.validate({"clip_id": "abc123-x", "video_file": "video.webm", "strokes": [{"t": 0.5, "hand": "L"}]})
    jsonschema.Draft202012Validator(labels_schema).validate(minimal)
    assert minimal["strokes"][0] == {"t": 0.5, "hand": "L", "type": "normal", "sticking_error": False,
                                     "source": "manual", "edited": False}
    assert minimal["status"] == "draft" and minimal["meta"]["form_grade"] is None


@pytest.mark.parametrize("mutate, message", [
    (lambda d: d["strokes"][0].update(hand="X"), "hand"),
    (lambda d: d["strokes"][0].update(t=-1), "between"),
    (lambda d: d["strokes"][0].update(type="flam"), "type"),
    (lambda d: d["strokes"][0].update(color="red"), "Unknown field"),
    (lambda d: d["meta"].update(form_grade=11), "form_grade"),
    (lambda d: d["meta"].update(form_grade=7.5), "whole number"),
    (lambda d: d["meta"].update(surface="table"), "surface"),
    (lambda d: d["meta"].update(click_bpm="fast"), "click_bpm"),
    (lambda d: d["meta"].update(mood="happy"), "Unknown meta"),
    (lambda d: d.update(status="finished"), "status"),
    (lambda d: d.update(clip_id="../etc"), "clip_id"),
    (lambda d: d.update(video_file="../video.mp4"), "video_file"),
    (lambda d: d.update(extra=1), "Unknown field"),
])
def test_invalid_labels_rejected_by_both(labels_schema, mutate, message):
    doc = copy.deepcopy(sample_labels())
    mutate(doc)
    with pytest.raises(labels.LabelError, match=message):
        labels.validate(doc)
    assert not jsonschema.Draft202012Validator(labels_schema).is_valid(json.loads(json.dumps(doc)))


def test_eval_region_order_checked():
    doc = sample_labels()
    doc["meta"].update(eval_start_s=10.0, eval_end_s=5.0)
    with pytest.raises(labels.LabelError, match="after"):
        labels.validate(doc)


@pytest.fixture
def client(job_store, dataset_store):
    return TestClient(main.app)


def post_clip(client, path, **fields):
    with path.open("rb") as fh:
        return client.post("/api/dataset", files={"video": (path.name, fh, "video/mp4")}, data=fields)


def test_upload_prefill_and_save(client, tmp_path, dataset_store, labels_schema):
    video = make_video(tmp_path / "Take 01.mp4", fps=60, seconds=4.0, bpm=100.0)
    res = post_clip(client, video, player="Zaylyn", rudiment="Single Stroke Roll", click_bpm="100", surface="pad",
                    labeler="Mike Staus")
    assert res.status_code == 202, res.text
    clip_id = res.json()["clip_id"]
    assert "take-01" in clip_id
    folder = dataset_store / clip_id
    assert (folder / "video.mp4").read_bytes() == video.read_bytes()          # the original, byte for byte
    for name in ("labels.json", "analysis.json", "waveform.json", "audio.wav", "status.json"):
        assert (folder / name).exists(), name

    d = client.get(f"/api/dataset/{clip_id}").json()                          # background intake already ran
    assert d["status"]["state"] == "ready", d["status"]
    lab = d["labels"]
    jsonschema.Draft202012Validator(labels_schema).validate(lab)
    assert lab["labeler"] == "Mike Staus" and lab["meta"]["player"] == "Zaylyn" and lab["meta"]["click_bpm"] == 100
    assert lab["meta"]["fps"] == pytest.approx(60, abs=0.5)
    assert len(lab["strokes"]) == len(d["detections"]) > 0                    # pre-filled from the analyzer
    assert all(s["source"] == "analyzer" for s in lab["strokes"])
    assert lab["prefill"]["stroke_count"] == len(lab["strokes"])
    assert d["onsets"] and d["video"]["fps"] == pytest.approx(60, abs=0.5) and d["video"]["preview"] is False

    listed = client.get("/api/dataset").json()["clips"]
    assert [c["clip_id"] for c in listed] == [clip_id] and listed[0]["intake"] == "ready"

    lab["strokes"] = lab["strokes"][1:] + [{"t": 3.9, "hand": "L", "type": "ghost", "source": "manual"}]
    lab["strokes"][0].update(hand="R", edited=True)
    lab["meta"].update(form_grade=6, form_comment="ok")
    lab["status"] = "done"
    lab["clip_id"] = "someone-elses-clip"                                     # identity fields are not writable
    saved = client.put(f"/api/dataset/{clip_id}/labels", json=lab)
    assert saved.status_code == 200, saved.text
    on_disk = json.loads((folder / "labels.json").read_text())
    assert on_disk["clip_id"] == clip_id and on_disk["status"] == "done" and on_disk["meta"]["form_grade"] == 6
    assert {"t": 3.9, "hand": "L", "type": "ghost", "sticking_error": False, "source": "manual", "edited": False} in on_disk["strokes"]
    assert (folder / "labels.prev.json").exists()

    bad = client.put(f"/api/dataset/{clip_id}/labels", json={**lab, "strokes": [{"t": 1, "hand": "Q"}]})
    assert bad.status_code == 422 and "hand" in bad.json()["error"]

    vid = client.get(f"/api/dataset/{clip_id}/video", headers={"Range": "bytes=0-99"})
    assert vid.status_code == 206 and len(vid.content) == 100
    wf = client.get(f"/api/dataset/{clip_id}/waveform").json()
    assert wf["rate"] > 150 and len(wf["peaks"]) > 500


def test_dataset_errors(client, tmp_path):
    assert client.get("/api/dataset/not-a-clip").status_code == 404
    assert client.get("/api/dataset/..%2F..%2Fetc").status_code == 404
    assert client.put("/api/dataset/zzzzzz-none/labels", json={}).status_code == 404
    bad = tmp_path / "notes.txt"
    bad.write_text("hello")
    assert post_clip(client, bad).status_code == 415
    video = make_video(tmp_path / "v.mp4", fps=60, seconds=2.0)
    res = post_clip(client, video, form_grade="x", click_bpm="fast")
    assert res.status_code == 422
    slow = make_video(tmp_path / "slow.mp4", fps=15, seconds=2.0)
    assert post_clip(client, slow).status_code == 422
    assert client.get("/api/dataset").json()["clips"] == []                   # rejected uploads are not kept


def test_add_finished_job_to_training_set(client, tmp_path, dataset_store):
    video = make_video(tmp_path / "job.mp4", fps=60, seconds=3.0, bpm=100.0)
    with video.open("rb") as fh:
        job_id = client.post("/api/analyze", files={"video": ("job.mp4", fh, "video/mp4")},
                             data={"rudiment": "Single Paradiddle", "target_bpm": "100"}).json()["job_id"]
    res = client.post(f"/api/dataset/from-job/{job_id}")
    assert res.status_code == 202, res.text
    clip_id = res.json()["clip_id"]
    assert res.json()["label_url"] == f"/label#clip={clip_id}"
    d = client.get(f"/api/dataset/{clip_id}").json()
    assert d["status"]["state"] == "ready"
    assert d["labels"]["source"] == "job" and d["labels"]["meta"]["click_bpm"] == 100
    assert d["labels"]["meta"]["rudiment"] == "Single Paradiddle"
    report = json.loads((dataset_store / clip_id / "analysis.json").read_text())
    assert report["job_id"] == job_id                                         # the job's own report, not re-run
    assert len(d["labels"]["strokes"]) == len(report["strokes"])
    assert client.post(f"/api/dataset/from-job/{job_id}").json()["clip_id"] == clip_id   # no duplicate copy
    assert client.post("/api/dataset/from-job/" + "0" * 32).status_code == 404


def test_label_page_behind_gate(job_store, dataset_store):
    gated = TestClient(AccessGate(main.app, token="k3y"), base_url="https://testserver")
    assert gated.get("/label").status_code == 401
    assert gated.get("/api/dataset").status_code == 401
    res = gated.get("/label?key=k3y", follow_redirects=False)
    assert res.status_code == 303 and res.headers["location"] == "/label"
    page = gated.get("/label")
    assert page.status_code == 200 and "Label training clips" in page.text
    js = gated.get("/static/label.js")
    assert js.status_code == 200
    # Front-end files are revalidated each time so a CDN in front of the tunnel never serves a stale copy.
    assert js.headers["cache-control"] == "no-cache"
    assert page.headers["cache-control"] == "no-cache"
    assert gated.get("/api/dataset").json()["clips"] == []


def test_user_facing_copy_has_no_em_dashes():
    from pathlib import Path
    root = Path(__file__).resolve().parent.parent
    files = [root / "static" / n for n in ("label.html", "label.js", "label.css", "index.html", "app.js")]
    files += [root / "docs" / "training-shot-list.md", root / "README.md", root / "scripts" / "evaluate.py"]
    for f in files:
        assert "\u2014" not in f.read_text(encoding="utf-8"), f.name
