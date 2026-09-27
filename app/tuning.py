"""Tuning knobs for the analyzer, gathered in one place.

Every threshold that decides what counts as a stroke, which hand played it and
whether audio and video agree lives in the Tuning dataclass below. Values come
from, in order (later wins):

  1. the defaults in this file (the shipped behaviour);
  2. a JSON file: TUNING_FILE if set, otherwise ./tuning.json when it exists,
     e.g. {"onset_threshold": 0.25, "min_ioi_ms": 35};
  3. environment variables SIO_TUNE_<NAME>, e.g. SIO_TUNE_ONSET_THRESHOLD=0.25.

scripts/evaluate.py can try other values for one run (--set name=value, --tuning
file.json) or sweep a grid (--grid name=v1,v2,...) without touching these files:
it calls override(), which only affects the current thread or task.

The server reads current() at the start of every analysis, and the values used
are written to report.engine.tuning so a report always says how it was made.
"""
from __future__ import annotations

import contextvars
import json
import os
from contextlib import contextmanager
from dataclasses import asdict, dataclass, fields, replace
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_PREFIX = "SIO_TUNE_"


@dataclass(frozen=True)
class Tuning:
    # Audio onsets (app/audio.py)
    onset_method: str = "specdiff"        # aubio onset function: specdiff, hfc, complex, energy, phase, ...
    onset_threshold: float = 0.3          # onset sensitivity: lower finds more (quieter) hits, higher finds fewer
    onset_silence_db: float = -90.0       # frames quieter than this are ignored
    min_ioi_ms: float = 40.0              # minimum stroke spacing: two onsets closer than this count once
    min_rel_velocity: float = 0.05        # drop onsets quieter than this share of the loudest hit
    # Hand assignment (app/fusion.py)
    hand_window_ms: float = 40.0          # look for wrist motion within this many ms of each onset
    hand_source: str = "velocity"         # "velocity": fastest downward wrist; "strike_first": the matched
                                          # video strike's hand when there is one, else velocity
    # Video strikes (app/video.py)
    min_wrist_visibility: float = 0.5     # frames where a wrist is less visible than this are dropped
    strike_min_prominence: float = 0.02   # a wrist low point must drop this far (body units) to count as a strike
    strike_min_gap_ms: float = 50.0       # minimum gap between two strikes of the same hand
    strike_smooth_frames: int = 3         # moving average applied to wrist height before finding strikes
    # Audio and video cross-check (app/fusion.py)
    verify_window_ms: float = 40.0        # default A/V match window when a request does not set one
    low_fps_min_window_ms: float = 60.0   # under 50 fps the window is at least this ...
    low_fps_window_frames: float = 1.75   # ... and at least this many frame intervals
    # Sticking check (app/sticking.py)
    sticking_resync_cost: float = 2.0     # cost of restarting the pattern versus calling strokes wrong
    # Evaluation only (scripts/evaluate.py)
    match_tolerance_ms: float = 50.0      # a detected stroke matches a labeled one within this many ms
    # Coaching (app/coaching.py): when a finding is shown and how serious it is. Timing numbers are
    # measured against an even grid fitted to the player's own notes, after removing any speed-up.
    coach_min_hits: int = 16              # fewer detected hits than this: no coaching, ask for a longer take
    coach_min_group_hits: int = 6         # a hand or beat position needs this many hits to be judged
    coach_timing_tight_ms: float = 6.0    # average timing spread at or under this is a strength
    coach_timing_work_ms: float = 9.0     # ... at or over this is "worth working on"
    coach_timing_fix_ms: float = 15.0     # ... at or over this is "fix first"
    coach_hand_bias_ms: float = 8.0       # left hand this much earlier or later than the right on average
    coach_position_bias_ms: float = 10.0  # one beat position (1, e, &, a) this much off your other notes
    coach_bias_t: float = 2.5             # ... and the average must be this many standard errors from zero
    coach_low_fps_scale: float = 1.5      # under 50 fps hand-based thresholds are multiplied by this
    coach_drift_pct: float = 4.0          # tempo change start to end of at least this % is a finding
    coach_drift_fix_pct: float = 8.0      # ... at least this % is "fix first"
    coach_drift_min_bpm: float = 5.0      # ... and at least this many BPM
    coach_steady_pct: float = 2.0         # tempo change at or under this % is a strength
    coach_min_drift_s: float = 4.0        # takes shorter than this are not judged for speeding up or slowing down
    coach_target_pct: float = 3.0         # played tempo this % away from the target tempo is a finding
    coach_sticking_polish_pct: float = 97.0   # sticking accuracy under this: "nice to tidy up"
    coach_sticking_work_pct: float = 90.0     # ... under this: "worth working on"
    coach_sticking_fix_pct: float = 75.0      # ... under this: "fix first"
    coach_volume_ratio: float = 0.8       # quieter hand under this share of the louder hand is a finding
    coach_double_ratio: float = 0.8       # second note of a double under this share of the first is a finding
    coach_double_gap_ms: float = 10.0     # doubles squeezed or opened by this much versus the other notes
    coach_accent_ratio: float = 1.4       # a beat position this much louder than the rest counts as an accent
    coach_dynamics_cv_work: float = 0.3   # volume spread (std / mean) of unaccented notes at or over this
    coach_dynamics_cv_good: float = 0.15  # ... at or under this is a strength
    coach_travel_ratio: float = 0.65      # one wrist moving under this share of the other is a finding
    coach_travel_min: float = 0.04        # ... only when the bigger wrist travel is at least this (body units)
    coach_min_coverage: float = 0.8       # pose tracked on under this share of frames: no wrist advice
    coach_min_verified_pct: float = 50.0  # video matched fewer hits than this: hand advice gets a caveat
    coach_drill_pct: float = 80.0         # drill tempo: this % of the measured tempo, rounded down to a 10
    coach_max_findings: int = 4           # show at most this many findings


