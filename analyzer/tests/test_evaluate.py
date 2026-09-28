"""Accuracy evaluation (app/evaluation.py, scripts/evaluate.py) and the tuning settings
(app/tuning.py): metric maths on hand-built cases, then an end-to-end run on the synthetic
paradiddle drummer whose strokes are known exactly, which must score near perfect."""
import csv
import json
import shutil

import pytest

from app import dataset, evaluation, labels, tuning


# ---------- tuning ----------
def test_tuning_sources_and_override(tmp_path, monkeypatch):
    assert tuning.Tuning().onset_threshold == 0.3 and tuning.Tuning().min_ioi_ms == 40.0
    f = tmp_path / "tuning.json"
    f.write_text(json.dumps({"_comment": "test", "onset_threshold": 0.25, "hand_source": "strike_first"}))
    monkeypatch.setenv("TUNING_FILE", str(f))
    monkeypatch.setenv("SIO_TUNE_MIN_IOI_MS", "35")
    try:
        t = tuning.reload()
        assert (t.onset_threshold, t.hand_source, t.min_ioi_ms) == (0.25, "strike_first", 35.0)
        with tuning.override({"onset_threshold": 0.5}):
            assert tuning.current().onset_threshold == 0.5 and tuning.current().min_ioi_ms == 35.0
        assert tuning.current().onset_threshold == 0.25
        assert tuning.diff(t) == {"onset_threshold": 0.25, "hand_source": "strike_first", "min_ioi_ms": 35.0}
    finally:
        monkeypatch.delenv("TUNING_FILE")
        monkeypatch.delenv("SIO_TUNE_MIN_IOI_MS")
        tuning.reload()
    temp = tmp_path / "tuning.temp.json"
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(tuning, "ROOT", tmp_path)
    temp.write_text(json.dumps({"strike_min_prominence": 0.015}))
    monkeypatch.setenv("SIO_TEMP_TRAINING", "1")
    try:
        assert tuning.reload().strike_min_prominence == 0.015
    finally:
        monkeypatch.delenv("SIO_TEMP_TRAINING")
        tuning.reload()
    with pytest.raises(ValueError, match="Unknown tuning setting"):
        tuning.with_values(tuning.Tuning(), {"onset_sensitivity": 1})
    with pytest.raises(ValueError, match="hand_source"):
        tuning.with_values(tuning.Tuning(), {"hand_source": "guess"})


def test_tuning_changes_the_analysis(tmp_path):
    """min_ioi_ms really reaches the onset detector: a huge minimum spacing drops most hits."""
    from app.audio import analyze_audio
    from scripts.make_click_test import write_click_wav
    wav = write_click_wav(tmp_path / "c.wav", bpm=100.0, duration_s=6.0, per_beat=4)
    normal = analyze_audio(wav)["onset_count"]
    with tuning.override({"min_ioi_ms": 400}):
        sparse = analyze_audio(wav)["onset_count"]
    assert normal >= 38 and sparse < normal / 2


# ---------- metric maths ----------
def test_match_is_one_to_one_closest_first():
    pairs = evaluation.match([1.0, 1.05, 2.0], [1.04, 1.01, 3.0], 50)
    assert [(i, j) for i, j, _ in pairs] == [(0, 1), (1, 0)]
    assert evaluation.match([1.0], [1.06], 50) == []


def _doc(strokes, **meta):
    d = labels.new_labels("clip-test-01", "video.mp4", "x.mp4", "upload", "t")
    d["meta"].update(meta)
    d["strokes"] = [{"t": t, "hand": h, "type": "normal", "sticking_error": e, "source": "manual", "edited": False}
                    for t, h, e in strokes]
    return labels.validate(d)


