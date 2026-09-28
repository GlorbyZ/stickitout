"""Measure analyzer accuracy on the labeled training clips.

Runs the analyzer over every labeled clip in the dataset (DATASET_DIR, default
data/jobs/dataset), compares its output with the labels (app/evaluation.py) and
writes a report to reports/eval-<timestamp>/:

  report.md      readable summary (overall and per clip)
  report.html    the same, styled, for a browser
  clips.csv      one row per clip
  summary.json   everything, machine readable (input for --compare)

Usage (from the project folder; on Windows use scripts\\evaluate.ps1 with the same options):

  python scripts/evaluate.py                          all clips marked "done"
  python scripts/evaluate.py --include-drafts         also clips still being labeled
  python scripts/evaluate.py --clips ID1,ID2          only these clips
  python scripts/evaluate.py --tolerance-ms 30        stricter stroke matching (default 50 ms)
  python scripts/evaluate.py --set onset_threshold=0.25 --set min_ioi_ms=35
  python scripts/evaluate.py --tuning my-tuning.json  settings from a file
  python scripts/evaluate.py --grid onset_threshold=0.2,0.3,0.4 --grid min_ioi_ms=30,40
                                                      try every combination, rank by --objective
  python scripts/evaluate.py --compare-to reports/eval-20260926-150000
                                                      this run versus an earlier one
  python scripts/evaluate.py --compare reports/eval-A reports/eval-B
                                                      compare two finished runs, no analysis

The slow part (MediaPipe landmarks) is cached per clip in <clip>/cache, so the
second run and every grid combination only redo the fast stages. --no-cache
forces a fresh MediaPipe pass.
"""
from __future__ import annotations

import argparse
import copy
import csv
import html
import itertools
import json
import math
import re
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import config, evaluation, labels, pipeline, tuning  # noqa: E402
from app.audio import analyze_audio  # noqa: E402
from app.media import extract_audio, probe_video  # noqa: E402
from app.video import build_tracks, session_metrics  # noqa: E402

REPORTS_DIR = ROOT / "reports"
AUDIO_KEYS = ("onset_method", "onset_threshold", "onset_silence_db", "min_ioi_ms", "min_rel_velocity")
OBJECTIVES = {"f1": 1, "hand_accuracy": 1, "macro_f1": 1, "timing_error_mae_ms": -1, "tempo_error_abs_mean_bpm": -1,
              "count_error_abs_mean": -1, "sticking_detection_rate": 1, "combined": 1}


# ---------- dataset ----------
def load_clips(dataset_dir: Path, only: list[str] | None = None, include_drafts: bool = False) -> tuple[list[dict], list[str]]:
    """Labeled clips to evaluate, and notes about the ones skipped."""
    clips, skipped = [], []
    if not dataset_dir.exists():
        return clips, [f"No dataset folder at {dataset_dir}."]
    for d in sorted(p for p in dataset_dir.iterdir() if p.is_dir()):
        if only and d.name not in only:
            continue
        path = d / "labels.json"
        if not path.exists():
            continue
        try:
            doc = labels.validate(json.loads(path.read_text(encoding="utf-8")))
        except (ValueError, labels.LabelError) as exc:
            skipped.append(f"{d.name}: invalid labels.json ({exc})")
            continue
        if doc["status"] != "done" and not include_drafts:
            skipped.append(f"{d.name}: labels still a draft (mark it Done on the label page, or use --include-drafts)")
            continue
        if not doc["strokes"]:
            skipped.append(f"{d.name}: no labeled strokes")
            continue
        video = d / doc["video_file"]
        if not video.exists():
            skipped.append(f"{d.name}: video file {doc['video_file']} missing")
            continue
        clips.append({"dir": d, "labels": doc, "video": video})
    if only:
        found = {c["dir"].name for c in clips} | {s.split(":")[0] for s in skipped}
        skipped += [f"{cid}: not found in {dataset_dir}" for cid in only if cid not in found]
    return clips, skipped


