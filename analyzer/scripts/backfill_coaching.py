"""Add or refresh the coaching section (app/coaching.py) in finished analyses.

    .venv\\Scripts\\python.exe -m scripts.backfill_coaching              # every finished job without current coaching
    .venv\\Scripts\\python.exe -m scripts.backfill_coaching --force      # recompute for every finished job
    .venv\\Scripts\\python.exe -m scripts.backfill_coaching <job_id>     # only these jobs

Coaching is worked out from the saved report alone (no video processing), so this takes well under a
second per job. /api/results also computes it on the fly for reports without it, so this script only
makes the saved report.json files complete (and applies new coaching thresholds after tuning).
"""
from __future__ import annotations

import sys

from app import coaching, jobs


def backfill(job_ids: list[str] | None = None, force: bool = False, log=print) -> list[str]:
    """Returns the job ids whose report got new coaching."""
    if not job_ids:
        root = jobs.DATA_DIR
        job_ids = sorted(p.name for p in root.iterdir() if p.is_dir() and jobs.JOB_ID_RE.match(p.name)) if root.exists() else []
    updated = []
    for job_id in job_ids:
        try:
            job = jobs.read(job_id)
        except Exception:
            log(f"{job_id}: no such analysis")
            continue
        if job.get("status") != "done":
            log(f"{job_id}: skipped, status {job.get('status')}")
            continue
        try:
            report = jobs.read_report(job_id)
        except Exception as exc:
            log(f"{job_id}: skipped, report unreadable ({exc})")
            continue
        if not force and not coaching.needs_update(report):
            log(f"{job_id}: already has coaching v{coaching.VERSION}")
            continue
        report["coaching"] = coaching.safe_coach(report)
        jobs.write_report(job_id, report)
        c = report["coaching"]
        log(f"{job_id}: {c['status']}, {len(c['findings'])} findings, focus: {c['focus']}")
        updated.append(job_id)
    return updated


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--force"]
    done = backfill(args or None, force="--force" in sys.argv[1:])
    print(f"Coaching written to {len(done)} analyses.")
