"""Accuracy metrics: the analyzer's output for a clip versus the labels a person made.

Pure functions (no files, no MediaPipe) so they are easy to test; scripts/evaluate.py
does the running, caching and report writing.

Per clip (clip_metrics):
  * strokes: detected strokes are matched one-to-one to labeled strokes within
    +/- tolerance_ms, closest pairs first. precision, recall, F1, hit count error.
  * hands: share of matched strokes whose detected hand equals the labeled hand
    (a stroke with no detected hand counts as wrong; hand_coverage says how often
    a hand was detected at all).
  * sticking errors: labeled wrong-hand strokes versus the analyzer's wrong_hand
    breaks: caught, missed, false alarms. Labeled errors are the strokes flagged
    sticking_error (when meta.sticking_errors_marked is set or any stroke is
    flagged); otherwise they are derived by running the sticking check on the
    labeled hands, for rudiments the check covers.
  * tempo: analyzer tempo versus the click BPM, and versus the tempo implied by
    the labeled strokes.
  * timing: onset placement error (detected time minus labeled time, MAE) and the
    timing-error MAE: the analyzer's per-stroke timing error versus the labeled
    stroke's error against the click grid (or a grid fitted to the labels when
    there is no click BPM).
  * form: the analyzer's form score next to Mike's 1 to 10 grade; the correlation
    is computed across clips in aggregate() once there are enough graded clips.

Only the evaluation region counts: meta.eval_start_s to meta.eval_end_s when set;
otherwise from just after the sync clap (meta.clap_t + 0.25 s) to the end.
"""
from __future__ import annotations

import bisect
import copy
import math

import numpy as np

from .audio import fit_grid, grid_indices
from .sticking import applies_to, check_sticking

CLAP_GUARD_S = 0.25
DEFAULT_NOTES_PER_BEAT = 4
MIN_CORR_CLIPS = 5

# Direction of "better" for each headline metric (used by compare()).
HIGHER_BETTER = {"precision", "recall", "f1", "macro_f1", "hand_accuracy", "hand_coverage", "sticking_detection_rate",
                 "form_pearson", "form_spearman"}
LOWER_BETTER = {"count_error_abs_mean", "count_error_pct_abs_mean", "tempo_error_abs_mean_bpm", "timing_error_mae_ms",
                "onset_offset_mae_ms", "sticking_false_alarms", "sticking_missed", "fp", "fn"}


def match(label_t: list[float], det_t: list[float], tolerance_ms: float) -> list[tuple[int, int, float]]:
    """One-to-one matches (label index, detection index, det - label seconds), closest pairs first."""
    tol = tolerance_ms / 1000.0
    order = sorted(range(len(det_t)), key=lambda j: det_t[j])
    sorted_det = [det_t[j] for j in order]
    pairs = []
    for i, t in enumerate(label_t):
        lo = bisect.bisect_left(sorted_det, t - tol - 1e-9)
        hi = bisect.bisect_right(sorted_det, t + tol + 1e-9)
        for k in range(lo, hi):
            j = order[k]
            pairs.append((abs(det_t[j] - t), i, j))
    pairs.sort()
    used_l, used_d, out = set(), set(), []
    for d, i, j in pairs:
        if i not in used_l and j not in used_d:
            used_l.add(i)
            used_d.add(j)
            out.append((i, j, det_t[j] - label_t[i]))
    return sorted(out)


def region(meta: dict, duration: float | None = None) -> tuple[float, float]:
    start = meta.get("eval_start_s")
    if start is None:
        start = (meta["clap_t"] + CLAP_GUARD_S) if meta.get("clap_t") is not None else 0.0
    end = meta.get("eval_end_s")
    if end is None:
        end = duration if duration else math.inf
    return float(start), float(end)


def _prf(tp: int, fp: int, fn: int) -> tuple[float | None, float | None, float | None]:
    p = tp / (tp + fp) if tp + fp else None
    r = tp / (tp + fn) if tp + fn else None
    f = 2 * p * r / (p + r) if p and r else (0.0 if (p is not None and r is not None) else None)
    return p, r, f