FIELD_TYPES = {f.name: f.type for f in fields(Tuning)}
CHOICES = {"hand_source": ("velocity", "strike_first")}


def _coerce(name: str, value):
    if name not in FIELD_TYPES:
        raise ValueError(f"Unknown tuning setting {name!r}. Known: {', '.join(FIELD_TYPES)}")
    kind = FIELD_TYPES[name]
    try:
        if kind == "float":
            out = float(value)
        elif kind == "int":
            out = int(float(value))
        else:
            out = str(value).strip()
    except (TypeError, ValueError):
        raise ValueError(f"Tuning setting {name} must be a {kind}, got {value!r}")
    if name in CHOICES and out not in CHOICES[name]:
        raise ValueError(f"Tuning setting {name} must be one of {', '.join(CHOICES[name])}, got {out!r}")
    return out


def with_values(base: Tuning, values: dict) -> Tuning:
    """A copy of base with values applied (names checked, types coerced)."""
    return replace(base, **{k: _coerce(k, v) for k, v in (values or {}).items()})


def tuning_file() -> Path | None:
    raw = os.environ.get("TUNING_FILE", "").strip()
    if raw:
        return Path(raw)
    default = ROOT / "tuning.json"
    return default if default.exists() else None


def load_file(path: Path) -> dict:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path} must hold a JSON object of tuning settings")
    return {k: v for k, v in data.items() if not k.startswith("_")}   # "_comment" keys are allowed


def load_base() -> Tuning:
    """Defaults, then the tuning file, then SIO_TUNE_* environment variables."""
    t = Tuning()
    path = tuning_file()
    if path is not None:
        t = with_values(t, load_file(path))
    env = {k[len(ENV_PREFIX):].lower(): v for k, v in os.environ.items() if k.startswith(ENV_PREFIX) and v.strip()}
    return with_values(t, env)


_base: Tuning | None = None
_override: contextvars.ContextVar[Tuning | None] = contextvars.ContextVar("sio_tuning", default=None)


def base() -> Tuning:
    global _base
    if _base is None:
        _base = load_base()
    return _base


def reload() -> Tuning:
    """Re-read the file and environment (tests, or after editing tuning.json)."""
    global _base
    _base = None
    return base()


def current() -> Tuning:
    """The settings in effect for this thread or task."""
    return _override.get() or base()


@contextmanager
def override(values: dict | Tuning | None = None):
    """Temporarily use other settings in this thread or task (evaluation and grid search)."""
    t = values if isinstance(values, Tuning) else with_values(current(), values or {})
    token = _override.set(t)
    try:
        yield t
    finally:
        _override.reset(token)


def as_dict(t: Tuning | None = None) -> dict:
    return asdict(t or current())


def diff(t: Tuning | None = None, ref: Tuning | None = None) -> dict:
    """Settings in t that differ from ref (default: the shipped defaults)."""
    a, b = as_dict(t), asdict(ref or Tuning())
    return {k: v for k, v in a.items() if b.get(k) != v}
