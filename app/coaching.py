"""Coaching: turn a finished report into plain-language findings a drummer can act on.

coach(report) reads only the report dict (audio, strokes, sticking, video, quality, params), so it
runs at the end of every analysis and can be re-run on old reports (scripts/backfill_coaching.py).
Every threshold is a tuning setting (coach_* in app/tuning.py) so it can be checked against labeled
clips later.

How the numbers are measured
  * Timing: there is no click track, so every note is compared with an even grid fitted to the
    player's own notes (audio grid indices). A quadratic fit removes a steady speed-up or slow-down
    first, so drift is reported once (as drift) and not again as "uneven timing". Negative = early
    (rushing), positive = late (dragging). Audio timing does not depend on the video frame rate.
  * Tempo drift: the tempo fitted on the first and last third of the notes.
  * Beat positions (1, e, &, a) are named only for single paradiddles in 16ths, where the doubles
    (RR, LL) fix where each group of four starts. Otherwise no beat position is claimed.
  * Hands come from the video (the wrist that moves down fastest at each hit). Hand findings need
    enough tracked frames; under 50 fps their thresholds are widened (coach_low_fps_scale).
  * Wrist travel is the wrist's height change over each stroke cycle in the video. It is not stick
    height. It is only judged at 50 fps and up with good tracking. Posture and elbow angles are not
    judged: a phone video from the front cannot support those claims yet.

Output (report["coaching"]):
  {version, status: "ok" | "not_enough_data", message, focus, focus_finding, tempo_bpm, low_fps,
   findings: [{id, severity: fix_first | work_on | polish, severity_label, title, saw, why,
               fix: [..], drill: {name, tempo_bpm, text}, focus, examples: [{t, label, hand}],
               hand, confidence: high | medium, caveat, metric: {..}}],
   strengths: [{id, title, saw}], notes: [..]}
"""
from __future__ import annotations

import math

import numpy as np

from . import tuning

VERSION = 2  # bump when rules or wording change: /api/results recomputes older coaching on read
SEVERITY_LABEL = {"fix_first": "Fix first", "work_on": "Worth working on", "polish": "Nice to tidy up"}
SEVERITY_RANK = {"fix_first": 0, "work_on": 1, "polish": 2}
HAND_WORD = {"L": "left", "R": "right"}
# Beat positions for 16th notes, counted "1 e & a". Paradiddle groups of four start on the beat.
POSITION_GROUPS = {"down": ((0,), "the notes on the beat"), "and": ((2,), "the &s"), "ea": ((1, 3), "the e's and a's")}
EXAMPLE_GAP_S = 0.5
# Names of the 4 positions in a group of 16ths (paradiddle: RLRR, the double is the & and the a).
ACCENT_POSITION = {0: "1 (the first note of each group)", 1: "e (the second note of each group)",
                   2: "& (the first note of the double)", 3: "a (the second note of the double)"}


# ---------- small helpers ----------

def _num(v, d=0):
    """Round for display: whole numbers print without a decimal point."""
    r = round(float(v), d)
    return str(int(r)) if d == 0 else f"{r:.{d}f}"


def _ms(v):
    return f"{int(round(abs(float(v))))} ms"


def _clock(t):
    return f"{float(t):.1f} s"


def drill_tempo(bpm: float, pct: float | None = None) -> int:
    """A practice tempo slower than the measured one: pct of it, rounded down to a multiple of 10, at least 40."""
    pct = tuning.current().coach_drill_pct if pct is None else pct
    out = int(math.floor(bpm * pct / 100.0 / 10.0) * 10)
    if out >= bpm:
        out = int(math.floor((bpm - 1) / 10.0) * 10)
    return max(40, out)


def _worst(items, key, n=3, gap=EXAMPLE_GAP_S):
    """The n items with the largest key, at least gap seconds apart, returned in time order."""
    out = []
    for it in sorted(items, key=key, reverse=True):
        if key(it) <= 0:
            break
        if all(abs(it["t"] - o["t"]) >= gap for o in out):
            out.append(it)
        if len(out) == n:
            break
    return sorted(out, key=lambda it: it["t"])


def _tstat(x: np.ndarray) -> float:
    if x.size < 2:
        return 0.0
    sd = float(x.std(ddof=1))
    return float(x.mean()) / (sd / math.sqrt(x.size)) if sd > 0 else (math.inf if x.mean() else 0.0)


def _notes_word(sub: int) -> str:
    return "16th notes" if sub == 4 else "16th-note triplets" if sub == 6 else "even notes"