def labeled_grid_errors(times: np.ndarray, click_bpm: float | None, notes_per_beat: int) -> tuple[np.ndarray, float | None]:
    """Each labeled stroke's timing error (ms) against the click grid, and the tempo implied by the labels.

    With a click BPM the grid spacing is fixed and only its phase is fitted (circular mean);
    without one the grid is fitted to the labels the same way the analyzer fits onsets.
    """
    if len(times) < 4:
        return np.array([]), None
    ioi = float(np.median(np.diff(times)))
    step_guess = 60.0 / click_bpm / notes_per_beat if click_bpm else ioi
    idx = grid_indices(times, step_guess)
    t0_fit, fitted_step = fit_grid(times, idx)
    label_bpm = 60.0 / (fitted_step * notes_per_beat) if fitted_step > 0 else None
    if click_bpm:
        step = step_guess
        phase = float(np.angle(np.mean(np.exp(2j * np.pi * times / step)))) / (2 * np.pi) * step
    else:
        phase, step = t0_fit, fitted_step
    err = times - phase
    err = err - step * np.round(err / step)
    return err * 1000.0, label_bpm


def labeled_sticking_errors(strokes: list[dict], meta: dict) -> tuple[list[int] | None, str]:
    """Indexes (into strokes) of labeled wrong-hand strokes, and where they came from."""
    if meta.get("sticking_errors_marked") or any(s.get("sticking_error") for s in strokes):
        return [i for i, s in enumerate(strokes) if s.get("sticking_error")], "marked"
    if not applies_to(meta.get("rudiment")):
        return None, "not applicable"
    seq = [{"t": s["t"], "hand": s["hand"]} for s in strokes]
    res = check_sticking(seq, meta.get("rudiment"))
    if not res["checked"]:
        return None, "not enough labeled hands"
    return [b["stroke_index"] for b in res["breaks"] if b["kind"] == "wrong_hand"], "derived from labeled hands"


def clip_metrics(labels_doc: dict, report: dict, tolerance_ms: float) -> dict:
    meta = labels_doc["meta"]
    duration = report.get("source", {}).get("duration_s")
    start, end = region(meta, duration)
    inside = lambda t: start <= t <= end  # noqa: E731
    gt = [s for s in labels_doc["strokes"] if inside(s["t"])]
    det = [s for s in report.get("strokes", []) if inside(s["t"])]
    pairs = match([s["t"] for s in gt], [s["t"] for s in det], tolerance_ms)
    tp = len(pairs)
    fp, fn = len(det) - tp, len(gt) - tp
    p, r, f = _prf(tp, fp, fn)

    with_hand = [(i, j) for i, j, _ in pairs if gt[i]["hand"] in ("L", "R")]
    hand_ok = sum(1 for i, j in with_hand if det[j].get("hand") == gt[i]["hand"])
    hand_known = sum(1 for i, j in with_hand if det[j].get("hand") in ("L", "R"))
    offsets = np.array([d * 1000.0 for _, _, d in pairs])

    click = meta.get("click_bpm")
    npb = meta.get("notes_per_beat") or (report.get("audio", {}).get("grid") or {}).get("subdivision") or DEFAULT_NOTES_PER_BEAT
    gt_times = np.array([s["t"] for s in gt])
    gt_err, label_bpm = labeled_grid_errors(gt_times, click, int(npb))
    timing_diff = np.array([abs(det[j]["timing_error_ms"] - gt_err[i]) for i, j, _ in pairs
                            if gt_err.size and det[j].get("timing_error_ms") is not None])

    tempo = report.get("audio", {}).get("tempo_bpm")
    tempo_err = round(tempo - click, 2) if tempo is not None and click else None
    octave = bool(tempo and click and min(abs(tempo / click - 2), abs(tempo / click - 0.5)) < 0.06)

    gt_err_idx, stick_source = labeled_sticking_errors(gt, meta)
    det_breaks = [b["t"] for b in (report.get("sticking") or {}).get("breaks", []) if b.get("kind") == "wrong_hand" and inside(b["t"])]
    sticking = {"source": stick_source, "labeled_errors": None, "caught": None, "missed": None, "false_alarms": None,
                "detection_rate": None, "checked_by_analyzer": bool((report.get("sticking") or {}).get("checked"))}
    if gt_err_idx is not None:
        err_t = [gt[i]["t"] for i in gt_err_idx]
        spairs = match(err_t, det_breaks, tolerance_ms)
        caught = len(spairs)
        sticking.update(labeled_errors=len(err_t), caught=caught, missed=len(err_t) - caught,
                        false_alarms=len(det_breaks) - caught,
                        detection_rate=round(caught / len(err_t), 4) if err_t else None)

    return {
        "clip_id": labels_doc["clip_id"],
        "player": meta.get("player") or "", "rudiment": meta.get("rudiment") or "", "surface": meta.get("surface"),
        "camera_angle": meta.get("camera_angle"), "take_type": meta.get("take_type"), "fps": report.get("source", {}).get("fps"),
        "region_s": [round(start, 3), None if math.isinf(end) else round(end, 3)],
        "tolerance_ms": tolerance_ms,
        "labeled": len(gt), "detected": len(det), "tp": tp, "fp": fp, "fn": fn,
        "precision": _r(p), "recall": _r(r), "f1": _r(f),
        "count_error": len(det) - len(gt),
        "count_error_pct": _r(100.0 * (len(det) - len(gt)) / len(gt), 2) if gt else None,
        "hand_pairs": len(with_hand), "hand_correct": hand_ok,
        "hand_accuracy": _r(hand_ok / len(with_hand)) if with_hand else None,
        "hand_coverage": _r(hand_known / len(with_hand)) if with_hand else None,
        "onset_offset_mean_ms": _r(float(offsets.mean()), 2) if offsets.size else None,
        "onset_offset_mae_ms": _r(float(np.abs(offsets).mean()), 2) if offsets.size else None,
        "timing_error_mae_ms": _r(float(timing_diff.mean()), 2) if timing_diff.size else None,
        "timing_pairs": int(timing_diff.size),
        "labeled_mean_abs_timing_ms": _r(float(np.abs(gt_err).mean()), 2) if gt_err.size else None,
        "click_bpm": click, "tempo_bpm": tempo, "tempo_error_bpm": tempo_err, "tempo_octave_error": octave,
        "label_tempo_bpm": _r(label_bpm, 2),
        "tempo_error_vs_labels_bpm": _r(tempo - label_bpm, 2) if tempo is not None and label_bpm else None,
        "sticking": sticking,
        "form_score": (report.get("scores") or {}).get("form"), "form_grade": meta.get("form_grade"),
        "verified_pct": (report.get("scores") or {}).get("verified"),
        "landmark_coverage": (report.get("video") or {}).get("landmark_coverage"),
    }