def _report(strokes, tempo=100.0, breaks=(), form=None, duration=20.0):
    return {"source": {"duration_s": duration, "fps": 60.0}, "audio": {"tempo_bpm": tempo, "grid": {"subdivision": 4}},
            "strokes": [{"t": t, "hand": h, "timing_error_ms": 0.0} for t, h in strokes],
            "sticking": {"checked": True, "breaks": [{"kind": "wrong_hand", "t": t} for t in breaks]},
            "scores": {"form": form, "verified": 90.0}, "video": {"landmark_coverage": 0.9}}


def test_clip_metrics_counts_hands_tempo_and_sticking():
    step = 0.15
    gt = [(1.0 + i * step, "RL"[i % 2], i == 5) for i in range(20)]            # stroke 5 is a marked sticking error
    det = [(t + 0.004, h) for t, h, _ in gt]
    del det[3]                                                                 # one missed stroke
    det.append((10.0, "L"))                                                    # one extra detection
    det[7] = (det[7][0], "L" if det[7][1] == "R" else "R")                     # one wrong hand
    m = evaluation.clip_metrics(_doc(gt, click_bpm=100, rudiment="Single Stroke Roll"),
                                _report(det, tempo=101.5, breaks=[gt[5][0] + 0.01, 5.0]), 50)
    assert (m["labeled"], m["detected"], m["tp"], m["fp"], m["fn"]) == (20, 20, 19, 1, 1)
    assert m["precision"] == pytest.approx(0.95) and m["recall"] == pytest.approx(0.95) and m["f1"] == pytest.approx(0.95)
    assert m["count_error"] == 0 and m["hand_accuracy"] == pytest.approx(18 / 19, abs=1e-4)
    assert m["onset_offset_mae_ms"] == pytest.approx(4.0, abs=0.01)
    assert m["tempo_error_bpm"] == 1.5 and not m["tempo_octave_error"]
    s = m["sticking"]
    assert (s["source"], s["labeled_errors"], s["caught"], s["missed"], s["false_alarms"]) == ("marked", 1, 1, 0, 1)


def test_sticking_errors_derived_from_labeled_hands_and_clap_region():
    pattern = "RLRRLRLL" * 4
    hands = list(pattern)
    hands[10] = "L" if hands[10] == "R" else "R"                               # a flipped stroke, not flagged by hand
    gt = [(1.0 + i * 0.15, h, False) for i, h in enumerate(hands)]
    doc = _doc([(0.5, "R", False)] + gt, rudiment="Single Paradiddle", click_bpm=100, clap_t=0.5)
    m = evaluation.clip_metrics(doc, _report([(t, h) for t, h, _ in gt]), 50)
    assert m["labeled"] == len(gt)                                             # the clap stroke is outside the region
    assert m["sticking"]["source"] == "derived from labeled hands"
    assert m["sticking"]["labeled_errors"] == 1 and m["sticking"]["missed"] == 1 and m["sticking"]["caught"] == 0


def test_timing_error_mae_against_click_grid():
    step = 60 / 100 / 4
    gt_times = [2.0 + i * step + (0.010 if i % 4 == 1 else 0.0) for i in range(24)]   # every 4th+1 stroke 10 ms late
    doc = _doc([(t, "R", False) for t in gt_times], click_bpm=100)
    rep = _report([(t, "R") for t in gt_times])
    exact = [(0.010 if i % 4 == 1 else 0.0) * 1000 for i in range(24)]
    mean = sum(exact) / len(exact)
    for s, e in zip(rep["strokes"], exact):
        s["timing_error_ms"] = e - mean                                        # what a perfect analyzer reports
    m = evaluation.clip_metrics(doc, rep, 50)
    assert m["timing_error_mae_ms"] < 0.5 and m["label_tempo_bpm"] == pytest.approx(100, abs=0.5)
    for s in rep["strokes"]:
        s["timing_error_ms"] = 0.0                                             # an analyzer that hears no timing error
    assert evaluation.clip_metrics(doc, rep, 50)["timing_error_mae_ms"] > 2