# ---------- running the analyzer with caches ----------
class Runner:
    """Runs the analyzer on clips, reusing work that the current settings do not affect."""

    def __init__(self, use_cache: bool = True):
        self.use_cache = use_cache
        self.info, self.raw, self.audio, self.video = {}, {}, {}, {}

    def analyze(self, clip: dict) -> dict:
        d, video, meta = clip["dir"], clip["video"], clip["labels"]["meta"]
        key = d.name
        tune = tuning.current()
        if key not in self.info:
            self.info[key] = probe_video(video)
        info = self.info[key]
        wav = d / "audio.wav"
        if not wav.exists() or wav.stat().st_mtime < video.stat().st_mtime:
            extract_audio(video, wav, info)
        params = {"rudiment": meta.get("rudiment") or "Single Paradiddle", "target_bpm": meta.get("click_bpm"),
                  "av_offset_ms": 0.0, "verify_window_ms": float(tune.verify_window_ms)}
        akey = (key,) + tuple(getattr(tune, k) for k in AUDIO_KEYS) + (params["target_bpm"],)
        if akey not in self.audio:
            self.audio[akey] = analyze_audio(wav, params["target_bpm"])
        audio = copy.deepcopy(self.audio[akey])
        vkey = (key, tune.min_wrist_visibility)
        if vkey not in self.video:
            try:
                if key not in self.raw:
                    cache = d / "cache" / "landmarks.json.gz"
                    if not self.use_cache and cache.exists():
                        cache.unlink()
                    self.raw[key] = pipeline.landmarks(video, None, cache)
                tracks = build_tracks(self.raw[key])
                self.video[vkey] = (tracks, session_metrics(tracks))
            except Exception as exc:  # same degrade rule as the server
                self.video[vkey] = (None, pipeline.degraded_video(exc))
        tracks, vsec = self.video[vkey]
        analysed = pipeline.analyse(audio, tracks, copy.deepcopy(vsec), params, info.fps)
        return {"source": {"fps": info.fps, "duration_s": info.duration_s, "width": info.width, "height": info.height},
                "params": params, "audio": audio, **analysed}


def evaluate(clips: list[dict], runner: Runner, tolerance_ms: float | None = None, min_corr_clips: int = 5,
             progress=print) -> dict:
    """Evaluate all clips with the current tuning. Returns the summary document."""
    tune = tuning.current()
    tol = float(tolerance_ms if tolerance_ms is not None else tune.match_tolerance_ms)
    per_clip, failures = [], []
    for n, clip in enumerate(clips, 1):
        t0 = time.time()
        try:
            report = runner.analyze(clip)
        except Exception as exc:
            failures.append({"clip_id": clip["dir"].name, "error": f"{type(exc).__name__}: {exc}"})
            progress(f"  [{n}/{len(clips)}] {clip['dir'].name}: FAILED {exc}")
            continue
        m = evaluation.clip_metrics(clip["labels"], report, tol)
        per_clip.append(m)
        progress(f"  [{n}/{len(clips)}] {m['clip_id']}: F1 {_f(m['f1'], 3)}, hands {_pct(m['hand_accuracy'])}, "
                 f"count {m['count_error']:+d} ({time.time() - t0:.1f} s)")
    return {"run": {"created_at": datetime.now().isoformat(timespec="seconds"), "tolerance_ms": tol,
                    "tuning": tuning.as_dict(tune), "tuning_changed": tuning.diff(tune),
                    "engine": pipeline.ENGINE_VERSION},
            "overall": evaluation.aggregate(per_clip, min_corr_clips), "clips": per_clip, "failures": failures}


# ---------- report writing ----------
def _f(v, d=1, unit=""):
    return "n/a" if v is None else f"{v:.{d}f}{unit}"


def _pct(v):
    return "n/a" if v is None else f"{100 * v:.1f}%"


def _signed(v, d=1):
    return "n/a" if v is None else f"{v:+.{d}f}"


