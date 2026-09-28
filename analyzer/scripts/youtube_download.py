"""Download the Creative Commons (CC-BY) videos from data/youtube/catalog.json for training.

Only videos whose own YouTube metadata says "Creative Commons Attribution license (reuse
allowed)" are downloaded. The license is read again right before each download and a video
that is no longer CC-BY is skipped. Videos with a Standard YouTube license are never
downloaded: they stay in the catalog as links for a permission request.

Files go to DATASET_DIR/youtube/<rudiment>/<video id>.mp4, or SIO_YOUTUBE_DIR/<rudiment>/ when
that is set (not committed; downloading stops when the drive has less than 5 GB free). Attribution for
every downloaded video is written to data/youtube/attribution.csv (committed). After each
download a few frames are checked with MediaPipe to confirm a player and both hands are in
view; the result is in data/youtube/downloads.csv.

Usage (analyzer venv, yt-dlp on PATH):
  python -m scripts.youtube_download                     every catalog row with training_ok
  python -m scripts.youtube_download --max-per-rudiment 4
  python -m scripts.youtube_download --dry-run           list what would be downloaded
  python -m scripts.youtube_download --include-thumb-fail
      also CC-BY demos rejected only because the thumbnail (often a title card) showed no
      player: the frame check on the real video decides instead

Every clip is then reviewed by eye (contact sheet of the check frames) and the verdict is
recorded in data/youtube/review.csv (video_id, verdict keep/exclude, angle, hands, note);
scripts/youtube_batch.py only analyses clips with status ok and no "exclude" verdict.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from app import config  # noqa: E402
from app.media import ffmpeg_exe, probe_video  # noqa: E402
from app.rudiments import slug  # noqa: E402
from scripts.youtube_catalog import CC_LICENSE, OUT, YTDLP, RateLimited, metadata, view_from_image  # noqa: E402

# Where the videos go. Default DATASET_DIR/youtube; set SIO_YOUTUBE_DIR to put them on a bigger drive.
CLIPS = Path(os.environ.get("SIO_YOUTUBE_DIR") or Path(config.DATASET_DIR) / "youtube")
MIN_FREE_GB = 5.0                       # stop downloading before the drive gets this full
THUMB_ONLY = "no player or hands in the thumbnail"
FORMAT = ["-f", "bv*[height<=1080]+ba/b[height<=1080]", "-S", "vcodec:h264,fps,res:1080,acodec:aac",
          "--merge-output-format", "mp4"]


def verify_frames(path: Path, duration: float, n: int = 7) -> dict:
    """Angle and hands from n frames spread over the middle 80% of the video."""
    tmp = OUT / "cache" / "frames"
    tmp.mkdir(parents=True, exist_ok=True)
    views = []
    for k in range(n):
        t = duration * (0.1 + 0.8 * k / max(1, n - 1))
        img = tmp / f"{path.stem}-{k}.jpg"
        subprocess.run([ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{t:.2f}", "-i", str(path),
                        "-frames:v", "1", "-q:v", "3", str(img)], capture_output=True, timeout=120)
        if img.exists():
            try:
                views.append(view_from_image(img))
            except Exception:
                pass
    if not views:
        return {"frames_checked": 0, "angle": "unknown", "hands_visible_pct": 0, "player_pct": 0}
    angles = Counter(v["angle"] for v in views if v["angle"] not in ("unknown", "no player found"))
    both = sum(1 for v in views if v["hands_visible"] == "yes")
    player = sum(1 for v in views if v["angle"] != "no player found")
    return {"frames_checked": len(views), "angle": angles.most_common(1)[0][0] if angles else "unknown",
            "hands_visible_pct": round(100 * both / len(views)), "player_pct": round(100 * player / len(views))}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--max-per-rudiment", type=int, default=0, help="best N CC-BY videos per rudiment (0 = all that pass)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only", default="", help="comma separated video ids")
    ap.add_argument("--pace", type=float, default=5.0, help="seconds between YouTube requests")
    ap.add_argument("--include-thumb-fail", action="store_true",
                    help="also CC-BY rows whose only problem is the thumbnail (the frame check decides)")
    a = ap.parse_args(argv)
    cat = json.loads((OUT / "catalog.json").read_text(encoding="utf-8"))["videos"]
    rows = [r for r in cat if r["license"] == "CC-BY" and (r.get("training_ok") or (
        a.include_thumb_fail and r.get("training_skip_reason") == THUMB_ONLY))]
    if a.only:
        ids = set(a.only.split(","))
        rows = [r for r in cat if r["video_id"] in ids and r["license"] == "CC-BY"]
    if a.max_per_rudiment:
        per = Counter()
        keep = []
        for r in sorted(rows, key=lambda r: (r["rudiment_number"], -r["score"])):
            if per[r["rudiment_number"]] < a.max_per_rudiment:
                keep.append(r)
                per[r["rudiment_number"]] += 1
        rows = keep
    seen, todo = set(), []
    for r in rows:                         # dedupe by video id
        if r["video_id"] not in seen:
            seen.add(r["video_id"])
            todo.append(r)
    print(f"{len(todo)} CC-BY videos to fetch", flush=True)
    if a.dry_run:
        for r in todo:
            print(r["rudiment_number"], r["video_id"], r["title"][:70], "|", r["channel"])
        return 0

    att_path, dl_path = OUT / "attribution.csv", OUT / "downloads.csv"
    att = {r["video_id"]: r for r in csv.DictReader(open(att_path, encoding="utf-8"))} if att_path.exists() else {}
    dls = {r["video_id"]: r for r in csv.DictReader(open(dl_path, encoding="utf-8"))} if dl_path.exists() else {}
    for i, r in enumerate(todo, 1):
        vid = r["video_id"]
        dest_dir = CLIPS / slug(r["rudiment"])
        dest = dest_dir / f"{vid}.mp4"
        if dest.exists() and vid in att and dls.get(vid, {}).get("status"):
            continue                                            # already fetched and checked
        try:
            meta = metadata(vid, refresh=True)                 # license checked again, fresh
        except RateLimited as exc:
            print(f"stopping: YouTube rate limit ({exc}). Run again later to resume.", flush=True)
            break
        time.sleep(a.pace)
        lic = (meta or {}).get("license") or ""
        if lic != CC_LICENSE:
            print(f"[{i}/{len(todo)}] {vid} skipped: license now {lic or 'Standard'}", flush=True)
            dls[vid] = {**dls.get(vid, {}), "video_id": vid, "status": f"skipped: license {lic or 'Standard'}"}
            continue
        if not dest.exists():
            dest_dir.mkdir(parents=True, exist_ok=True)
            free_gb = shutil.disk_usage(dest_dir).free / 1e9
            if free_gb < MIN_FREE_GB:
                print(f"stopping: only {free_gb:.1f} GB free on the download drive", flush=True)
                break
            p = subprocess.run([YTDLP, *FORMAT, "--no-playlist", "--no-part", "-o", str(dest_dir / f"{vid}.%(ext)s"),
                                f"https://www.youtube.com/watch?v={vid}"], capture_output=True, text=True,
                               encoding="utf-8", errors="replace", timeout=1800)
            if p.returncode != 0 or not dest.exists():
                print(f"[{i}/{len(todo)}] {vid} download failed: {(p.stderr or '')[-200:]}", flush=True)
                dls[vid] = {"video_id": vid, "status": "download failed"}
                continue
        info = probe_video(dest)
        view = verify_frames(dest, info.duration_s)
        ok = view["hands_visible_pct"] >= 40 and view["player_pct"] >= 60
        dls[vid] = {"video_id": vid, "rudiment_number": r["rudiment_number"], "rudiment": r["rudiment"],
                    "file": dest.relative_to(CLIPS).as_posix(), "status": "ok" if ok else "downloaded, excluded",
                    "exclude_reason": "" if ok else f"hands visible in {view['hands_visible_pct']}% and a player in {view['player_pct']}% of checked frames",
                    "fps_measured": round(info.fps, 2), "width": info.width, "height": info.height,
                    "duration_s": round(info.duration_s, 1), "angle_frames": view["angle"],
                    "hands_visible_pct": view["hands_visible_pct"], "player_pct": view["player_pct"],
                    "frames_checked": view["frames_checked"], "size_mb": round(dest.stat().st_size / 1e6, 1)}
        att[vid] = {"video_id": vid, "rudiment": r["rudiment"], "title": meta.get("title"),
                    "channel": meta.get("channel") or meta.get("uploader"), "channel_url": meta.get("channel_url"),
                    "url": f"https://www.youtube.com/watch?v={vid}", "license": lic,
                    "attribution": f"\"{meta.get('title')}\" by {meta.get('channel') or meta.get('uploader')} "
                                   f"(https://www.youtube.com/watch?v={vid}), licensed CC BY (YouTube Creative Commons Attribution)",
                    "downloaded": time.strftime("%Y-%m-%d")}
        print(f"[{i}/{len(todo)}] {vid} {dls[vid]['status']} {info.fps:.1f} fps {info.width}x{info.height} "
              f"angle {view['angle']} hands {view['hands_visible_pct']}%", flush=True)
        for path, data in ((att_path, att), (dl_path, dls)):           # save as we go
            fields = sorted({k for v in data.values() for k in v}, key=lambda k: (k != "video_id", k))
            with open(path, "w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=fields)
                w.writeheader()
                w.writerows(data.values())
    print(f"done: {sum(1 for d in dls.values() if d.get('status') == 'ok')} usable clips in {CLIPS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