def _pearson(x: np.ndarray, y: np.ndarray) -> float | None:
    if len(x) < 2 or np.std(x) == 0 or np.std(y) == 0:
        return None
    return float(np.corrcoef(x, y)[0, 1])


def _ranks(v: np.ndarray) -> np.ndarray:
    order = np.argsort(v, kind="mergesort")
    ranks = np.empty(len(v))
    ranks[order] = np.arange(len(v), dtype=float)
    for val in np.unique(v):                     # average ranks for ties
        m = v == val
        ranks[m] = ranks[m].mean()
    return ranks


def aggregate(clips: list[dict], min_corr_clips: int = MIN_CORR_CLIPS) -> dict:
    tp = sum(c["tp"] for c in clips)
    fp = sum(c["fp"] for c in clips)
    fn = sum(c["fn"] for c in clips)
    p, r, f = _prf(tp, fp, fn)
    f1s = [c["f1"] for c in clips if c["f1"] is not None]
    hp = sum(c["hand_pairs"] for c in clips)
    hc = sum(c["hand_correct"] for c in clips)
    hk = sum(round((c["hand_coverage"] or 0) * c["hand_pairs"]) for c in clips)
    tempo = [abs(c["tempo_error_bpm"]) for c in clips if c["tempo_error_bpm"] is not None]
    tw = [(c["timing_error_mae_ms"], c["timing_pairs"]) for c in clips if c["timing_error_mae_ms"] is not None]
    ow = [(c["onset_offset_mae_ms"], c["tp"]) for c in clips if c["onset_offset_mae_ms"] is not None]
    st = [c["sticking"] for c in clips if c["sticking"]["labeled_errors"] is not None]
    caught = sum(s["caught"] for s in st)
    missed = sum(s["missed"] for s in st)
    graded = [(c["form_score"], c["form_grade"]) for c in clips if c["form_score"] is not None and c["form_grade"] is not None]
    form = {"clips_graded": len(graded), "min_clips": min_corr_clips, "pearson": None, "spearman": None, "note": None}
    if len(graded) >= min_corr_clips:
        x, y = np.array([g[0] for g in graded], float), np.array([g[1] for g in graded], float)
        form["pearson"] = _r(_pearson(x, y))
        form["spearman"] = _r(_pearson(_ranks(x), _ranks(y)))
        if form["pearson"] is None:
            form["note"] = "Scores or grades do not vary, so no correlation."
    else:
        form["note"] = (f"Needs at least {min_corr_clips} clips with both a form score and Mike's grade "
                        f"(have {len(graded)}).")
    return {
        "clips": len(clips), "labeled": sum(c["labeled"] for c in clips), "detected": sum(c["detected"] for c in clips),
        "tp": tp, "fp": fp, "fn": fn, "precision": _r(p), "recall": _r(r), "f1": _r(f),
        "macro_f1": _r(float(np.mean(f1s))) if f1s else None,
        "count_error_total": sum(c["count_error"] for c in clips),
        "count_error_abs_mean": _r(float(np.mean([abs(c["count_error"]) for c in clips])), 2) if clips else None,
        "count_error_pct_abs_mean": _r(float(np.mean([abs(c["count_error_pct"]) for c in clips if c["count_error_pct"] is not None])), 2)
        if any(c["count_error_pct"] is not None for c in clips) else None,
        "hand_accuracy": _r(hc / hp) if hp else None, "hand_coverage": _r(hk / hp) if hp else None,
        "tempo_clips": len(tempo), "tempo_error_abs_mean_bpm": _r(float(np.mean(tempo)), 2) if tempo else None,
        "tempo_octave_errors": sum(1 for c in clips if c["tempo_octave_error"]),
        "timing_error_mae_ms": _r(sum(m * n for m, n in tw) / sum(n for _, n in tw), 2) if tw and sum(n for _, n in tw) else None,
        "onset_offset_mae_ms": _r(sum(m * n for m, n in ow) / sum(n for _, n in ow), 2) if ow and sum(n for _, n in ow) else None,
        "sticking_clips": len(st), "sticking_labeled_errors": sum(s["labeled_errors"] for s in st),
        "sticking_caught": caught, "sticking_missed": missed,
        "sticking_false_alarms": sum(s["false_alarms"] for s in st),
        "sticking_detection_rate": _r(caught / (caught + missed)) if caught + missed else None,
        "form_pearson": form["pearson"], "form_spearman": form["spearman"], "form": form,
    }


