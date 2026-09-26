"""Access gate (ACCESS_TOKEN), the upload size cap and old-job cleanup."""
import os
import time

import pytest
from fastapi.testclient import TestClient

from app import jobs, main
from app.access import COOKIE, AccessGate

TOKEN = "s3cret-test-key"


@pytest.fixture
def gated(job_store):
    return TestClient(AccessGate(main.app, token=TOKEN), base_url="https://testserver")


def test_gate_blocks_without_key(gated):
    ui = gated.get("/")
    assert ui.status_code == 401 and "access key" in ui.text.lower()
    api = gated.get("/api/jobs/" + "0" * 32)
    assert api.status_code == 401 and "key" in api.json()["error"]
    assert gated.get("/static/app.js").status_code == 401
    assert gated.get("/healthz").json() == {"ok": True}
    assert gated.get("/?key=wrong", follow_redirects=False).status_code == 401


def test_key_link_sets_cookie_and_strips_key(gated):
    res = gated.get("/?key=" + TOKEN, follow_redirects=False)
    assert res.status_code == 303 and res.headers["location"] == "/"
    cookie = res.headers["set-cookie"]
    assert COOKIE in cookie and "HttpOnly" in cookie and "Secure" in cookie and TOKEN not in cookie
    assert gated.get("/").status_code == 200                       # cookie now stored in the client
    assert gated.get("/api/jobs/" + "0" * 32).status_code == 404    # past the gate, job simply unknown


def test_header_tokens(gated):
    assert gated.get("/api/config", headers={"X-Access-Token": TOKEN}).status_code == 200
    assert gated.get("/api/config", headers={"Authorization": f"Bearer {TOKEN}"}).status_code == 200
    assert gated.get("/api/config", headers={"X-Access-Token": "nope"}).status_code == 401


def test_upload_cap_rejects_early(job_store, monkeypatch):
    monkeypatch.setattr(main, "MAX_UPLOAD_BYTES", 1000)
    client = TestClient(main.app)
    res = client.post("/api/analyze", files={"video": ("big.mp4", b"\0" * (3 * 1024 * 1024), "video/mp4")})
    assert res.status_code == 413 and "MB" in res.json()["error"]
    assert not job_store.exists() or not any(job_store.iterdir())   # nothing was stored


def test_cleanup_removes_only_old_jobs(job_store):
    old, fresh = jobs.create("old.mp4"), jobs.create("fresh.mp4")
    past = time.time() - 5 * 3600
    for f in jobs.job_dir(old).iterdir():
        os.utime(f, (past, past))
    assert jobs.cleanup(max_age_hours=2) == 1
    assert not jobs.job_dir(old).exists() and jobs.job_dir(fresh).exists()
    assert jobs.cleanup(max_age_hours=0) == 0