class _Take:
    """Per-note arrays pulled from the report, with timing residuals after drift removal."""

    def __init__(self, report: dict):
        a = report["audio"]
        self.report = report
        self.onsets = a.get("onsets") or []
        self.strokes = report.get("strokes") or []
        self.grid = a.get("grid")
        self.sub = int(self.grid["subdivision"]) if self.grid else 4
        self.tempo = a.get("tempo_bpm")
        self.t = np.array([o["t"] for o in self.onsets], dtype=float)
        self.k = np.array([o.get("grid_index", 0) for o in self.onsets], dtype=float)
        self.vel = np.array([o.get("velocity", 0.0) for o in self.onsets], dtype=float)
        n = len(self.onsets)
        self.hand = np.array([(self.strokes[i].get("hand") if i < len(self.strokes) else None) or "?" for i in range(n)])
        self.expected = [(self.strokes[i].get("expected_hand") if i < len(self.strokes) else None) for i in range(n)]
        self.resid = np.zeros(n)
        self.step = (self.grid["step_ms"] / 1000.0) if self.grid else None
        if n >= 4 and self.grid and len(set(self.k)) >= 4:
            deg = 2 if n >= 12 else 1
            c = np.polyfit(self.k, self.t, deg)
            self.resid = (self.t - np.polyval(c, self.k)) * 1000.0
        q = report.get("quality") or {}
        fps = (report.get("source") or {}).get("fps") or 0
        self.low_fps = bool(q.get("low_fps", fps and fps < 50))
        self.fps = fps
        v = report.get("video") or {}
        self.video_ok = not v.get("degraded", True)
        self.coverage = float(v.get("landmark_coverage") or 0.0)
        self.verified_pct = float((report.get("verification") or {}).get("agreement_pct") or 0.0)
        self.duration = float(self.t[-1] - self.t[0]) if n >= 2 else 0.0
        # The first and last note are often a pickup or a trailing hit: left out of timing stats and examples.
        self.core = np.zeros(n, dtype=bool)
        self.core[1:n - 1] = True
        self.phase = self._anchor_phase()
        self.practice_bpm = drill_tempo(self.tempo) if self.tempo else 100
        self.drifted = False

    def local_step(self, idx: np.ndarray) -> float | None:
        if idx.size < 4 or len(set(self.k[idx])) < 3:
            return None
        step, _ = np.polyfit(self.k[idx], self.t[idx], 1)
        return float(step) if step > 0 else None

    def bpm_of(self, idx: np.ndarray) -> float | None:
        step = self.local_step(idx)
        return 60.0 / (step * self.sub) if step else None

    def _anchor_phase(self) -> int | None:
        """Grid phase of the beat, from paradiddle doubles: the first note of a double is the '&' (position 2)."""
        st = self.report.get("sticking") or {}
        if not st.get("checked") or self.sub != 4:
            return None
        votes = {}
        for i in range(len(self.onsets) - 1):
            e1, e2 = self.expected[i], self.expected[i + 1]
            if e1 and e1 == e2 and self.k[i + 1] == self.k[i] + 1:
                p = int(self.k[i] - 2) % 4
                votes[p] = votes.get(p, 0) + 1
        total = sum(votes.values())
        if total < 4:
            return None
        best = max(votes, key=votes.get)
        return best if votes[best] / total >= 0.7 else None

    def position(self) -> np.ndarray | None:
        """Beat position 0..3 (1 e & a) of every note, or None when it cannot be named."""
        if self.phase is None:
            return None
        return ((self.k - self.phase) % 4).astype(int)

    def accent(self) -> tuple[int | None, float]:
        """(grid phase that is clearly louder than the rest, loudness ratio), or (None, ratio)."""
        tune = tuning.current()
        if len(self.vel) < tune.coach_min_hits:
            return None, 1.0
        phases = (self.k % self.sub).astype(int)
        means = {p: float(self.vel[phases == p].mean()) for p in range(self.sub) if (phases == p).sum() >= tune.coach_min_group_hits}
        if len(means) < 2:
            return None, 1.0
        best = max(means, key=means.get)
        rest = [m for p, m in means.items() if p != best]
        ratio = means[best] / max(1e-6, float(np.mean(rest)))
        return (best if ratio >= tune.coach_accent_ratio else None), ratio

    def hand_reliable(self) -> bool:
        return self.video_ok and self.coverage >= tuning.current().coach_min_coverage and np.isin(self.hand, ["L", "R"]).mean() >= 0.8

    def hand_caveat(self) -> str | None:
        tune = tuning.current()
        if self.low_fps:
            return f"Hands are read from the video, which is harder at {_num(self.fps)} fps. Watch the examples to confirm."
        if self.verified_pct < tune.coach_min_verified_pct:
            return "Hands are read from the video. Watch the examples to confirm."
        return None


# ---------- finding builders ----------

def _finding(fid, severity, title, saw, why, fix, drill, focus, examples, *, hand=None, confidence="high",
             caveat=None, metric=None, weight=1.0):
    return {"id": fid, "severity": severity, "severity_label": SEVERITY_LABEL[severity], "title": title, "saw": saw,
            "why": why, "fix": fix, "drill": drill, "focus": focus, "examples": examples, "hand": hand,
            "confidence": confidence, "caveat": caveat, "metric": metric or {}, "_weight": weight}


def _ex(tk: _Take, i: int, label: str, hand=None) -> dict:
    return {"t": round(float(tk.t[i]), 3), "label": label, "hand": hand}


def drift_numbers(tk: _Take) -> tuple[float, float] | None:
    """(tempo of the first third, tempo of the last third) or None when the take is too short."""
    tune = tuning.current()
    n = len(tk.t)
    if tk.duration < tune.coach_min_drift_s or n < 3 * tune.coach_min_group_hits:
        return None
    third = n // 3
    b0, b1 = tk.bpm_of(np.arange(0, third)), tk.bpm_of(np.arange(n - third, n))
    return (b0, b1) if b0 and b1 else None


def is_drift(b0: float, b1: float) -> bool:
    tune = tuning.current()
    return abs(100.0 * (b1 - b0) / b0) >= tune.coach_drift_pct and abs(b1 - b0) >= tune.coach_drift_min_bpm