HEADLINE = ["f1", "precision", "recall", "macro_f1", "count_error_abs_mean", "count_error_pct_abs_mean", "hand_accuracy",
            "hand_coverage", "tempo_error_abs_mean_bpm", "timing_error_mae_ms", "onset_offset_mae_ms",
            "sticking_detection_rate", "sticking_false_alarms", "form_pearson", "form_spearman"]


def compare(a: dict, b: dict) -> dict:
    """Run b versus run a (both evaluate.py summary.json documents)."""
    rows = []
    for k in HEADLINE:
        va, vb = a["overall"].get(k), b["overall"].get(k)
        delta = round(vb - va, 4) if isinstance(va, (int, float)) and isinstance(vb, (int, float)) else None
        verdict = "same"
        if delta is None:
            verdict = "n/a"
        elif abs(delta) > 1e-9:
            better = delta > 0 if k in HIGHER_BETTER else delta < 0
            verdict = "better" if better else "worse"
        rows.append({"metric": k, "a": va, "b": vb, "delta": delta, "verdict": verdict})
    ca = {c["clip_id"]: c for c in a["clips"]}
    clips = []
    for c in b["clips"]:
        if c["clip_id"] in ca:
            o = ca[c["clip_id"]]
            clips.append({"clip_id": c["clip_id"], "f1_a": o["f1"], "f1_b": c["f1"],
                          "f1_delta": round(c["f1"] - o["f1"], 4) if c["f1"] is not None and o["f1"] is not None else None,
                          "hand_a": o["hand_accuracy"], "hand_b": c["hand_accuracy"],
                          "count_error_a": o["count_error"], "count_error_b": c["count_error"]})
    return {"a": a.get("run", {}), "b": b.get("run", {}), "metrics": rows, "clips": clips,
            "only_in_a": sorted(set(ca) - {c["clip_id"] for c in b["clips"]}),
            "only_in_b": sorted({c["clip_id"] for c in b["clips"]} - set(ca))}


def _r(v, n: int = 4):
    return None if v is None or (isinstance(v, float) and not math.isfinite(v)) else round(float(v), n)


def deep(obj):
    return copy.deepcopy(obj)
