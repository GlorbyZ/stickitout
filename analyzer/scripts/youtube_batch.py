"""Batch-analyze the downloaded CC-BY rudiment demos with weak labels.

These clips have no hand labels. The expected sticking of each rudiment (app/rudiments.py) is
used as a weak label: a pro demo is assumed to play the rudiment correctly, so a low sticking
match mostly means the analyzer misread hands (or the segment was not the rudiment). Rudiments
with grace notes or buzz strokes are analysed for hit detection and video matching only.

For each usable clip in data/youtube/downloads.csv (status ok and not excluded by the manual
review in data/youtube/review.csv) it finds the stretch where the rudiment is
played (the densest, most regular run of onsets in the audio), trims that segment, runs the
normal analyzer pipeline on it and checks the sticking against the expected pattern, next to
a chance baseline (the same hands shuffled). Production settings are used unchanged.

Writes reports/youtube-<timestamp>/ (report.md, clips.csv, summary.json) and copies the table
and summary to data/youtube/batch-results.csv and batch-summary.json (committed).

Usage (analyzer venv):
  python -m scripts.youtube_batch                    every usable downloaded clip
  python -m scripts.youtube_batch --only ID1,ID2     only these videos
  python -m scripts.youtube_batch --segment 16       seconds analysed per clip (default 16)
"""
from __future__ import annotations

import argparse
import copy
import csv
import json
import random
import statistics
import subprocess
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from app import config, pipeline, tuning  # noqa: E402
from app.audio import detect_onsets, load_wav, onset_velocities  # noqa: E402
from app.media import extract_audio, ffmpeg_exe, probe_video  # noqa: E402
from app.rudiments import find  # noqa: E402
from app.sticking import _orientations, check_sticking  # noqa: E402

from scripts.youtube_download import CLIPS  # noqa: E402  (the download folder, SIO_YOUTUBE_DIR aware)

OUT = ROOT / "data" / "youtube"
WORK = CLIPS / "_work"                  # trimmed segments and landmark caches, next to the videos


def find_segment(onset_times: np.ndarray, duration: float, length: float) -> tuple[float, float, dict]:
    """Start and length of the densest, most regular run of onsets (the rudiment being played)."""
    if duration <= length + 1:
        return 0.0, duration, {"why": "whole clip"}
    best = (-1.0, 0.0, {})
    for start in np.arange(0.0, duration - length + 0.01, 0.5):
        t = onset_times[(onset_times >= start) & (onset_times < start + length)]
        if t.size < 16:
            continue
        ioi = np.diff(t)
        med = float(np.median(ioi))
        if not 0.05 <= med <= 0.5:
            continue
        regular = float(np.mean((ioi > 0.5 * med) & (ioi < 2.0 * med)))
        gaps = float(np.sum(ioi[ioi > 1.0]))                       # talking pauses, count-ins
        score = t.size * regular ** 2 * max(0.0, 1.0 - gaps / length)
        if score > best[0]:
            best = (score, float(start), {"onsets": int(t.size), "median_ioi_ms": round(med * 1000), "regular": round(regular, 2)})
    if best[0] < 0:
        return 0.0, min(duration, length), {"why": "no regular playing found, used the start"}
    return best[1], length, best[2]


def trim(src: Path, dst: Path, start: float, length: float) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    p = subprocess.run([ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{start:.3f}", "-i", str(src),
                        "-t", f"{length:.3f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-pix_fmt", "yuv420p",
                        "-c:a", "aac", "-b:a", "192k", str(dst)], capture_output=True, text=True, timeout=900)
    if p.returncode != 0:
        raise RuntimeError(p.stderr[-300:])


def strict_pct(hands: list[str], pattern: str) -> float | None:
    """Share of strokes matching the pattern at one fixed alignment (no re-syncs allowed)."""
    if len(hands) < 8:
        return None
    best = 0
    for spaced in _orientations(pattern):
        flat = spaced.replace(" ", "")
        m = len(flat)
        for r in range(m):
            best = max(best, sum(h == flat[(i + r) % m] for i, h in enumerate(hands)))
    return round(100.0 * best / len(hands), 1)


def longest_clean_run(strokes: list[dict], result: dict) -> int:
    """Most consecutive strokes that match the pattern with no re-sync in between."""
    bad = {b["stroke_index"] for b in result.get("breaks", [])}
    run = best = 0
    for i, s in enumerate(strokes):
        if s["hand"] not in ("L", "R"):
            continue
        run = 0 if i in bad else run + 1
        best = max(best, run)
    return best


