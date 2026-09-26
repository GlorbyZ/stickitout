"""Add the per-frame playback skeleton (landmarks.json.gz) to analyses made before it existed.

    .venv\\Scripts\\python.exe -m scripts.backfill_landmarks             # every finished job without it
    .venv\\Scripts\\python.exe -m scripts.backfill_landmarks <job_id>    # only these jobs

It runs pose and hands on every frame of the saved video, the same step a new analysis runs
(a few seconds per second of 60 fps video on the studio PC). Scores and reports are not changed.
The server does not need a restart: the Results page loads the data when "Draw skeleton on
playback" is ticked.
"""
from __future__ import annotations

import sys

from app import jobs, pipeline


def backfill(job_ids: list[str] | None = None, log=print) -> list[str]:
    """Returns the job ids that got playback data."""
    if not job_ids:
        root = jobs.DATA_DIR
        job_ids = sorted(p.name for p in root.iterdir() if p.is_dir() and jobs.JOB_ID_RE.match(p.name)) if root.exists() else []
    added = []
    for job_id in job_ids:
        try:
            job = jobs.read(job_id)
        except Exception:
            log(f"{job_id}: no such analysis")
            continue
        if job.get("status") != "done":
            log(f"{job_id}: skipped, status {job.get('status')}")
            continue
        d = jobs.job_dir(job_id)
        cache = d / pipeline.LANDMARKS_FILE
        if pipeline.playback_landmarks(cache) is not None:
            log(f"{job_id}: already has playback data")
            continue
        video = d / (job.get("video_file") or "")
        if not job.get("video_file") or not video.exists():
            log(f"{job_id}: skipped, the video was not kept")
            continue
        try:
            pipeline.landmarks(video, cache=cache)
            data = pipeline.playback_landmarks(cache)
        except Exception as exc:  # MediaPipe or ffmpeg failure: report and move on
            log(f"{job_id}: failed: {exc}")
            continue
        if data is None:
            log(f"{job_id}: failed: no playback data written")
            continue
        st = data["stats"]
        log(f"{job_id}: {st['frames']} frames, pose on {st['pose_rate']:.0%}, both hands on {st['two_hands_rate']:.0%}")
        added.append(job_id)
    return added


if __name__ == "__main__":
    done = backfill(sys.argv[1:] or None)
    print(f"Added playback skeleton data to {len(done)} analyses.")