OVERALL_ROWS = [
    ("Stroke F1 (all strokes pooled)", "f1", _f, 3), ("Precision", "precision", _f, 3), ("Recall", "recall", _f, 3),
    ("F1, mean of clips", "macro_f1", _f, 3), ("Hit count error, mean absolute (strokes)", "count_error_abs_mean", _f, 1),
    ("Hit count error, mean absolute (%)", "count_error_pct_abs_mean", _f, 1),
    ("Hand assignment accuracy", "hand_accuracy", _pct, None), ("Hand detected at all", "hand_coverage", _pct, None),
    ("Tempo error vs click, mean absolute (BPM)", "tempo_error_abs_mean_bpm", _f, 2),
    ("Timing-error MAE (ms)", "timing_error_mae_ms", _f, 1), ("Onset placement MAE (ms)", "onset_offset_mae_ms", _f, 1),
    ("Sticking errors caught (share)", "sticking_detection_rate", _pct, None),
    ("Sticking false alarms", "sticking_false_alarms", _f, 0),
    ("Form score vs Mike's grade, Pearson r", "form_pearson", _f, 2),
    ("Form score vs Mike's grade, Spearman rho", "form_spearman", _f, 2),
]
CLIP_COLS = ["clip_id", "player", "rudiment", "surface", "camera_angle", "take_type", "fps", "labeled", "detected", "tp", "fp",
             "fn", "precision", "recall", "f1", "count_error", "count_error_pct", "hand_accuracy", "hand_coverage",
             "click_bpm", "tempo_bpm", "tempo_error_bpm", "tempo_octave_error", "label_tempo_bpm", "timing_error_mae_ms",
             "onset_offset_mae_ms", "labeled_mean_abs_timing_ms", "sticking_source", "sticking_labeled_errors",
             "sticking_caught", "sticking_missed", "sticking_false_alarms", "form_score", "form_grade", "verified_pct",
             "landmark_coverage"]


def _fmt_row(label, key, fn, d, overall):
    v = overall.get(key)
    return label, (fn(v) if d is None else fn(v, d))


def clip_row(c: dict) -> dict:
    s = c["sticking"]
    flat = {**c, "sticking_source": s["source"], "sticking_labeled_errors": s["labeled_errors"],
            "sticking_caught": s["caught"], "sticking_missed": s["missed"], "sticking_false_alarms": s["false_alarms"]}
    return {k: flat.get(k) for k in CLIP_COLS}


def _sticking_cell(c):
    s = c["sticking"]
    if s["labeled_errors"] is None:
        return s["source"]
    return f"{s['caught']}/{s['labeled_errors']} caught, {s['false_alarms']} false"