def shuffled_baseline(strokes: list[dict], name: str, pattern: str, n: int = 20) -> tuple[float | None, float | None]:
    """Mean sticking match and strict match for the same hands in random order (chance level)."""
    hands = [s["hand"] for s in strokes if s["hand"] in ("L", "R")]
    if len(hands) < 8:
        return None, None
    rng, scores, strict = random.Random(7), [], []
    for _ in range(n):
        h = hands[:]
        rng.shuffle(h)
        fake = [{"t": i * 0.1, "hand": x} for i, x in enumerate(h)]
        scores.append(check_sticking(fake, name, pattern)["sticking_accuracy_pct"])
        strict.append(strict_pct(h, pattern))
    return round(statistics.mean(scores), 1), round(statistics.mean(strict), 1)


def expected_left_share(pattern: str) -> float:
    p = pattern.replace(" ", "")
    return p.count("L") / len(p)


def failure_modes(row: dict) -> list[str]:
    out = []
    if row["video_degraded"] or (row["landmark_coverage"] or 0) < 0.5:
        out.append("pose not tracked on most frames")
    if row["onsets"] < 16:
        out.append("few hits detected")
    if row["onsets"] and row["heard_not_seen"] > 1.5 * max(1, row["verified"]):
        out.append("many hits heard but not seen (click, talking, other drums or hands out of view)")
    if row["seen_not_heard"] > 0.5 * max(1, row["onsets"]):
        out.append("many wrist strikes with no sound (quiet pad or strikes misread)")
    if (row["fps"] or 0) < 50:
        out.append("under 50 fps")
    if row["median_ioi_ms"] and row["median_ioi_ms"] < 70:
        out.append("very fast notes (close to the 40 ms merge limit)")
    if row["sticking_pct"] is not None:
        if row["left_share"] is not None and abs(row["left_share"] - row["expected_left_share"]) > 0.2:
            out.append("hand split far from the pattern (hands misread)")
        if row["baseline_pct"] is not None and row["sticking_pct"] - row["baseline_pct"] < 10:
            out.append("sticking match near chance")
    return out


def analyse_clip(d: dict, length: float) -> dict:
    vid = d["video_id"]
    src = CLIPS / d["file"]
    rud = find(d["rudiment"])
    work = WORK / vid
    work.mkdir(parents=True, exist_ok=True)
    info_full = probe_video(src)
    full_wav = work / "full.wav"
    if not full_wav.exists():
        extract_audio(src, full_wav, info_full)
    y, sr = load_wav(full_wav)
    full_wav.unlink(missing_ok=True)            # large; cheap to redo
    on = detect_onsets(y, sr)
    times = np.array([o["t"] for o in on])
    if times.size:
        vel = onset_velocities(y, sr, list(times))
        times = times[vel >= tuning.current().min_rel_velocity]
    start, seg_len, seg_info = find_segment(times, info_full.duration_s, length)
    seg = work / f"seg-{start:.1f}-{seg_len:.0f}.mp4"
    if not seg.exists():
        trim(src, seg, start, seg_len)
    params = {"rudiment": rud["name"], "target_bpm": None, "av_offset_ms": 0.0,
              "verify_window_ms": float(tuning.current().verify_window_ms)}
    segdir = work / seg.stem
    segdir.mkdir(exist_ok=True)
    info, audio, analysed = pipeline.analyze_file(seg, params, segdir, landmarks_cache=segdir / "landmarks.json.gz")
    strokes, v, video = analysed["strokes"], analysed["verification"], analysed["video"]
    pattern = rud["sticking"]
    st_strokes = copy.deepcopy(strokes)
    st = check_sticking(st_strokes, rud["name"], pattern) if pattern else None
    hands = [s["hand"] for s in strokes if s["hand"] in ("L", "R")]
    base, strict_base = shuffled_baseline(strokes, rud["name"], pattern) if pattern else (None, None)
    ioi = np.diff([o["t"] for o in audio["onsets"]]) if audio["onsets"] else np.array([])
    row = {
        "video_id": vid, "rudiment_number": rud["number"], "rudiment": rud["name"], "family": rud["family"],
        "supported": rud["supported"], "pattern": pattern or "", "segment_start_s": round(start, 1),
        "segment_s": round(seg_len, 1), "segment_note": json.dumps(seg_info),
        "fps": round(info.fps, 2), "height": min(info.height, info.width), "angle_frames": d.get("angle_frames"),
        "onsets": audio["onset_count"], "median_ioi_ms": round(float(np.median(ioi)) * 1000) if ioi.size else None,
        "video_strikes": v["verified_stroke_count"] + v["video_only_strikes"],
        "verified": v["verified_stroke_count"], "heard_not_seen": v["unverified_onsets"], "seen_not_heard": v["video_only_strikes"],
        "match_rate_pct": v["agreement_pct"], "verify_window_ms": v["window_ms"],
        "landmark_coverage": video.get("landmark_coverage"), "video_degraded": bool(video.get("degraded")),
        "tempo_bpm": audio["tempo_bpm"], "timing_error_ms": audio["timing"]["mean_abs_error_ms"] if audio.get("timing") else None,
        "hands_assigned": len(hands), "left_share": round(hands.count("L") / len(hands), 2) if hands else None,
        "expected_left_share": round(expected_left_share(pattern), 2) if pattern else None,
        "sticking_pct": st["sticking_accuracy_pct"] if st and st["checked"] else None,
        "baseline_pct": base,
        "strict_pct": strict_pct(hands, pattern) if pattern else None, "strict_baseline_pct": strict_base,
        "longest_clean_run": longest_clean_run(st_strokes, st) if st and st["checked"] else None,
        "wrong_hand": st["wrong_hand"] if st and st["checked"] else None,
        "resyncs": st["resyncs"] if st and st["checked"] else None,
        "sticking_note": (st.get("reason") or "") if st else rud["note"] or "",
    }
    row["lift_pct"] = round(row["sticking_pct"] - row["baseline_pct"], 1) if row["sticking_pct"] is not None and row["baseline_pct"] is not None else None
    row["failure_modes"] = "; ".join(failure_modes(row))
    return row