def test_form_correlation_needs_enough_clips():
    clips = []
    for i, (score, grade) in enumerate([(40, 3), (55, 5), (60, 6), (72, 7), (90, 9)]):
        doc = _doc([(1.0, "R", False)], form_grade=grade)
        doc["clip_id"] = f"clip-test-{i:02d}"
        clips.append(evaluation.clip_metrics(doc, _report([(1.0, "R")], form=score), 50))
    few = evaluation.aggregate(clips[:3])
    assert few["form_pearson"] is None and "at least 5" in few["form"]["note"]
    agg = evaluation.aggregate(clips)
    assert agg["form_pearson"] > 0.95 and agg["form_spearman"] == pytest.approx(1.0)


def test_compare_marks_better_and_worse():
    a = {"run": {}, "overall": {"f1": 0.9, "timing_error_mae_ms": 6.0}, "clips": [{"clip_id": "c1", "f1": 0.9, "hand_accuracy": 0.8, "count_error": 2}]}
    b = {"run": {}, "overall": {"f1": 0.95, "timing_error_mae_ms": 7.0}, "clips": [{"clip_id": "c1", "f1": 0.95, "hand_accuracy": 0.9, "count_error": 0}]}
    rows = {r["metric"]: r for r in evaluation.compare(a, b)["metrics"]}
    assert rows["f1"]["verdict"] == "better" and rows["timing_error_mae_ms"]["verdict"] == "worse"
    assert rows["hand_accuracy"]["verdict"] == "n/a"
    assert evaluation.compare(a, b)["clips"][0]["f1_delta"] == pytest.approx(0.05)


# ---------- end to end on the synthetic drummer ----------
@pytest.fixture(scope="module")
def labeled_dataset(tmp_path_factory):
    """Two labeled clips from one synthetic drummer video (60 fps, 8 s, 100 BPM paradiddles):
    'clean' with the exact known strokes, and 'sloppy' where two strokes are labeled with the other
    hand and flagged as sticking mistakes (which the analyzer cannot see, so it must miss them)."""
    from scripts.make_test_video import make_video, paradiddle_strokes
    root = tmp_path_factory.mktemp("eval")
    try:
        video = make_video(root / "drummer.mp4", fps=60, seconds=8.0, bpm=100.0, drummer=True)
    except OSError as exc:
        pytest.skip(f"could not fetch the test photo: {exc}")
    ds = root / "dataset"
    old = dataset.DATASET_DIR
    dataset.DATASET_DIR = ds
    try:
        clip_id, path = dataset.create("clean take.mp4", ".mp4", "upload", {"rudiment": "Single Paradiddle", "click_bpm": 100,
                                                                            "player": "Synthetic", "form_grade": 8})
        shutil.copy(video, path)
        dataset.process(clip_id)
        report = json.loads((ds / clip_id / "analysis.json").read_text())
        if report["video"]["degraded"] and "failed" in (report["video"]["degraded_reason"] or ""):
            pytest.skip(f"MediaPipe unavailable here: {report['video']['degraded_reason']}")
        doc = dataset.read_labels(clip_id)
        doc.update(strokes=paradiddle_strokes(8.0, 100.0), status="done")
        dataset.save_labels(clip_id, doc)
        sloppy = clip_id.replace("clean", "sloppy")
        shutil.copytree(ds / clip_id, ds / sloppy)                              # includes the landmarks cache
        doc = json.loads((ds / sloppy / "labels.json").read_text())
        doc["clip_id"] = sloppy
        for i in (13, 29):
            s = doc["strokes"][i]
            s.update(hand="L" if s["hand"] == "R" else "R", sticking_error=True)
        doc["meta"].update(sticking_errors_marked=True, take_type="sloppy", form_grade=4)
        (ds / sloppy / "labels.json").write_text(json.dumps(labels.validate(doc)))
    finally:
        dataset.DATASET_DIR = old
    return ds, clip_id, sloppy