def render_markdown(summary: dict, title: str = "Analyzer accuracy report") -> str:
    run, o = summary["run"], summary["overall"]
    lines = [f"# {title}", "", f"Run {run['created_at']}, engine {run['engine']}, {o['clips']} clip(s), "
             f"{o['labeled']} labeled strokes, match tolerance plus or minus {run['tolerance_ms']:g} ms.", ""]
    changed = run.get("tuning_changed") or {}
    lines.append("Settings: " + (", ".join(f"`{k}={v}`" for k, v in changed.items()) if changed else
                                  "shipped defaults (app/tuning.py)."))
    lines += ["", "## Overall", "", "| Metric | Value |", "|---|---|"]
    for label, key, fn, d in OVERALL_ROWS:
        lines.append("| %s | %s |" % _fmt_row(label, key, fn, d, o))
    lines += ["", f"Strokes: {o['tp']} matched, {o['fp']} extra detections, {o['fn']} missed. "
              f"Sticking errors: {o['sticking_caught']} caught, {o['sticking_missed']} missed, "
              f"{o['sticking_false_alarms']} false alarms over {o['sticking_clips']} clip(s). "
              f"Tempo octave errors: {o['tempo_octave_errors']}."]
    if o["form"]["note"]:
        lines += ["", f"Form correlation: {o['form']['note']}"]
    lines += ["", "## Per clip", "",
              "| Clip | Player | Rudiment | Labeled | Detected | P | R | F1 | Count err | Hands | Tempo err (BPM) | "
              "Timing MAE (ms) | Sticking | Form / grade |",
              "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for c in summary["clips"]:
        lines.append(f"| {c['clip_id']} | {c['player'] or '-'} | {c['rudiment'] or '-'} | {c['labeled']} | {c['detected']} | "
                     f"{_f(c['precision'], 3)} | {_f(c['recall'], 3)} | {_f(c['f1'], 3)} | {c['count_error']:+d} | "
                     f"{_pct(c['hand_accuracy'])} | {_signed(c['tempo_error_bpm'], 2)}{' (octave)' if c['tempo_octave_error'] else ''} | "
                     f"{_f(c['timing_error_mae_ms'], 1)} | {_sticking_cell(c)} | {_f(c['form_score'], 0)} / "
                     f"{c['form_grade'] if c['form_grade'] is not None else '-'} |")
    if summary.get("failures"):
        lines += ["", "## Failed clips", ""] + [f"- {f['clip_id']}: {f['error']}" for f in summary["failures"]]
    if summary.get("skipped"):
        lines += ["", "## Skipped", ""] + [f"- {s}" for s in summary["skipped"]]
    lines += ["", "## How to read this", "",
              "- **F1** combines precision (detections that are real strokes) and recall (labeled strokes that were found). "
              "A detection matches a labeled stroke within the tolerance, one to one.",
              "- **Hands**: share of matched strokes given the labeled hand. A stroke with no detected hand counts as wrong.",
              "- **Timing-error MAE**: how far the analyzer's per-stroke timing error is from the labeled stroke's error "
              "against the click grid. **Onset placement MAE**: detected time versus labeled time.",
              "- **Sticking**: labeled wrong-hand strokes the analyzer flagged (caught), did not flag (missed), and flags "
              "with no labeled error nearby (false alarms).",
              "- **Form**: the analyzer's 0 to 100 form score against Mike's 1 to 10 grade, once enough clips are graded.",
              ""]
    return "\n".join(lines)


def render_compare_markdown(cmp: dict) -> str:
    lines = ["# Run comparison", "", f"A: {cmp['a'].get('created_at', '?')} {cmp['a'].get('tuning_changed') or 'defaults'}",
             f"B: {cmp['b'].get('created_at', '?')} {cmp['b'].get('tuning_changed') or 'defaults'}", "",
             "| Metric | A | B | Change | |", "|---|---|---|---|---|"]
    for r in cmp["metrics"]:
        lines.append(f"| {r['metric']} | {_f(r['a'], 4)} | {_f(r['b'], 4)} | {_signed(r['delta'], 4)} | {r['verdict']} |")
    if cmp["clips"]:
        lines += ["", "| Clip | F1 A | F1 B | Change | Hands A | Hands B | Count err A | Count err B |",
                  "|---|---|---|---|---|---|---|---|"]
        for c in cmp["clips"]:
            lines.append(f"| {c['clip_id']} | {_f(c['f1_a'], 3)} | {_f(c['f1_b'], 3)} | {_signed(c['f1_delta'], 3)} | "
                         f"{_pct(c['hand_a'])} | {_pct(c['hand_b'])} | {c['count_error_a']:+d} | {c['count_error_b']:+d} |")
    for key, label in (("only_in_a", "Only in A"), ("only_in_b", "Only in B")):
        if cmp[key]:
            lines += ["", f"{label}: {', '.join(cmp[key])}"]
    return "\n".join(lines) + "\n"


def render_html(summary: dict, extra_md: str = "") -> str:
    run, o = summary["run"], summary["overall"]
    e = html.escape

    def cls(v, good, ok, higher=True):
        if v is None:
            return ""
        return "good" if (v >= good if higher else v <= good) else "mid" if (v >= ok if higher else v <= ok) else "bad"
    tiles = [("Stroke F1", _f(o["f1"], 3), cls(o["f1"], 0.95, 0.85)),
             ("Hand accuracy", _pct(o["hand_accuracy"]), cls(o["hand_accuracy"], 0.95, 0.85)),
             ("Hit count error", _f(o["count_error_pct_abs_mean"], 1, " %"), cls(o["count_error_pct_abs_mean"], 2, 5, False)),
             ("Tempo error", _f(o["tempo_error_abs_mean_bpm"], 2, " BPM"), cls(o["tempo_error_abs_mean_bpm"], 1, 3, False)),
             ("Timing-error MAE", _f(o["timing_error_mae_ms"], 1, " ms"), cls(o["timing_error_mae_ms"], 5, 10, False)),
             ("Sticking errors caught", _pct(o["sticking_detection_rate"]), cls(o["sticking_detection_rate"], 0.9, 0.7)),
             ("Form vs grade (r)", _f(o["form_pearson"], 2), cls(o["form_pearson"], 0.7, 0.4))]
    rows = "".join(f"<tr><td>{e(label)}</td><td>{e(v)}</td></tr>" for label, v in
                   (_fmt_row(lab, k, fn, d, o) for lab, k, fn, d in OVERALL_ROWS))
    crow = "".join(
        f"<tr><td>{e(c['clip_id'])}</td><td>{e(c['player'] or '-')}</td><td>{e(c['rudiment'] or '-')}</td><td>{c['labeled']}</td>"
        f"<td>{c['detected']}</td><td>{_f(c['precision'], 3)}</td><td>{_f(c['recall'], 3)}</td>"
        f"<td class='{cls(c['f1'], 0.95, 0.85)}'>{_f(c['f1'], 3)}</td><td>{c['count_error']:+d}</td>"
        f"<td class='{cls(c['hand_accuracy'], 0.95, 0.85)}'>{_pct(c['hand_accuracy'])}</td><td>{_signed(c['tempo_error_bpm'], 2)}</td>"
        f"<td>{_f(c['timing_error_mae_ms'], 1)}</td><td>{e(_sticking_cell(c))}</td>"
        f"<td>{_f(c['form_score'], 0)} / {c['form_grade'] if c['form_grade'] is not None else '-'}</td></tr>"
        for c in summary["clips"])
    changed = run.get("tuning_changed") or {}
    settings = ", ".join(f"<code>{e(k)}={e(str(v))}</code>" for k, v in changed.items()) or "shipped defaults"
    notes = "".join(f"<li>{e(s)}</li>" for s in summary.get("skipped", []) + [f"{f['clip_id']}: {f['error']}" for f in summary.get("failures", [])])
    extra = f"<h2>Comparison</h2><pre>{e(extra_md)}</pre>" if extra_md else ""
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Analyzer accuracy report</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{{font:15px/1.5 system-ui,sans-serif;background:#faf8f2;color:#111;margin:0;padding:24px}}main{{max-width:1320px;margin:auto}}
h1{{margin:0 0 4px}}.muted{{color:#6b6b6b}}.tiles{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:16px 0}}
.tile{{background:#fff;border:1px solid #e7e2d4;border-radius:12px;padding:12px}}.tile b{{display:block;font-size:1.5rem}}
.tile span{{font-size:.82rem;color:#6b6b6b}}table{{border-collapse:collapse;width:100%;background:#fff;border:1px solid #e7e2d4;border-radius:12px;margin:10px 0 18px}}
th,td{{padding:6px 8px;border-bottom:1px solid #eee;text-align:left;font-size:.86rem;white-space:nowrap}}
.clips td:first-child,.clips td:nth-child(13){{white-space:normal;overflow-wrap:anywhere;min-width:110px}}th{{background:#111;color:#f5c518}}
.good{{color:#1f9d55;font-weight:700}}.mid{{color:#a87a00;font-weight:700}}.bad{{color:#d64545;font-weight:700}}
.tile .good,.tile .mid,.tile .bad{{font-weight:800}}code{{background:#f1ede1;padding:1px 5px;border-radius:4px}}
.logo{{background:#f5c518;border-radius:6px;padding:2px 7px;font-weight:800;margin-right:6px}}.wrap{{overflow-x:auto}}</style></head>
<body><main><h1><span class="logo">SIO</span>Analyzer accuracy report</h1>
<p class="muted">Run {e(run['created_at'])}, engine {e(run['engine'])}, {o['clips']} clip(s), {o['labeled']} labeled strokes,
match tolerance plus or minus {run['tolerance_ms']:g} ms. Settings: {settings}.</p>
<div class="tiles">{''.join(f"<div class='tile'><b class='{c}'>{e(v)}</b><span>{e(n)}</span></div>" for n, v, c in tiles)}</div>
<h2>Overall</h2><table>{rows}</table>
<p class="muted">Strokes: {o['tp']} matched, {o['fp']} extra, {o['fn']} missed. {e(o['form']['note'] or '')}</p>
<h2>Per clip</h2><div class="wrap"><table class="clips"><tr><th>Clip</th><th>Player</th><th>Rudiment</th><th>Labeled</th><th>Detected</th><th>P</th>
<th>R</th><th>F1</th><th>Count err</th><th>Hands</th><th>Tempo err</th><th>Timing MAE</th><th>Sticking</th><th>Form / grade</th></tr>{crow}</table></div>
{f'<h2>Notes</h2><ul>{notes}</ul>' if notes else ''}{extra}</main></body></html>"""


def write_report(summary: dict, out_dir: Path, compare_md: str = "") -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    md = render_markdown(summary)
    if compare_md:
        md += "\n" + compare_md
        (out_dir / "compare.md").write_text(compare_md, encoding="utf-8")
    (out_dir / "report.md").write_text(md, encoding="utf-8")
    (out_dir / "report.html").write_text(render_html(summary, compare_md), encoding="utf-8")
    with (out_dir / "clips.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=CLIP_COLS)
        w.writeheader()
        for c in summary["clips"]:
            w.writerow(clip_row(c))
    return out_dir


def run_dir(base: Path, kind: str = "eval", name: str = "") -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    d = base / f"{kind}-{stamp}{'-' + name if name else ''}"
    n = 2
    while d.exists():
        d = base / f"{kind}-{stamp}-{n}{'-' + name if name else ''}"
        n += 1
    return d


def load_summary(path: Path) -> dict:
    path = Path(path)
    return json.loads((path / "summary.json" if path.is_dir() else path).read_text(encoding="utf-8"))


# ---------- grid search ----------
def parse_grid(specs: list[str]) -> dict:
    grid = {}
    for spec in specs:
        name, _, values = spec.partition("=")
        name = name.strip()
        vals = [v for v in re.split(r"[,\s]+", values.strip()) if v]
        if not name or not vals:
            raise SystemExit(f"--grid needs name=v1,v2,... got {spec!r}")
        grid[name] = [tuning._coerce(name, v) for v in vals]
    return grid


def objective_value(overall: dict, objective: str) -> float:
    if objective == "combined":      # stroke F1 weighted with hand accuracy (both 0 to 1)
        f, h = overall.get("f1"), overall.get("hand_accuracy")
        return (0.6 * (f or 0) + 0.4 * (h if h is not None else (f or 0)))
    v = overall.get(objective)
    if v is None:
        return -math.inf
    return v * OBJECTIVES[objective]


def grid_search(clips, runner, grid: dict, base: tuning.Tuning, tolerance_ms, objective: str, min_corr: int,
                progress=print) -> tuple[list[dict], dict]:
    names = list(grid)
    results = []
    combos = list(itertools.product(*(grid[n] for n in names)))
    for k, combo in enumerate(combos, 1):
        values = dict(zip(names, combo))
        progress(f"Combination {k}/{len(combos)}: {values}")
        with tuning.override(tuning.with_values(base, values)):
            summary = evaluate(clips, runner, tolerance_ms, min_corr, progress=lambda *_: None)
        o = summary["overall"]
        results.append({"values": values, "objective": objective_value(o, objective), "summary": summary,
                        **{m: o.get(m) for m in evaluation.HEADLINE}})
        progress(f"  {objective} = {_f(results[-1]['objective'], 4)}, F1 {_f(o['f1'], 3)}, hands {_pct(o['hand_accuracy'])}")
    # Ties: higher F1, then hand accuracy, then lower timing error, then the earlier (listed first) combination.
    results.sort(key=lambda r: (r["objective"], r["f1"] or 0, r["hand_accuracy"] or 0,
                                -(r["timing_error_mae_ms"] if r["timing_error_mae_ms"] is not None else 1e9)), reverse=True)
    return results, {"names": names, "combinations": len(combos), "objective": objective}


def write_grid(results: list[dict], meta: dict, out_dir: Path, base_summary: dict | None) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    names = meta["names"]
    with (out_dir / "grid.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["rank", *names, "objective", *evaluation.HEADLINE])
        for i, r in enumerate(results, 1):
            w.writerow([i, *(r["values"][n] for n in names), r["objective"], *(r[m] for m in evaluation.HEADLINE)])
    lines = ["# Grid search", "", f"{meta['combinations']} combination(s), ranked by `{meta['objective']}` (best first).", "",
             "| Rank | " + " | ".join(names) + " | Objective | F1 | Hands | Count err % | Tempo err | Timing MAE |",
             "|---" * (len(names) + 7) + "|"]
    for i, r in enumerate(results, 1):
        lines.append(f"| {i} | " + " | ".join(str(r["values"][n]) for n in names) +
                     f" | {_f(r['objective'], 4)} | {_f(r['f1'], 3)} | {_pct(r['hand_accuracy'])} | "
                     f"{_f(r['count_error_pct_abs_mean'], 1)} | {_f(r['tempo_error_abs_mean_bpm'], 2)} | {_f(r['timing_error_mae_ms'], 1)} |")
    best = results[0]
    lines += ["", f"Best: {best['values']}. Its full report is in `best/`. To use it, copy `best-tuning.json` to "
              "`tuning.json` in the project folder and restart the server (.\\restart-server.ps1)."]
    (out_dir / "grid.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    changed = best["summary"]["run"]["tuning_changed"]
    (out_dir / "best-tuning.json").write_text(json.dumps({"_comment": "From evaluate.py grid search; copy to tuning.json.",
                                                          **changed}, indent=2), encoding="utf-8")
    cmp_md = render_compare_markdown(evaluation.compare(base_summary, best["summary"])) if base_summary else ""
    write_report(best["summary"], out_dir / "best", cmp_md)


# ---------- CLI ----------
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", type=Path, default=None, help="dataset folder (default DATASET_DIR)")
    ap.add_argument("--clips", default="", help="comma separated clip ids (default: all)")
    ap.add_argument("--include-drafts", action="store_true", help="also evaluate clips whose labels are not marked done")
    ap.add_argument("--tolerance-ms", type=float, default=None, help="stroke match tolerance (default tuning match_tolerance_ms, 50)")
    ap.add_argument("--set", action="append", default=[], metavar="NAME=VALUE", help="override one tuning setting")
    ap.add_argument("--tuning", type=Path, default=None, help="JSON file of tuning settings for this run")
    ap.add_argument("--grid", action="append", default=[], metavar="NAME=V1,V2", help="grid search over these values")
    ap.add_argument("--objective", default="f1", choices=sorted(OBJECTIVES), help="what the grid search maximises")
    ap.add_argument("--compare-to", type=Path, default=None, help="earlier run folder to compare this run against")
    ap.add_argument("--compare", nargs=2, type=Path, metavar=("RUN_A", "RUN_B"), help="compare two finished runs and exit")
    ap.add_argument("--out", type=Path, default=REPORTS_DIR, help="where report folders go (default ./reports)")
    ap.add_argument("--name", default="", help="suffix for the report folder name")
    ap.add_argument("--no-cache", action="store_true", help="re-run MediaPipe instead of using cached landmarks")
    ap.add_argument("--min-corr-clips", type=int, default=evaluation.MIN_CORR_CLIPS, help="graded clips needed for form correlation")
    a = ap.parse_args(argv)

    if a.compare:
        cmp = evaluation.compare(load_summary(a.compare[0]), load_summary(a.compare[1]))
        md = render_compare_markdown(cmp)
        out = run_dir(a.out, "compare", a.name)
        out.mkdir(parents=True, exist_ok=True)
        (out / "compare.md").write_text(md, encoding="utf-8")
        (out / "compare.json").write_text(json.dumps(cmp, indent=2), encoding="utf-8")
        print(md)
        print(f"Saved to {out}")
        return 0

    values = {}
    if a.tuning:
        values.update(tuning.load_file(a.tuning))
    for spec in a.set:
        name, sep, value = spec.partition("=")
        if not sep:
            raise SystemExit(f"--set needs name=value, got {spec!r}")
        values[name.strip()] = value.strip()
    try:
        base = tuning.with_values(tuning.current(), values)
        grid = parse_grid(a.grid)
    except ValueError as exc:
        raise SystemExit(str(exc))

    dataset_dir = a.dataset or config.DATASET_DIR
    only = [c.strip() for c in a.clips.split(",") if c.strip()] or None
    clips, skipped = load_clips(Path(dataset_dir), only, a.include_drafts)
    print(f"Dataset {dataset_dir}: {len(clips)} clip(s) to evaluate.")
    for s in skipped:
        print(f"  skipped {s}")
    if not clips:
        print("Nothing to evaluate. Label clips on the /label page and mark them Done (or pass --include-drafts).")
        return 1
    runner = Runner(use_cache=not a.no_cache)
    previous = load_summary(a.compare_to) if a.compare_to else None

    if grid:
        out = run_dir(a.out, "grid", a.name)
        print("Baseline (settings before the grid):")
        with tuning.override(base):
            base_summary = evaluate(clips, runner, a.tolerance_ms, a.min_corr_clips)
        base_summary["skipped"] = skipped
        write_report(base_summary, out / "baseline")
        results, meta = grid_search(clips, runner, grid, base, a.tolerance_ms, a.objective, a.min_corr_clips)
        for r in results:
            r["summary"]["skipped"] = skipped
        write_grid(results, meta, out, base_summary)
        print((out / "grid.md").read_text(encoding="utf-8"))
        print(f"Saved to {out}")
        return 0

    with tuning.override(base):
        summary = evaluate(clips, runner, a.tolerance_ms, a.min_corr_clips)
    summary["skipped"] = skipped
    cmp_md = render_compare_markdown(evaluation.compare(previous, summary)) if previous else ""
    out = write_report(summary, run_dir(a.out, "eval", a.name), cmp_md)
    print()
    print(render_markdown(summary).split("## Per clip")[0].rstrip())
    if cmp_md:
        print()
        print(cmp_md)
    print(f"\nReport: {out / 'report.md'}\n        {out / 'report.html'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
