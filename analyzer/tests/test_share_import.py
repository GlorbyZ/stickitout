"""Shared-drive intake copies a settled video once and leaves the share alone."""
import os
from pathlib import Path

from app import dataset


def test_share_import_copies_once_and_waits_for_a_quiet_file(tmp_path, monkeypatch):
    share = tmp_path / "share"
    nested = share / "session"
    nested.mkdir(parents=True)
    ready = nested / "T01-singles.mp4"
    ready.write_bytes(b"not-a-real-video")
    quiet = ready.stat().st_mtime - 60
    os.utime(ready, (quiet, quiet))
    fresh = share / "still-copying.mov"
    fresh.write_bytes(b"partial")

    store = tmp_path / "dataset"
    monkeypatch.setattr(dataset, "DATASET_DIR", store)

    first = dataset.import_from_share(share, settle_s=20)
    assert len(first) == 1
    clip = store / first[0]["clip_id"]
    assert (clip / "video.mp4").read_bytes() == b"not-a-real-video"
    labels = dataset.read_labels(first[0]["clip_id"])
    assert labels["source"] == "share"
    assert labels["original_filename"] == "T01-singles.mp4"
    assert ready.read_bytes() == b"not-a-real-video"

    assert dataset.import_from_share(share, settle_s=20) == []

    aged = quiet - 60
    os.utime(fresh, (aged, aged))
    second = dataset.import_from_share(share, settle_s=20)
    assert len(second) == 1
    assert second[0]["name"] == "still-copying.mov"