def med(xs):
    xs = [x for x in xs if x is not None]
    return round(statistics.median(xs), 1) if xs else None


def summarize(rows: list[dict]) -> dict:
    ok = [r for r in rows if not r.get("error")]
    sup = [r for r in ok if r["supported"] and r["sticking_pct"] is not None]
    fam = defaultdict(list)
    for r in ok:
        fam[r["family"]].append(r)
    modes = defaultdict(int)
    for r in ok:
        for m in filter(None, r["failure_modes"].split("; ")):
            modes[m] += 1
    hi = [r for r in ok if (r["fps"] or 0) >= 50]
    lo = [r for r in ok if (r["fps"] or 0) < 50]
    return {
        "clips": len(rows), "analysed": len(ok), "errors": len(rows) - len(ok),
        "rudiments": len({r["rudiment_number"] for r in ok}),
        "median_onsets": med([r["onsets"] for r in ok]), "median_match_rate_pct": med([r["match_rate_pct"] for r in ok]),
        "median_match_rate_pct_60fps": med([r["match_rate_pct"] for r in hi]), "median_match_rate_pct_under_50fps": med([r["match_rate_pct"] for r in lo]),
        "clips_60fps": len(hi), "clips_under_50fps": len(lo),
        "sticking_checked": len(sup), "median_sticking_pct": med([r["sticking_pct"] for r in sup]),
        "median_baseline_pct": med([r["baseline_pct"] for r in sup]), "median_lift_pct": med([r["lift_pct"] for r in sup]),
        "median_strict_pct": med([r["strict_pct"] for r in sup]), "median_strict_baseline_pct": med([r["strict_baseline_pct"] for r in sup]),
        "median_longest_clean_run": med([r["longest_clean_run"] for r in sup]),
        "sticking_at_least_90": sum(1 for r in sup if r["sticking_pct"] >= 90),
        "sticking_near_chance": sum(1 for r in sup if (r["lift_pct"] or 0) < 10),
        "by_family": {k: {"clips": len(v), "median_match_rate_pct": med([r["match_rate_pct"] for r in v]),
                          "median_sticking_pct": med([r["sticking_pct"] for r in v]), "median_lift_pct": med([r["lift_pct"] for r in v])}
                      for k, v in sorted(fam.items())},
        "by_angle": {k: {"clips": len(v), "median_match_rate_pct": med([r["match_rate_pct"] for r in v]),
                         "median_sticking_pct": med([r["sticking_pct"] for r in v])}
                     for k, v in sorted(_group(ok, "angle_frames").items())},
        "failure_modes": dict(sorted(modes.items(), key=lambda kv: -kv[1])),
        "settings": "production defaults (app/tuning.py), unchanged",
    }


def _group(rows, key):
    g = defaultdict(list)
    for r in rows:
        g[str(r.get(key))].append(r)
    return g