def tempo_drift(tk: _Take) -> tuple[dict | None, dict | None]:
    """(finding, strength) for speeding up or slowing down across the take."""
    tune = tuning.current()
    nums = drift_numbers(tk)
    if not nums:
        return None, None
    b0, b1 = nums
    n = len(tk.t)
    third = n // 3
    first, last = np.arange(0, third), np.arange(n - third, n)
    change = b1 - b0
    pct = 100.0 * change / b0
    metric = {"start_bpm": round(b0, 1), "end_bpm": round(b1, 1), "change_bpm": round(change, 1), "change_pct": round(pct, 1)}
    if abs(pct) <= tune.coach_steady_pct:
        return None, {"id": "steady_tempo", "title": "You held the tempo steady",
                      "saw": f"About {_num(b0)} BPM at the start and {_num(b1)} BPM at the end.", "metric": metric}
    if not is_drift(b0, b1):
        return None, None
    sev = "fix_first" if abs(pct) >= tune.coach_drift_fix_pct else "work_on"
    faster = change > 0
    drill = tk.practice_bpm
    mid = np.arange(third, n - third)
    bm = tk.bpm_of(mid)
    ex = [_ex(tk, int(first[len(first) // 2]), f"{_clock(tk.t[first[len(first) // 2]])}, about {_num(b0)} BPM")]
    if bm:
        ex.append(_ex(tk, int(mid[len(mid) // 2]), f"{_clock(tk.t[mid[len(mid) // 2]])}, about {_num(bm)} BPM"))
    ex.append(_ex(tk, int(last[len(last) // 2]), f"{_clock(tk.t[last[len(last) // 2]])}, about {_num(b1)} BPM"))
    word = "sped up" if faster else "slowed down"
    return _finding(
        "tempo_drift", sev,
        f"You {word} from about {_num(b0)} to {_num(b1)} BPM",
        f"The first third of the take was about {_num(b0)} BPM and the last third about {_num(b1)} BPM, "
        f"a {'gain' if faster else 'drop'} of {_num(abs(change))} BPM ({_num(abs(pct))}%) in {_num(tk.duration)} seconds.",
        ("Rushing is the most common tempo problem. A band or a click will not speed up with you, "
         "and the faster you drift the more the notes crowd together.") if faster else
        ("Dragging makes the music feel heavy, and a band or a click will leave you behind."),
        [f"Practice with a click and make it the boss: if you hear yourself {'ahead of' if faster else 'behind'} it, "
         f"{'relax and let the click come to you' if faster else 'lift the next note slightly'}.",
         "Count the quarter notes out loud while you play so you feel the beat, not just the sticking.",
         "Record a 30 second take and check whether the first and last few seconds feel the same speed."],
        {"name": "Click lock", "tempo_bpm": drill,
         "text": f"Set a click to {drill} BPM and play {_notes_word(tk.sub)} for 60 seconds without drifting ahead of or "
                 f"behind it. When it feels easy three times in a row, go up 10 BPM."},
        f"Play along with a click at {drill} BPM and stay with it for a full minute before going faster.",
        ex, metric=metric, weight=abs(pct) / tune.coach_drift_pct), None


def target_tempo(tk: _Take) -> dict | None:
    tune = tuning.current()
    target = (tk.report.get("params") or {}).get("target_bpm")
    if not target or not tk.tempo:
        return None
    diff = tk.tempo - float(target)
    pct = 100.0 * diff / float(target)
    if abs(pct) < tune.coach_target_pct:
        return None
    over = diff > 0
    drill = drill_tempo(min(tk.tempo, float(target)))
    return _finding(
        "target_tempo", "work_on",
        f"You played {_num(abs(diff))} BPM {'over' if over else 'under'} your {_num(target)} BPM target",
        f"The take averaged {_num(tk.tempo)} BPM against a target of {_num(target)} BPM ({_num(abs(pct))}% {'fast' if over else 'slow'}).",
        "Hitting the target tempo is what lets you play with a band or pass a tempo goal.",
        ["Start the click at the target before you pick up the sticks and count one bar in.",
         f"{'Hold back' if over else 'Push a little'}: think of each group of four landing exactly with the click.",
         "If the target feels out of reach, work up to it in 10 BPM steps."],
        {"name": "Tempo ladder", "tempo_bpm": drill,
         "text": f"Play 30 seconds at {drill} BPM, then 10 BPM faster each round until you reach {_num(target)} BPM. "
                 f"Stop at the first tempo where the notes stop being even and stay there for a few days."},
        f"Start at {drill} BPM with a click and climb to {_num(target)} BPM in 10 BPM steps.",
        [], metric={"tempo_bpm": tk.tempo, "target_bpm": target, "diff_bpm": round(diff, 1)}, weight=abs(pct) / tune.coach_target_pct)


def timing_spread(tk: _Take) -> tuple[dict | None, dict | None]:
    tune = tuning.current()
    r = tk.resid
    rc = r[tk.core]
    spread = float(np.abs(rc).mean())
    metric = {"mean_abs_ms": round(spread, 1), "std_ms": round(float(rc.std()), 1)}
    if spread <= tune.coach_timing_tight_ms:
        return None, {"id": "tight_timing", "title": "Your timing is tight",
                      "saw": f"Your notes land within about {_ms(spread)} of an even grid on average.", "metric": metric}
    if spread < tune.coach_timing_work_ms:
        return None, None
    sev = "fix_first" if spread >= tune.coach_timing_fix_ms else "work_on"
    items = [{"t": float(tk.t[i]), "i": i, "e": float(abs(r[i]))} for i in np.where(tk.core)[0]]
    worst = _worst(items, key=lambda it: it["e"])
    ex = [_ex(tk, it["i"], f"{_clock(it['t'])}, {_ms(r[it['i']])} {'early' if r[it['i']] < 0 else 'late'}",
              tk.hand[it["i"]] if tk.hand[it["i"]] in ("L", "R") else None) for it in worst]
    drill = tk.practice_bpm
    return _finding(
        "timing_spread", sev,
        f"Your notes are uneven by about {_ms(spread)}",
        f"On average each note lands {_ms(spread)} away from an even grid"
        f"{', even after allowing for the tempo change' if tk.drifted else ''}, "
        f"and the worst ones are {_ms(float(np.abs(rc).max()))} off.",
        "Even spacing is what makes a rudiment sound clean and in time. Uneven notes blur the pattern even at the right tempo.",
        ["Slow down until every note feels the same distance apart, then speed up in small steps.",
         "Play with a click on every quarter note and listen for notes that jump ahead or fall behind it.",
         "Keep the sticks low and relaxed: tension in the grip makes the timing jumpy."],
        {"name": "Slow and even", "tempo_bpm": drill,
         "text": f"Play the rudiment as {_notes_word(tk.sub)} at {drill} BPM with a click for 2 minutes, aiming for every note "
                 f"to sound the same distance apart. Add 5 to 10 BPM only when a whole minute feels even."},
        f"Play at {drill} BPM until every note sounds evenly spaced, then speed up.",
        ex, metric=metric, weight=spread / tune.coach_timing_work_ms), None


def _welch(a: np.ndarray, b: np.ndarray) -> float:
    if a.size < 2 or b.size < 2:
        return 0.0
    se = math.sqrt(a.var(ddof=1) / a.size + b.var(ddof=1) / b.size)
    d = float(a.mean() - b.mean())
    return d / se if se > 0 else (math.inf if d else 0.0)


def timing_bias(tk: _Take) -> dict | None:
    """One hand, one beat position, or one hand on one position consistently early or late.

    There is no click, so the grid is a compromise between all the notes: a finding is always a
    comparison (left hand versus right hand, or these notes versus all your other notes).
    """
    tune = tuning.current()
    scale = tune.coach_low_fps_scale if tk.low_fps else 1.0
    pos = tk.position()
    hands_ok = tk.hand_reliable()
    cands = []
    core = tk.core
    if hands_ok:   # left versus right
        a, b = tk.resid[core & (tk.hand == "L")], tk.resid[core & (tk.hand == "R")]
        if min(a.size, b.size) >= tune.coach_min_group_hits:
            d, t = float(a.mean() - b.mean()), _welch(a, b)
            thr, tthr = tune.coach_hand_bias_ms * scale, tune.coach_bias_t * scale
            if abs(d) >= thr and abs(t) >= tthr:
                cands.append({"kind": "hands", "hand": "L" if d < 0 else "R", "diff": -abs(d), "n": int(a.size + b.size),
                              "mask": core & (tk.hand == ("L" if d < 0 else "R")), "word": None, "group": "all", "score": abs(d) / thr})
    if pos is not None:   # a beat position (optionally one hand on it) versus all other notes
        for h in (["L", "R"] if hands_ok else []) + [None]:
            for g, (idxs, word) in POSITION_GROUPS.items():
                m = core & np.isin(pos, idxs)
                if h:
                    m &= tk.hand == h
                a, b = tk.resid[m], tk.resid[core & ~m]
                if min(a.size, b.size) < tune.coach_min_group_hits:
                    continue
                d, t = float(a.mean() - b.mean()), _welch(a, b)
                thr = tune.coach_position_bias_ms * (scale if h else 1.0)
                tthr = tune.coach_bias_t * (scale if h else 1.0)
                if abs(d) >= thr and abs(t) >= tthr:
                    cands.append({"kind": "position", "hand": h, "diff": d, "n": int(a.size), "mask": m, "word": word,
                                  "group": g, "score": abs(d) / thr + (0.01 if h is None else 0)})
    if not cands:
        return None
    best = max(cands, key=lambda c: c["score"])
    h, d = best["hand"], best["diff"]
    early = d < 0
    if best["kind"] == "hands":
        other = "R" if h == "L" else "L"
        title = f"Your {HAND_WORD[h]} hand rushes about {_ms(d)} ahead of your {HAND_WORD[other]}"
        saw = (f"On average your {HAND_WORD[h]} hand's notes landed {_ms(d)} earlier than your {HAND_WORD[other]} hand's, "
               f"compared with an even grid fitted to your playing ({best['n']} notes).")
        why = ("When one hand runs ahead the notes pair up unevenly (long, short, long, short) and the rudiment "
               "stops sounding even, even at the right tempo.")
        fix = [f"Play 8th notes {HAND_WORD[h]} hand alone with a click and land exactly on it.",
               f"Then alternate hands slowly and let the {HAND_WORD[h]} hand wait for its spot.",
               f"Relax the {HAND_WORD[h]} grip: squeezing makes a hand fire early."]
        drill_name, drill_text_hand = f"{HAND_WORD[h].capitalize()} hand patience", h
        focus_hand = h
    else:
        who = (f"Your {HAND_WORD[h]} hand {'rushes' if early else 'drags'}" if h else
               f"You {'rush' if early else 'drag'}")
        title = f"{who} {best['word']} by about {_ms(d)}"
        saw = (f"{('Your ' + HAND_WORD[h] + ' hand played ') if h else 'You played '}{best['word']} {_ms(d)} "
               f"{'earlier' if early else 'later'} than your other notes on average ({best['n']} notes).")
        why = ("Early notes crowd the next note and make the rhythm feel rushed and uneven." if early else
               "Late notes squash the next note and make the rhythm limp.")
        fix = ["Play with a click and count 1 e & a out loud so every position gets the same space.",
               f"Listen to {best['word']}: {'wait for them' if early else 'play them a hair sooner'}.",
               ("Slow down until the count feels even, then speed up in small steps." if not h else
                f"Play the pattern with the {HAND_WORD[h]} hand alone (the other hand silent) so you hear its spacing.")]
        drill_name, drill_text_hand, focus_hand = "Say the count", None, h
    idx = np.where(best["mask"])[0]
    items = [{"t": float(tk.t[i]), "i": int(i), "e": float(-tk.resid[i] if early else tk.resid[i])} for i in idx]
    ex = [_ex(tk, it["i"], f"{_clock(it['t'])}, {'early' if early else 'late'}", tk.hand[it["i"]] if tk.hand[it["i"]] in ("L", "R") else h)
          for it in _worst(items, key=lambda it: it["e"])]
    base_thr = tune.coach_hand_bias_ms if best["kind"] == "hands" else tune.coach_position_bias_ms
    sev = "fix_first" if abs(d) >= 2 * base_thr else "work_on"
    drill = tk.practice_bpm
    drill_text = (f"At {drill} BPM play 8 notes with the {HAND_WORD[drill_text_hand]} hand only, then 8 alternating, for 2 minutes, "
                  f"keeping the {HAND_WORD[drill_text_hand]} hand exactly on the click." if drill_text_hand else
                  f"At {drill} BPM play the rudiment for 2 minutes while counting 1 e & a out loud, every note exactly as far apart as the next.")
    focus = (f"Keep your {HAND_WORD[focus_hand]} hand from rushing: land it exactly on the click at {drill} BPM." if focus_hand and early else
             f"Keep your {HAND_WORD[focus_hand]} hand right on the click at {drill} BPM." if focus_hand else
             f"Count 1 e & a out loud at {drill} BPM so every note gets the same space.")
    caveat = tk.hand_caveat() if h else None
    return _finding("timing_bias", sev, title, saw, why, fix, {"name": drill_name, "tempo_bpm": drill, "text": drill_text},
                    focus, ex, hand=h, confidence="medium" if caveat else "high", caveat=caveat,
                    metric={"kind": best["kind"], "hand": h, "position": best["group"], "diff_ms": round(d, 1), "notes": best["n"]},
                    weight=best["score"])


def sticking(tk: _Take) -> tuple[dict | None, dict | None]:
    tune = tuning.current()
    st = tk.report.get("sticking") or {}
    if not st.get("checked") or not tk.hand_reliable():
        return None, None
    acc = st.get("sticking_accuracy_pct")
    n = st.get("strokes_checked") or 0
    if acc is None or n < tune.coach_min_hits:
        return None, None
    wrong, resyncs = st.get("wrong_hand", 0), st.get("resyncs", 0)
    ok = n - wrong
    pattern = st.get("pattern") or "RLRR LRLL"
    if acc >= tune.coach_sticking_polish_pct:
        return None, {"id": "clean_sticking", "title": "Clean sticking",
                      "saw": f"{ok} of {n} strokes matched {pattern}.", "metric": {"accuracy_pct": acc}}
    sev = "fix_first" if acc < tune.coach_sticking_fix_pct else "work_on" if acc < tune.coach_sticking_work_pct else "polish"
    breaks = st.get("breaks") or []
    ex, last = [], None
    n_strokes = len(tk.strokes)
    for b in breaks:
        if b.get("stroke_index") in (0, n_strokes - 1):
            continue
        if last is None or b["t"] - last >= EXAMPLE_GAP_S:
            label = ((f"{_clock(b['t'])}, {HAND_WORD.get(b.get('played'), '?')} hand, should be {HAND_WORD.get(b.get('expected'), '?')}"
                      if b.get("played") in HAND_WORD and b.get("expected") in HAND_WORD
                      else f"{_clock(b['t'])}, wrong hand") if b["kind"] == "wrong_hand"
                     else f"{_clock(b['t'])}, lost the pattern")
            ex.append({"t": round(float(b["t"]), 3), "label": label, "hand": b.get("played")})
            last = b["t"]
        if len(ex) == 3:
            break
    drill = max(40, tk.practice_bpm - 10)
    slips = f"{wrong} wrong-hand stroke{'s' if wrong != 1 else ''}" + (f" and lost the pattern {resyncs} time{'s' if resyncs != 1 else ''}" if resyncs else "")
    return _finding(
        "sticking", sev,
        f"Your sticking slipped {wrong + resyncs} time{'s' if wrong + resyncs != 1 else ''} in {n} strokes",
        f"{_num(acc)}% of strokes matched {pattern}: {slips}.",
        "The sticking is the rudiment. A switched hand changes where the doubles fall and how the pattern sounds and feels.",
        [f"Say the sticking out loud ({', '.join(' '.join(g) for g in str(pattern).split())}) while you play it slowly.",
         "Watch the examples and find which part of the pattern breaks, often the switch after the double.",
         "Stop at the first mistake, play that group of four 5 times clean, then continue."],
        {"name": "Say it, play it", "tempo_bpm": drill,
         "text": f"At {drill} BPM play {pattern} while saying each letter out loud for 2 minutes with no mistakes, then 10 BPM faster."},
        f"Play {pattern} at {drill} BPM saying the sticking out loud until two minutes go by with no slips.",
        ex, confidence="medium" if tk.hand_caveat() else "high", caveat=tk.hand_caveat(),
        metric={"accuracy_pct": acc, "wrong_hand": wrong, "resyncs": resyncs, "strokes": n},
        weight=(100 - acc) / (100 - tune.coach_sticking_polish_pct)), None


def doubles(tk: _Take) -> list[dict]:
    """Paradiddle doubles: second note quieter than the first, or the pair squeezed or opened."""
    tune = tuning.current()
    pos = tk.position()
    if pos is None or not tk.step:
        return []
    pairs = [i for i in range(len(tk.t) - 1) if pos[i] == 2 and tk.k[i + 1] == tk.k[i] + 1
             and tk.expected[i] and tk.expected[i] == tk.expected[i + 1]]
    if len(pairs) < tune.coach_min_group_hits:
        return []
    out = []
    drill = tk.practice_bpm
    ratios = np.array([tk.vel[i + 1] / max(1e-6, tk.vel[i]) for i in pairs])
    med = float(np.median(ratios))
    if med < tune.coach_double_ratio:
        items = [{"t": float(tk.t[i + 1]), "i": i + 1, "e": 1 - float(tk.vel[i + 1] / max(1e-6, tk.vel[i]))} for i in pairs]
        ex = [_ex(tk, it["i"], f"{_clock(it['t'])}, {_num(100 * it['e'])}% quieter", tk.expected[it["i"]]) for it in _worst(items, key=lambda it: it["e"])]
        out.append(_finding(
            "double_volume", "work_on",
            f"The second note of your doubles is about {_num(100 * (1 - med))}% quieter",
            f"Across {len(pairs)} doubles (the RR and LL), the second note was typically {_num(100 * med)}% as loud as the first.",
            "Weak second notes make the doubles sound like single strokes with a ghost, and the pattern loses its even sound.",
            ["Play the second note of each double with a small push from the fingers instead of letting it bounce on its own.",
             "Practice doubles slowly as two separate wrist strokes, then let the fingers take over as you speed up.",
             "Listen for both notes of the double sounding the same."],
            {"name": "Even doubles", "tempo_bpm": drill,
             "text": f"At {drill} BPM play RR LL RR LL as 8th notes for 1 minute, both notes the same volume, then switch to the paradiddle."},
            f"Make both notes of every double the same volume at {drill} BPM.",
            ex, metric={"second_note_ratio": round(med, 2), "doubles": len(pairs)}, weight=(1 - med) / (1 - tune.coach_double_ratio)))
    gaps = np.array([(tk.t[i + 1] - tk.t[i]) * 1000.0 - tk.step * 1000.0 for i in pairs])
    g, t = float(gaps.mean()), _tstat(gaps)
    if abs(g) >= tune.coach_double_gap_ms and abs(t) >= tune.coach_bias_t:
        squeezed = g < 0
        items = [{"t": float(tk.t[i]), "i": i, "e": float(-gp if squeezed else gp)} for i, gp in zip(pairs, gaps)]
        ex = [_ex(tk, it["i"], f"{_clock(it['t'])}, {_ms(it['e'])} {'short' if squeezed else 'long'}", tk.expected[it["i"]]) for it in _worst(items, key=lambda it: it["e"])]
        out.append(_finding(
            "double_spacing", "work_on",
            f"Your doubles are {'squeezed' if squeezed else 'too open'} by about {_ms(g)}",
            f"The two notes of each double were {_ms(g)} {'closer together' if squeezed else 'further apart'} than your other notes, over {len(pairs)} doubles.",
            "The doubles should sit exactly on the grid like every other note. Squeezed doubles sound like a flam or a drag."
            if squeezed else "Open doubles leave a gap and make the pattern stumble.",
            ["Count 1 e & a out loud: the double is the & and the a, each gets a full 16th note.",
             "Play the double with two wrist strokes at a slow tempo so each note has its own space.",
             "Speed up only while the double still sounds evenly spaced."],
            {"name": "Spaced doubles", "tempo_bpm": drill,
             "text": f"At {drill} BPM play the paradiddle and say 1 e & a out loud, making the & and the a (the double) exactly as far apart as the other notes."},
            f"Give both notes of every double a full 16th note at {drill} BPM.",
            ex, metric={"gap_ms": round(g, 1), "doubles": len(pairs)}, weight=abs(g) / tune.coach_double_gap_ms))
    return out


def dynamics(tk: _Take) -> tuple[list[dict], list[dict]]:
    """Hand volume balance, volume spread of unaccented notes, and clear accents."""
    tune = tuning.current()
    findings, strengths = [], []
    acc_phase, ratio = tk.accent()
    phases = (tk.k % tk.sub).astype(int)
    plain = (phases != acc_phase if acc_phase is not None else np.ones(len(tk.vel), dtype=bool)) & tk.core
    caveat_mic = "Phone microphones can squash or boost volume. Compare takes recorded the same way."
    acc_pos = int((acc_phase - tk.phase) % 4) if acc_phase is not None and tk.phase is not None else None
    if acc_phase is not None and acc_pos in (None, 0):
        strengths.append({"id": "clear_accents", "title": "Your accents come through clearly",
                          "saw": f"One note in every group of {tk.sub} is about {_num(ratio, 1)} times louder than the rest"
                                 f"{', on the first note of each group' if acc_pos == 0 else ''}.",
                          "metric": {"accent_ratio": round(ratio, 2)}})
    elif acc_phase is not None:
        name = ACCENT_POSITION[acc_pos]
        idx = np.where(((tk.k % tk.sub).astype(int) == acc_phase) & tk.core)[0]
        items = [{"t": float(tk.t[i]), "i": int(i), "e": float(tk.vel[i])} for i in idx]
        ex = [_ex(tk, it["i"], f"{_clock(it['t'])}, loud {name.split(' ')[0]}", tk.expected[it["i"]]) for it in _worst(items, key=lambda it: it["e"])]
        drill = tk.practice_bpm
        findings.append(_finding(
            "accent_position", "work_on",
            f"Your loudest note is the {name}",
            f"In every group of four, the {name} is about {_num(ratio, 1)} times louder than the other notes.",
            "Paradiddle accents normally go on the first note of each group, on the beat. A loud note anywhere else "
            "moves the feel of the whole pattern.",
            ["If you meant to accent, move it to the first note of each group: R l r r L r l l.",
             "If you did not mean to accent, keep that note at the same low height as the others.",
             "Practice slowly with a click and let only the note on the click be loud."],
            {"name": "Accent on the beat", "tempo_bpm": drill,
             "text": f"At {drill} BPM play R l r r L r l l for 2 minutes: the capital letters loud and on the click, every other note low and even."},
            f"Put the accent on the first note of each group, on the click, at {drill} BPM.",
            ex, confidence="medium",
            caveat="Where each group starts is worked out from your sticking. If the pattern was read wrong, check the examples.",
            metric={"accent_ratio": round(ratio, 2), "position": acc_pos}, weight=ratio / tune.coach_accent_ratio))
    v = tk.vel[plain]
    if v.size >= tune.coach_min_hits and v.mean() > 0:
        cv = float(v.std() / v.mean())
        if cv <= tune.coach_dynamics_cv_good:
            strengths.append({"id": "even_volume", "title": "Your volume is even",
                              "saw": f"Your {'unaccented ' if acc_phase is not None else ''}notes stay within about {_num(100 * cv)}% of the same volume.",
                              "metric": {"volume_cv": round(cv, 3)}})
        elif cv >= tune.coach_dynamics_cv_work:
            idx = np.where(plain)[0]
            med = float(np.median(v))
            items = [{"t": float(tk.t[i]), "i": int(i), "e": float(abs(tk.vel[i] - med))} for i in idx]
            ex = [_ex(tk, it["i"], f"{_clock(it['t'])}, {'louder' if tk.vel[it['i']] > med else 'quieter'} than the rest",
                      tk.hand[it["i"]] if tk.hand[it["i"]] in ("L", "R") else None) for it in _worst(items, key=lambda it: it["e"])]
            drill = tk.practice_bpm
            findings.append(_finding(
                "volume_spread", "work_on",
                f"Your {'unaccented ' if acc_phase is not None else ''}notes jump around in volume",
                f"The volume of your {'unaccented ' if acc_phase is not None else ''}notes varies by about {_num(100 * cv)}% from note to note.",
                "Even volume makes a rudiment sound controlled. Random loud and quiet notes sound like mistakes.",
                ["Start every stroke from the same height: height sets the volume.",
                 "Let the stick rebound to where it started instead of lifting it higher on some notes.",
                 "Practice at a quiet volume first. It is easier to hear small differences."],
                {"name": "Same height strokes", "tempo_bpm": drill,
                 "text": f"At {drill} BPM play the rudiment with every stick starting about 3 inches off the pad for 2 minutes, all notes the same volume."},
                f"Keep every stick at the same height so every note is the same volume at {drill} BPM.",
                ex, confidence="medium", caveat=caveat_mic, metric={"volume_cv": round(cv, 3)},
                weight=cv / tune.coach_dynamics_cv_work))
    if tk.hand_reliable():
        scale = tune.coach_low_fps_scale if tk.low_fps else 1.0
        thr = 1.0 - (1.0 - tune.coach_volume_ratio) * scale
        lv = tk.vel[plain & (tk.hand == "L")]
        rv = tk.vel[plain & (tk.hand == "R")]
        if lv.size >= tune.coach_min_group_hits and rv.size >= tune.coach_min_group_hits:
            ml, mr = float(np.median(lv)), float(np.median(rv))
            quiet = "L" if ml < mr else "R"
            r = min(ml, mr) / max(1e-6, max(ml, mr))
            if r < thr:
                idx = np.where(plain & (tk.hand == quiet))[0]
                items = [{"t": float(tk.t[i]), "i": int(i), "e": float(max(ml, mr) - tk.vel[i])} for i in idx]
                ex = [_ex(tk, it["i"], f"{_clock(it['t'])}, quiet {HAND_WORD[quiet]}", quiet) for it in _worst(items, key=lambda it: it["e"])]
                drill = tk.practice_bpm
                findings.append(_finding(
                    "hand_volume", "work_on",
                    f"Your {HAND_WORD[quiet]} hand plays about {_num(100 * (1 - r))}% quieter",
                    f"Your {HAND_WORD[quiet]} hand's {'unaccented ' if acc_phase is not None else ''}notes were {_num(100 * r)}% as loud as your "
                    f"{HAND_WORD['R' if quiet == 'L' else 'L']} hand's.",
                    "Both hands should sound the same so the listener cannot tell which hand played which note.",
                    [f"Play slow single strokes and match the {HAND_WORD[quiet]} hand's height to the other hand.",
                     f"Practice 8 notes on the {HAND_WORD[quiet]} hand alone, then 8 alternating, listening for the same sound.",
                     "Film yourself from the side to compare stick heights."],
                    {"name": "Match the hands", "tempo_bpm": drill,
                     "text": f"At {drill} BPM play 8 {HAND_WORD[quiet]}, 8 {HAND_WORD['R' if quiet == 'L' else 'L']}, 8 alternating, for 2 minutes, every note the same volume."},
                    f"Make your {HAND_WORD[quiet]} hand as loud as the other at {drill} BPM.",
                    ex, hand=quiet, confidence="medium", caveat=tk.hand_caveat() or caveat_mic,
                    metric={"quieter_hand": quiet, "ratio": round(r, 2)}, weight=(1 - r) / (1 - thr)))
    return findings, strengths


def wrist_travel(tk: _Take, notes: list[str]) -> dict | None:
    tune = tuning.current()
    if not tk.video_ok:
        return None
    if tk.low_fps:
        notes.append(f"Wrist movement is hard to judge at {_num(tk.fps)} fps, so this take gets no wrist advice. Record at 60 fps for it.")
        return None
    if tk.coverage < tune.coach_min_coverage:
        notes.append(f"Your body was tracked on only {_num(100 * tk.coverage)}% of frames, so this take gets no wrist advice.")
        return None
    ph = (tk.report.get("scores") or {}).get("per_hand") or {}
    hl, hr = (ph.get("L") or {}).get("stroke_height_mean"), (ph.get("R") or {}).get("stroke_height_mean")
    nl = sum(1 for s in tk.strokes if s.get("hand") == "L" and s.get("stroke_height") is not None)
    nr = sum(1 for s in tk.strokes if s.get("hand") == "R" and s.get("stroke_height") is not None)
    if not hl or not hr or nl < tune.coach_min_group_hits or nr < tune.coach_min_group_hits:
        return None
    big = max(hl, hr)
    r = min(hl, hr) / big
    if big < tune.coach_travel_min or r >= tune.coach_travel_ratio:
        return None
    small = "L" if hl < hr else "R"
    other = "R" if small == "L" else "L"
    items = [{"t": float(s["t"]), "i": i, "e": float(big - s["stroke_height"])} for i, s in enumerate(tk.strokes)
             if s.get("hand") == small and s.get("stroke_height") is not None and i < len(tk.t) and tk.core[i]]
    ex = [_ex(tk, it["i"], f"{_clock(it['t'])}, small {HAND_WORD[small]} stroke", small) for it in _worst(items, key=lambda it: it["e"])]
    drill = tk.practice_bpm
    frac = ("about a third" if 0.25 <= r < 0.4 else "about half" if 0.4 <= r < 0.6 else
            "about two thirds" if 0.6 <= r < 0.7 else f"about {_num(100 * r)}% as much")
    frac = frac if frac.endswith("much") else f"{frac} as much"
    return _finding(
        "wrist_travel", "work_on",
        f"Your {HAND_WORD[small]} wrist moves {frac} as your {HAND_WORD[other]}",
        f"In the video your {HAND_WORD[small]} wrist rose and fell {_num(r * 100)}% as far as your {HAND_WORD[other]} wrist on each stroke "
        f"({_num(min(hl, hr), 3)} versus {_num(big, 3)} shoulder widths).",
        "When one hand makes smaller strokes it usually plays quieter and tends to rush, so the two hands stop sounding alike.",
        [f"Play slow single strokes and make the {HAND_WORD[small]} hand's stroke as big as the {HAND_WORD[other]} hand's.",
         "Use a mirror or this video to compare the two sticks at the top of each stroke.",
         f"Loosen the {HAND_WORD[small]} grip so the stick can rebound as high as the other one."],
        {"name": "Matched strokes", "tempo_bpm": drill,
         "text": f"At {drill} BPM play 8 strokes per hand, then 8 alternating, for 2 minutes, both hands making the same size stroke."},
        f"Make your {HAND_WORD[small]} hand's strokes as big as your {HAND_WORD[other]} hand's at {drill} BPM.",
        ex, hand=small, confidence="medium",
        caveat="Measured from wrist movement in the video. The stick tips are not tracked.",
        metric={"smaller_hand": small, "ratio": round(r, 2), "L": hl, "R": hr}, weight=(1 - r) / (1 - tune.coach_travel_ratio))


STRENGTH_ORDER = ["tight_timing", "steady_tempo", "clean_sticking", "clear_accents", "even_volume"]
STRENGTH_AREA = {"tight_timing": "timing", "steady_tempo": "timing", "clean_sticking": "hands",
                 "clear_accents": "sound", "even_volume": "sound"}


def _pick_strengths(strengths: list[dict]) -> list[dict]:
    """Up to 2 strengths, the second from a different area (timing, hands, sound) when there is one."""
    ranked = sorted(strengths, key=lambda s: STRENGTH_ORDER.index(s["id"]) if s["id"] in STRENGTH_ORDER else 99)
    if len(ranked) <= 2:
        return ranked
    first = ranked[0]
    other = next((s for s in ranked[1:] if STRENGTH_AREA.get(s["id"]) != STRENGTH_AREA.get(first["id"])), ranked[1])
    return [first, other]


# ---------- main entry ----------

def coach(report: dict) -> dict:
    """Coaching section for a report (see the module docstring for the shape)."""
    tune = tuning.current()
    tk = _Take(report)
    base = {"version": VERSION, "tempo_bpm": tk.tempo, "low_fps": tk.low_fps, "findings": [], "strengths": [], "notes": []}
    if len(tk.t) < tune.coach_min_hits or not tk.grid or not tk.tempo:
        return {**base, "status": "not_enough_data", "focus_finding": None,
                "message": f"We need at least {tune.coach_min_hits} clear hits (about 4 seconds of steady playing) to coach a take. "
                           f"This one had {len(tk.t)}.",
                "focus": "Record at least 10 seconds of steady playing with the drum or pad close to the phone."}

    notes: list[str] = []
    findings: list[dict] = []
    strengths: list[dict] = []

    # One practice tempo for every drill in this take: slower than the measured tempo, and slower
    # than the start of the take when the player sped up or slowed down.
    nums = drift_numbers(tk)
    if nums and is_drift(*nums):
        tk.drifted = True
        tk.practice_bpm = drill_tempo(min(tk.tempo, *nums))
    f, s = tempo_drift(tk)
    findings += [f] if f else []
    strengths += [s] if s else []
    f = target_tempo(tk)
    findings += [f] if f else []
    f, s = timing_spread(tk)
    findings += [f] if f else []
    strengths += [s] if s else []
    f = timing_bias(tk)
    findings += [f] if f else []
    f, s = sticking(tk)
    findings += [f] if f else []
    strengths += [s] if s else []
    findings += doubles(tk)
    fs, ss = dynamics(tk)
    findings += fs
    strengths += ss
    f = wrist_travel(tk, notes)
    findings += [f] if f else []

    if not tk.video_ok:
        notes.append("Video tracking was not available, so this coaching uses the sound only (no hand, sticking or wrist advice).")
    elif not tk.hand_reliable():
        notes.append("Your hands were not tracked well enough to tell them apart, so there is no hand-by-hand advice.")
    elif tk.verified_pct < tune.coach_min_verified_pct:
        notes.append(f"The video matched {_num(tk.verified_pct)}% of your hits to a visible wrist stroke, so hand advice is less certain "
                     "than the timing advice, which comes from the sound.")
    if tk.low_fps:
        notes.append(f"Recorded at {_num(tk.fps)} fps. Timing advice comes from the sound and is not affected. Hand advice needs "
                     "bigger differences before it is shown. Record at 60 fps for the full check.")
    if tk.position() is None:
        notes.append("Beat positions (1 e & a) and doubles are only named for single paradiddles in 16th notes.")
    notes.append("Posture and elbow angles are not judged yet: a phone video from the front cannot measure them reliably.")

    findings.sort(key=lambda x: (SEVERITY_RANK[x["severity"]], x["confidence"] != "high", -x["_weight"]))
    findings = findings[:tune.coach_max_findings]
    for x in findings:
        x.pop("_weight", None)
    flagged = {x["id"] for x in findings}
    strengths = [s for s in strengths if not (s["id"] == "tight_timing" and "timing_bias" in flagged)]
    strengths = _pick_strengths(strengths)
    if not strengths:
        gaps = np.diff(tk.t)
        no_stops = tk.step and gaps.size and float(gaps.max()) < 3 * tk.step
        strengths = [{"id": "kept_going", "title": "You kept going through the whole take" if no_stops else "You got a full take down",
                      "saw": f"{len(tk.t)} hits over {_num(tk.duration, 1)} seconds{' without stopping' if no_stops else ''}.", "metric": {}}]
    if findings:
        focus, focus_id = findings[0]["focus"], findings[0]["id"]
    else:
        nxt = int(math.floor(tk.tempo / 10.0) * 10) + 10
        focus, focus_id = f"Everything we measured looks solid. Next take, try {nxt} BPM and keep it this clean.", None
    return {**base, "status": "ok", "message": None, "focus": focus, "focus_finding": focus_id,
            "findings": findings, "strengths": strengths, "notes": notes}


def safe_coach(report: dict) -> dict:
    """coach() that never raises: a coaching bug must not break the report."""
    try:
        return coach(report)
    except Exception as exc:  # pragma: no cover - defensive
        return {"version": VERSION, "status": "error", "message": f"Coaching could not be computed: {type(exc).__name__}",
                "focus": None, "focus_finding": None, "tempo_bpm": None, "low_fps": None,
                "findings": [], "strengths": [], "notes": []}


def needs_update(report: dict) -> bool:
    c = report.get("coaching")
    return not isinstance(c, dict) or c.get("version") != VERSION
