# Coaching: rules, thresholds and limits

`app/coaching.py` turns the numbers the analyzer already measures into advice a drummer can act on.
It is rules based: every sentence comes from a template filled in with the measured value, so the
same take always gives the same coaching and every claim can be traced to a number in the report.

The result is `coaching` in the report JSON (see `schema/report.schema.json`) and the Coaching
section at the top of the results page (analyzer and member portal Analyze tab).

## Output

```
coaching = {
  version, status: "ok" | "not_enough_data" | "error", message,
  focus,               one line: "Focus for your next take"
  focus_finding,       id of the finding the focus came from
  tempo_bpm, low_fps,
  findings: [          ranked, at most coach_max_findings (4)
    { id, severity: fix_first | work_on | polish, severity_label, title, saw, why,
      fix: [2 to 3 steps], drill: {name, tempo_bpm, text}, focus,
      examples: [{t, label, hand}] (up to 3, the worst moments, seconds from the start),
      hand: "L" | "R" | null, confidence: high | medium, caveat, metric: {...raw numbers} } ],
  strengths: [{id, title, saw, metric}]   1 to 2, from different areas
  notes: [...]         what we could not judge, or how sure we are
}
```

Severity labels shown to drummers: **Fix first**, **Worth working on**, **Nice to tidy up**.
Findings are sorted by severity, then confidence, then how far past the threshold they are.

## How timing is measured

There is usually no click in the recording, so timing is judged against an even grid fitted to the
player's own notes (grid index versus onset time, quadratic fit when there are 12 notes or more).
The fit absorbs a gradual speed-up or slow-down, so the timing numbers are "unevenness after
allowing for the tempo change", and the tempo change itself is its own finding. The first and last
note are left out of timing statistics and examples (they are often a pickup or a trailing hit).

Left versus right and beat position findings are always comparisons (this hand versus the other,
these notes versus all your other notes), tested with a Welch t statistic so a couple of stray
notes cannot create a finding.

## Rules

All thresholds are `coach_*` settings in `app/tuning.py` (overridable with `tuning.json` or
`SIO_TUNE_COACH_*`), so they can be tuned against labeled clips with `scripts/evaluate.py` data.

| Finding id | Shown when | Severity |
|---|---|---|
| `tempo_drift` | tempo of the first third versus the last third changes by at least `coach_drift_pct` (4%) and `coach_drift_min_bpm` (5 BPM), take at least `coach_min_drift_s` (4 s) | Fix first at `coach_drift_fix_pct` (8%) |
| `target_tempo` | a target tempo was entered and the played tempo is `coach_target_pct` (3%) or more away | Worth working on |
| `timing_spread` | mean absolute residual at or over `coach_timing_work_ms` (9 ms) | Fix first at `coach_timing_fix_ms` (15 ms) |
| `timing_bias` | one hand early or late versus the other by `coach_hand_bias_ms` (8 ms), or a beat position (1, e, &, a; paradiddles only) versus the other notes by `coach_position_bias_ms` (10 ms), with `abs(t) >= coach_bias_t` (2.5) and at least `coach_min_group_hits` (6) notes per group | Fix first at twice the threshold |
| `sticking` | paradiddle sticking accuracy under `coach_sticking_polish_pct` (97%) | Worth working on under 90%, Fix first under 75% |
| `double_volume` | second note of the doubles under `coach_double_ratio` (0.8) of the first | Worth working on |
| `double_spacing` | doubles squeezed or opened by `coach_double_gap_ms` (10 ms) versus the other notes | Worth working on |
| `accent_position` | one position is `coach_accent_ratio` (1.4x) louder than the rest and it is not beat 1 (worded as something to check, because we do not know which accent was intended) | Worth working on |
| `volume_spread` | unaccented notes vary by `coach_dynamics_cv_work` (30%) or more | Worth working on |
| `hand_volume` | one hand's unaccented notes under `coach_volume_ratio` (0.8) of the other | Worth working on |
| `wrist_travel` | one wrist moves under `coach_travel_ratio` (0.65) of the other, the bigger one at least `coach_travel_min` (0.04 shoulder widths), pose on at least `coach_min_coverage` (80%) of frames, and the video is 50 fps or more | Worth working on |

Strengths: steady tempo (change at or under `coach_steady_pct`, 2%), tight timing (at or under
`coach_timing_tight_ms`, 6 ms, and no timing bias flagged), clean sticking, clear accents, even
volume (at or under `coach_dynamics_cv_good`, 15%). If none apply, a factual one is used ("You kept
going through the whole take").

Drill tempo: `coach_drill_pct` (80%) of the measured tempo, or of the starting tempo when the player
sped up or slowed down, rounded down to a multiple of 10, always slower than measured, at least 40.

## Confidence gating

- Fewer than `coach_min_hits` (16) hits: `status: "not_enough_data"` and a message asking for a longer take.
- Hand-based findings need the video: with a degraded video there is no hand advice at all. When the
  video matched fewer than `coach_min_verified_pct` (50%) of hits to a wrist stroke, hand findings
  get a caveat and medium confidence, and a note says the hand advice is less certain than the
  timing advice (which comes from the sound).
- Under 50 fps (`quality.low_fps`): hand timing thresholds are multiplied by `coach_low_fps_scale`
  (1.5), wrist travel is not judged, and a note says so ("hard to judge at 30 fps").

## Not judged (on purpose)

- **Posture, elbow and wrist angles**: a front-on phone video cannot measure them reliably. A note says so.
- **Flams**: onset detection merges notes closer than `min_ioi_ms` (40 ms), so flams are not separated.
- **Stick height**: only the wrists are tracked, not the stick tips. Wrist travel is reported as wrist
  movement with that caveat.
- **Which accent was intended**: the analyzer does not know the exercise's accent pattern, so an
  accent off beat 1 is worded as a check, not a mistake.

## Updating

Bump `VERSION` in `app/coaching.py` when rules or wording change. `GET /api/results/{id}` recomputes
older coaching on read; `python -m scripts.backfill_coaching [job_id ...] [--force]` writes it into
the saved reports. The drill names and wording are placeholders written for this first version and
are meant to be reviewed by Mike.