def test_evaluate_synthetic_near_perfect(labeled_dataset, tmp_path):
    from scripts import evaluate
    ds, clean, sloppy = labeled_dataset
    assert evaluate.main(["--dataset", str(ds), "--out", str(tmp_path), "--clips", clean]) == 0
    out = next(tmp_path.glob("eval-*"))
    for name in ("report.md", "report.html", "clips.csv", "summary.json"):
        assert (out / name).exists(), name
    summary = json.loads((out / "summary.json").read_text())
    o, c = summary["overall"], summary["clips"][0]
    assert c["labeled"] == 53
    assert o["f1"] >= 0.98 and o["precision"] >= 0.98 and o["recall"] >= 0.98
    assert abs(c["count_error"]) <= 1
    assert o["hand_accuracy"] >= 0.95
    assert abs(c["tempo_error_bpm"]) < 1.0
    assert o["timing_error_mae_ms"] < 5 and o["onset_offset_mae_ms"] < 10
    assert c["sticking"]["labeled_errors"] == 0 and c["sticking"]["false_alarms"] <= 1
    rows = list(csv.DictReader((out / "clips.csv").open(encoding="utf-8")))
    assert rows[0]["clip_id"] == clean and float(rows[0]["f1"]) >= 0.98
    md = (out / "report.md").read_text(encoding="utf-8")
    assert "Stroke F1" in md and clean in md and "\u2014" not in md


def test_evaluate_sloppy_labels_compare_and_grid(labeled_dataset, tmp_path):
    from scripts import evaluate
    ds, clean, sloppy = labeled_dataset
    assert evaluate.main(["--dataset", str(ds), "--out", str(tmp_path), "--name", "base"]) == 0
    base = next(tmp_path.glob("eval-*-base"))
    s = json.loads((base / "summary.json").read_text())
    by = {c["clip_id"]: c for c in s["clips"]}
    st = by[sloppy]["sticking"]
    assert st["source"] == "marked" and st["labeled_errors"] == 2 and st["missed"] == 2 and st["caught"] == 0
    assert by[sloppy]["hand_accuracy"] < by[clean]["hand_accuracy"]
    assert s["overall"]["sticking_missed"] == 2

    # A setting that clearly hurts (huge minimum stroke spacing) must show up as worse in the comparison.
    assert evaluate.main(["--dataset", str(ds), "--out", str(tmp_path), "--name", "worse", "--set", "min_ioi_ms=300",
                          "--compare-to", str(base)]) == 0
    worse = next(tmp_path.glob("eval-*-worse"))
    cmp_md = (worse / "compare.md").read_text()
    assert "| f1 |" in cmp_md and "worse" in cmp_md
    assert json.loads((worse / "summary.json").read_text())["run"]["tuning_changed"] == {"min_ioi_ms": 300.0}
    assert evaluate.main(["--compare", str(base), str(worse), "--out", str(tmp_path)]) == 0
    assert list(tmp_path.glob("compare-*/compare.json"))

    assert evaluate.main(["--dataset", str(ds), "--out", str(tmp_path), "--clips", clean,
                          "--grid", "min_ioi_ms=40,300", "--grid", "hand_source=velocity,strike_first"]) == 0
    grid = next(tmp_path.glob("grid-*"))
    rows = list(csv.DictReader((grid / "grid.csv").open(encoding="utf-8")))
    assert len(rows) == 4 and float(rows[0]["min_ioi_ms"]) == 40.0 and float(rows[0]["f1"]) >= 0.98
    best = json.loads((grid / "best-tuning.json").read_text())
    assert best.get("min_ioi_ms", 40.0) == 40.0
    assert (grid / "best" / "report.md").exists() and (grid / "baseline" / "summary.json").exists()


def test_evaluate_reports_empty_dataset(tmp_path, capsys):
    from scripts import evaluate
    assert evaluate.main(["--dataset", str(tmp_path / "none"), "--out", str(tmp_path)]) == 1
    assert "Nothing to evaluate" in capsys.readouterr().out