def render(summary: dict, rows: list[dict]) -> str:
    s = summary
    lines = ["# YouTube CC-BY batch (weak labels)", "",
             f"{s['analysed']} clips analysed ({s['errors']} errors) across {s['rudiments']} rudiments, production settings.", "",
             f"- Median hits per clip: {s['median_onsets']}",
             f"- Median video-to-hit match: {s['median_match_rate_pct']}% (60 fps clips {s['median_match_rate_pct_60fps']}%, under 50 fps {s['median_match_rate_pct_under_50fps']}%)",
             f"- Sticking checked on {s['sticking_checked']} clips: median {s['median_sticking_pct']}% versus {s['median_baseline_pct']}% for shuffled hands (lift {s['median_lift_pct']} points); "
             f"{s['sticking_at_least_90']} at 90% or more, {s['sticking_near_chance']} near chance",
             f"- Strict match (one alignment, no re-syncs): median {s['median_strict_pct']}% versus {s['median_strict_baseline_pct']}% for shuffled hands; "
             f"median longest clean run {s['median_longest_clean_run']} strokes", "",
             "## Failure modes", ""] + [f"- {k}: {v} clips" for k, v in s["failure_modes"].items()] + [
             "", "## By family", "", "| Family | Clips | Match | Sticking | Lift |", "|---|---|---|---|---|"] + [
             f"| {k} | {v['clips']} | {v['median_match_rate_pct']}% | {v['median_sticking_pct']} | {v['median_lift_pct']} |" for k, v in s["by_family"].items()] + [
             "", "## Clips", "", "| Rudiment | Video | fps | Hits | Match | Sticking (chance) | Strict (chance) | Clean run | Tempo | Failure modes |", "|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        if r.get("error"):
            lines.append(f"| {r['rudiment']} | {r['video_id']} | | | | | | | | error: {r['error'][:80]} |")
            continue
        stick = f"{r['sticking_pct']}% ({r['baseline_pct']}%)" if r["sticking_pct"] is not None else "n/a"
        strict = f"{r['strict_pct']}% ({r['strict_baseline_pct']}%)" if r["strict_pct"] is not None else "n/a"
        lines.append(f"| {r['rudiment']} | {r['video_id']} | {r['fps']} | {r['onsets']} | {r['match_rate_pct']}% | {stick} | {strict} | "
                     f"{r['longest_clean_run'] if r['longest_clean_run'] is not None else 'n/a'} | {r['tempo_bpm']} | {r['failure_modes']} |")
    return "\n".join(lines) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", default="")
    ap.add_argument("--segment", type=float, default=16.0)
    a = ap.parse_args(argv)
    review = {}
    if (OUT / "review.csv").exists():             # manual verdicts from eyeballing the check frames
        review = {r["video_id"]: r for r in csv.DictReader(open(OUT / "review.csv", encoding="utf-8"))}
    dls = [d for d in csv.DictReader(open(OUT / "downloads.csv", encoding="utf-8")) if d.get("status") == "ok"
           and review.get(d["video_id"], {}).get("verdict") != "exclude"]
    for d in dls:
        if review.get(d["video_id"], {}).get("angle"):
            d["angle_frames"] = review[d["video_id"]]["angle"]
    if a.only:
        dls = [d for d in dls if d["video_id"] in set(a.only.split(","))]
    rows = []
    for i, d in enumerate(dls, 1):
        t0 = time.time()
        try:
            row = analyse_clip(d, a.segment)
        except Exception as exc:
            row = {"video_id": d["video_id"], "rudiment": d["rudiment"], "error": f"{type(exc).__name__}: {exc}"}
        rows.append(row)
        print(f"[{i}/{len(dls)}] {d['video_id']} {d['rudiment']}: " + (row.get("error") or
              f"{row['onsets']} hits, match {row['match_rate_pct']}%, sticking {row['sticking_pct']} (chance {row['baseline_pct']}), "
              f"{row['failure_modes'] or 'no flags'}") + f" [{time.time() - t0:.0f} s]", flush=True)
    summary = summarize(rows)
    out = ROOT / "reports" / time.strftime("youtube-%Y%m%d-%H%M%S")
    out.mkdir(parents=True, exist_ok=True)
    fields = sorted({k for r in rows for k in r}, key=lambda k: list(rows[0]).index(k) if k in rows[0] else 999)
    for path in (out / "clips.csv", OUT / "batch-results.csv"):
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            w.writerows(rows)
    for path in (out / "summary.json", OUT / "batch-summary.json"):
        path.write_text(json.dumps(summary, indent=1), encoding="utf-8")
    (out / "report.md").write_text(render(summary, rows), encoding="utf-8")
    print(json.dumps(summary, indent=1))
    print(f"report: {out / 'report.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
