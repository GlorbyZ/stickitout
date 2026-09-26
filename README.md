# Stick It Out Analyzer

Drum form and speed analysis from one phone video. The member records (or uploads) a
video of themselves playing, ideally at 60 fps (30 fps is accepted with a disclaimer). The analyzer pulls the audio out of that video,
finds every hit, measures tempo and timing, tracks shoulders, elbows, wrists and hands
with MediaPipe, and cross-checks the two: a hit only counts as **verified** when the
video shows a wrist strike at the same moment. For single paradiddles it also checks the
sticking (RLRR LRLL).

Standalone and local by design: no Stick It Out accounts, no worker changes. Batch
analysis runs on the server; the live skeleton in Record mode is only a framing aid.

## Contents

- [Quick start (Windows)](#quick-start-windows)
- [Linux or macOS](#linux-or-macos)
- [Settings](#settings)
- [Run it anywhere: Docker](#run-it-anywhere-docker)
- [Remote access over HTTPS](#remote-access-over-https)
- [Camera guide](#camera-guide)
- [Record mode](#record-mode)
- [What the results mean](#what-the-results-mean)
- [Recording for training](#recording-for-training)
- [Training data: labeling clips](#training-data-labeling-clips)
- [Accuracy evaluation](#accuracy-evaluation)
- [Tuning settings](#tuning-settings)
- [API](#api)
- [Tests](#tests)
- [Real-sample test (manual)](#real-sample-test-manual)
- [Deviations from the build spec](#deviations-from-the-build-spec)
- [Member portal integration](#member-portal-integration-live-since-2026-09-26)
- [Layout](#layout)

## Quick start (Windows)

Needs Python 3.13 (3.11 or 3.12 also work) and the **Microsoft C++ Build Tools**
("Desktop development with C++"), because aubio is published as source only.

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip setuptools wheel
.\.venv\Scripts\python.exe -m pip install numpy==2.5.3
.\.venv\Scripts\python.exe -m pip install --no-build-isolation aubio==0.4.9
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe scripts\fetch_models.py      # MediaPipe models into .\models (also automatic on first run)
.\start-local.ps1                                        # http://127.0.0.1:8800/
```

ffmpeg comes bundled with `imageio-ffmpeg`; nothing else to install.

## Linux or macOS

```bash
python3.11 -m venv .venv && . .venv/bin/activate
pip install --upgrade pip setuptools wheel "numpy==2.4.6"      # numpy==2.5.3 on Python 3.12+
CFLAGS="-Wno-error=incompatible-pointer-types" pip install --no-build-isolation aubio==0.4.9
pip install -r requirements-dev.txt
uvicorn app.main:app --host 127.0.0.1 --port 8800
```

The CFLAGS line is needed with GCC 14 or newer. On a headless Linux box MediaPipe needs
`libegl1 libgles2 libgl1 libglib2.0-0` (the Docker image already has them).

## Settings

All settings are environment variables, the same everywhere (local, Docker, cloud):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8800` | HTTP port |
| `DATA_DIR` | `./data/jobs` | where uploads, audio and reports are stored |
| `MAX_UPLOAD_MB` | `1024` | upload cap; keep it under 100 behind Cloudflare |
| `ACCESS_TOKEN` | empty | if set, the UI and API need this key (see below) |
| `JOB_TTL_HOURS` | `72` | jobs older than this are deleted, uploads included; `0` keeps everything |
| `MIN_FPS` | `23.5` | lowest measured frame rate accepted (24 fps and the 23.976 film rate pass); slower clips get a `422` |
| `DATASET_DIR` | `DATA_DIR/dataset` | training clips and their labels; never cleaned up (see [Training data](#training-data-labeling-clips)) |
| `TUNING_FILE` | `./tuning.json` if present | analyzer thresholds (see [Tuning settings](#tuning-settings)) |
| `SIO_TUNE_<NAME>` | none | one tuning setting, e.g. `SIO_TUNE_ONSET_THRESHOLD=0.25` (beats the file) |

**Access gate.** With `ACCESS_TOKEN` set, open `https://host/?key=<token>` once: the server
sets an HttpOnly cookie (30 days) and redirects to the clean URL. Scripts can send
`X-Access-Token: <token>` or `Authorization: Bearer <token>`. Without a key the page shows
a key prompt and the API returns `401 {"error": ...}`. `/healthz` stays open for host
health checks. It is a shared secret for a private test link, not user accounts.

## Run it anywhere: Docker

The image is `python:3.11-slim` with ffmpeg and the GL/EGL libraries MediaPipe needs,
aubio compiled in a build stage, and the models baked in, so it runs the same on any host.

```bash
docker compose up -d --build                     # http://localhost:8800/?key=<ACCESS_TOKEN>
```

Put settings in a `.env` file next to `docker-compose.yml`:

```
ACCESS_TOKEN=pick-a-long-random-string
MAX_UPLOAD_MB=500
```

Plain Docker: `docker build -t sio-analyzer . && docker run -d -p 8800:8800 -e ACCESS_TOKEN=... -v sio-data:/data sio-analyzer`.

**Sizing.** 2 vCPU and 2 GB RAM is comfortable. Analysis takes roughly 2x the clip
length (a 20 s 720p60 clip took 41 s on the development PC; MediaPipe dominates), one job at a time.

### One-command deploy options (all build the same Dockerfile)

None of these were set up; each needs your own account and may cost money beyond free tiers.

- **Any Docker VM** (Hetzner, DigitalOcean, Lightsail, a spare PC):
  `docker compose up -d --build`, then for HTTPS either
  `docker compose --profile tunnel up -d` (Cloudflare quick tunnel, URL in
  `docker compose logs tunnel`) or put Caddy in front with your domain.
- **Fly.io**: `fly launch --no-deploy` (detects the Dockerfile), `fly volumes create data --size 3`,
  add `[mounts] source="data" destination="/data"` to `fly.toml`,
  `fly secrets set ACCESS_TOKEN=...`, then `fly deploy`. Use at least a `shared-cpu-2x` / 2 GB machine.
- **Render**: New > Web Service > this repo, runtime Docker, add a disk mounted at `/data`,
  set `ACCESS_TOKEN` in Environment. Render sets `PORT` itself; the image honors it.
- **Railway**: `railway init && railway up`, add a volume at `/data`, set `ACCESS_TOKEN`
  in Variables. Railway also sets `PORT`.

## Remote access over HTTPS

Phone browsers only allow the camera on HTTPS pages (or `localhost` on the same device).
From the Windows PC:

```powershell
.\start-remote.ps1          # server + named tunnel: https://analyzer-origin.stickitoutdrums.com/?key=<key>
.\stop-remote.ps1           # stops the server and the tunnel (only this analyzer's processes)
.\start-remote.ps1 -NewKey  # restart with a fresh key (old links stop working, see below)
.\start-remote.ps1 -Quick   # use a temporary trycloudflare.com quick tunnel instead
.\restart-server.ps1        # restart only the server (after a code change); tunnel, link and key stay
```

- **Stable address.** When `.tunnel-token` exists (gitignored), `start-remote.ps1` runs the
  separate named Cloudflare Tunnel `sio-analyzer-origin` (id `4a6ec999-62d3-4426-b7ca-4b0ee23e011b`,
  created 2026-09-26 on the Stick It Out Cloudflare account, free). It is always
  `https://analyzer-origin.stickitoutdrums.com`, so the address no longer changes on restart.
  Its ingress is set in Cloudflare and forwards to `http://127.0.0.1:8800`, so the server must
  use port 8800 (the script refuses another `-Port` in named mode). cloudflared reads the token
  with `--token-file`, so it never appears on a command line.
- **Access.** Every path except `/healthz` still needs the key (`?key=` link, cookie, or
  `X-Access-Token` header), so the public hostname is useless without it. The member portal adds
  the header server-side.
- **Quick tunnel fallback.** `-Quick` (or no `.tunnel-token`) gives the old behavior: a new
  `trycloudflare.com` address on every start, no account needed. The portal does not follow it.
- **Other tunnels are never touched.** This PC also runs a separate, pre-existing cloudflared
  tunnel service. `stop-remote.ps1` only stops processes whose command line proves they are this
  analyzer's: `scripts\serve-remote.ps1` and its uvicorn on the port, cloudflared reading this
  folder's `.tunnel-token`, or a quick tunnel to the port that logs into this folder's `logs\`.
- It installs `cloudflared` with winget if it is missing, starts the server with a random
  `ACCESS_TOKEN` (kept in `.remote-token`) and `MAX_UPLOAD_MB=95`, and saves the link to
  `remote-url.txt`.
- Both processes run detached and survive closing the window. The server keeps the PC from
  sleeping while it runs, but **the PC must stay on and online** for the link (and the portal
  Analyze tab) to work.
- Cloudflare caps uploads at 100 MB. Record mode records at about 8 Mbps and stops itself at
  the cap (about 90 seconds); phone camera files are bigger, so keep uploads to 30 to 45 seconds.
- To recreate the tunnel token file: Cloudflare dashboard, Zero Trust, Networks, Tunnels,
  `sio-analyzer-origin`, copy the connector token into `.tunnel-token` (one line, no spaces).

## Camera guide

- **60 fps is best, 30 fps works, 1080p.** iPhone: Settings > Camera > Record Video >
  1080p at 60 fps. Android: pick 60 fps in the camera's video settings. The analyzer
  measures the real frame rate from the file's timestamps, so variable frame rate phone and
  browser recordings are judged by what they actually delivered.
  - **50 fps and up** (60 fps class): full accuracy, verify window as requested (default 40 ms).
  - **About 24 to 50 fps** (ordinary 30 fps phone video, including uneven frame timing):
    analysed, but the report sets `quality.low_fps: true` with a message, the results page
    shows a disclaimer next to the Verified score ("Recorded at 30 fps. Fast strokes can
    fall between frames, so Verified, sticking and form scores are estimates. For the most
    accurate results, record at 60 fps."), and the verify window is widened (see below).
  - **Under `MIN_FPS`** (default 23.5, so about 24 fps): rejected with a clear message.
- **Tripod.** Side (profile) view is preferred because it shows stroke height; front view works.
- **Frame:** full torso, both arms and the pad or drum visible the whole time.
- **Good light and a plain background.** Many cameras quietly drop from 60 to 30 fps in dim rooms.
- Keep the phone's microphone uncovered; the hits are found from the video's own audio.

## Record mode

The Analyze page has **Record** and **Upload a video** modes.

Record opens the camera through `getUserMedia` (asking for 1080p at 60 fps, with echo
cancellation, noise suppression and auto gain turned off so drum transients survive) and
draws the MediaPipe pose and hand skeleton live over the preview using MediaPipe Tasks
Vision for the browser (PoseLandmarker lite + HandLandmarker, loaded from the jsDelivr CDN).
Shoulders, elbows and wrists are highlighted in gold, hands in blue. A framing panel says
what to fix ("Step back: both arms not visible", "left wrist not visible", "Move the camera
closer", and so on).

MediaRecorder records the **raw camera and microphone stream**, not the canvas, so the
skeleton is never baked into the file. The browser picks MP4 (H.264/AAC) where supported
and WebM (VP9 or VP8/Opus) otherwise; the server accepts both. The page shows the camera's
delivered frame rate live and the measured frame rate of each take. Before upload it notes
when a take is under 50 fps (it will be analysed with the low frame rate disclaimer) and
warns when it is under the minimum (it will be rejected). Upload and Record mode both show
the tip "60 fps is best. 30 fps works too". If skeleton detection is too slow on a device (no GPU), it
pauses during recording so the recording keeps its full frame rate.

On the results page, "Draw skeleton on playback" runs the same browser models over the
uploaded video.

Needs internet for the CDN files and a secure page: `http://localhost:8800` on the same
computer, or HTTPS (see [Remote access](#remote-access-over-https)) on a phone.

## What the results mean

Every score is 0 to 100 and the exact formulas are in the "How scores work" panel:

| Score | Formula |
|---|---|
| Timing | `max(0, 100 - mean_abs_error_ms * 2)` against the tempo grid |
| Consistency | `max(0, 100 - std(ioi) / mean(ioi) * 100)` |
| Dynamics | `max(0, dynamics_evenness * 100)`, evenness = `1 - std(velocity) / mean(velocity)` |
| Form | mean of stroke-height consistency, `symmetry * 100`, and `max(0, 100 - abs(posture_drift_per_min) * 500)`; `null` with a reason when under half the frames show both wrists |
| Overall | mean of the non-null scores above |
| **Verified** | `verified / (verified + unverified + video_only) * 100`, shown on its own |

**Cross-verification.** Each audio onset is matched one-to-one (closest pairs first) with
video wrist strikes (low points of a wrist) within plus or minus `verify_window_ms`
(default 40). For clips under 50 fps the window is widened automatically to
`max(requested, 60 ms, 1.75 frame intervals)`, which is 60 ms at 30 fps and about 73 ms at
24 fps, because a wrist low point can only be seen on a frame and may fall up to half a
frame from the real impact. `params.verify_window_ms` keeps the requested value;
`verification.window_ms` (and `quality.verify_window_ms`) is the window actually used,
with `verification.window_requested_ms` and `window_widened`. 60 fps behaviour is unchanged. Matched onsets are `verified`; onsets with no strike are `unverified`
(heard, not seen); strikes with no onset are `video_only` (seen, not heard). The report
gives the counts, `agreement_pct`, and verified-only tempo and timing. A low Verified
score means the camera could not confirm the hits: framing, light, or a sync offset
(`av_offset_ms`).

**Sticking.** For "Single Paradiddle" the per-stroke hands are aligned with RLRR LRLL
(either hand leading) using a small dynamic-programming alignment that can resync after a
dropped or extra stroke. The report gives `sticking_accuracy_pct` and every break (time,
stroke number, expected vs played).

## Recording for training

Real clips from Zaylyn and Mike Staus, labeled by hand, are how the analyzer gets measured
and tuned. A short version of this guide is shown in Record mode ("Recording for training")
and on the Label page; the full shot list is in
[docs/training-shot-list.md](docs/training-shot-list.md).

For every take:

- **Side angle.** Phone level with the pad or drum, 2 to 3 m away, looking at the player's side.
- **Both arms and both sticks in frame** the whole take, plus the pad or snare.
- **Good, even light.** Face a window or lamp; no bright window behind the player.
- **Phone on a stand** or tripod, never hand held.
- **One clap at the start** with hands in view, then count in. It lines up sound and picture
  (mark it with `C` on the Label page and it is left out of scoring).
- **Click running**, loud enough to be heard on the recording. Write down its BPM.
- **30 to 45 seconds** per take.
- **60 fps preferred** (iPhone: Settings > Camera > Record Video > 1080p at 60 fps). 30 fps works but is less accurate.

**Shot list (about 20 takes):** pad and snare; slow (70), medium (100) and fast (as fast as
clean, about 120 to 140); singles, doubles and single paradiddles; one take with accents and
one with ghost notes; and deliberately sloppy takes: flipped sticking, dragging behind the
click, one hand dropping out, uneven doubles, and a mixed one. Optional extras repeat one
take from the front, at 30 fps and in dim light, to show how much the setup matters.

## Training data: labeling clips

Open **`/label`** on the analyzer link (the same access key; the tab next to Analyze). It
lists every clip in the dataset with its status (draft, done, analyzing, error).

**Adding clips.** Either upload the original video file with **Add a clip** on the Label
page (player, rudiment, click BPM and surface can be filled in right away), or analyze a
video on the Analyze page and press **Add to training set** under the results. Either way
the original file is stored byte for byte, the analyzer runs on it in the background, and
the clip opens with the analyzer's strokes already marked, so labelers only fix mistakes.

**Labeling a clip** (laptop keyboard recommended; the on-screen buttons also work on a phone):

1. Pick the clip. Press `2` (0.5x) or `1` (0.25x) and `Space` to play. `Left`/`Right` (or
   `,`/`.`) step one frame; `Shift`+`Left`/`Right` jump a second; `Up`/`Down` go to the
   previous or next stroke.
2. The timeline under the video shows left strokes on the top lane (blue), right strokes on
   the bottom lane (red), unknown hands in the middle, the waveform behind them, and the
   analyzer's original detections as small white triangles.
3. Tap `F` (left) or `J` (right) on every stroke. A tap on an existing marker sets its hand
   (so you can tap along to fix hands); a tap where nothing is marked adds a stroke.
   `Shift`+`F`/`J` adds an accented stroke, `D`/`K` a ghost note. Taps snap to the nearest
   sound onset within 40 ms (switch off under the timeline), and "Tap delay" compensates for
   late taps while playing.
4. Click a marker to select it, then `A` accent, `G` ghost, `X` sticking mistake (wrong hand
   for the rudiment), `H` swap hand, `Del` delete, `M` move it to the playhead,
   `Alt`+`Left`/`Right` nudge 5 ms. Drag a marker to move it, or to the other lane to change
   the hand. `Ctrl`+`Z` / `Ctrl`+`Y` undo and redo.
5. `C` marks the sync clap. `I` and `O` optionally limit scoring to part of the clip.
6. Fill in **Clip details**: player, labeler, rudiment, click BPM, notes per click, surface,
   camera angle, fps, lighting, clean or deliberately sloppy, known mistakes, and **Mike's
   form grade (1 to 10) with a short comment**. Tick "I flagged every sticking mistake" if you
   marked them all with `X`; otherwise evaluation works them out from the labeled hands.
7. **Save and mark done** (`Ctrl`+`S` saves a draft; drafts also autosave every 20 seconds).
   Only clips marked done are evaluated by default.

**Files.** Each clip is a folder `DATASET_DIR/<clip_id>/` (by default
`data\jobs\dataset\<clip_id>\`): `video.<ext>` (the original), `labels.json` (strokes and
details, schema in [schema/labels.schema.json](schema/labels.schema.json), checked on every
save by `app/labels.py`), `labels.prev.json` (the previous save), `analysis.json` (the
analyzer's report at intake), `waveform.json`, `audio.wav`, `preview.mp4` (only when the
original will not play in a browser, such as iPhone HEVC) and `cache/` (MediaPipe landmarks,
so evaluation re-runs are fast). Stroke times are seconds from the start of the video.
Clips are never deleted automatically; to remove one, delete its folder.

## Accuracy evaluation

```powershell
.\scripts\evaluate.ps1                  # all clips marked done; add -Open to open the HTML report
.\scripts\evaluate.ps1 --include-drafts # also clips still being labeled
```

(`python scripts/evaluate.py` with the same options on Linux or macOS.) It runs the analyzer
over every labeled clip, compares it with the labels, prints the headline numbers and writes
`reports\eval-<timestamp>\` with `report.md`, `report.html`, `clips.csv` (one row per clip)
and `summary.json`.

Metrics, per clip and overall:

| Metric | Meaning |
|---|---|
| Stroke precision, recall, F1 | detected strokes matched one to one to labeled strokes within plus or minus 50 ms (`--tolerance-ms`), closest pairs first |
| Hit count error | detected minus labeled strokes (and as a percentage) |
| Hand-assignment accuracy | matched strokes given the labeled hand (no detected hand counts as wrong); hand coverage says how often a hand was detected |
| Sticking-error detection | labeled wrong-hand strokes the analyzer flagged (caught), missed, and false alarms |
| Tempo error | analyzer tempo minus the click BPM (octave errors flagged), plus the tempo implied by the labels |
| Timing-error MAE | the analyzer's per-stroke timing error versus the labeled stroke's error against the click grid; onset placement MAE is detected time versus labeled time |
| Form correlation | Pearson and Spearman correlation of the analyzer's form score with Mike's grades, once at least 5 clips are graded (`--min-corr-clips`) |

Only the scored region counts: after the clap (plus 0.25 s) or between the `I` and `O` marks.

**Comparing runs.** `--compare-to reports\eval-<earlier>` adds a comparison (each metric
marked better or worse, and per clip F1 changes) to the new report;
`--compare reports\eval-A reports\eval-B` compares two finished runs without re-running.

**Trying settings.** `--set name=value` (repeatable) or `--tuning file.json` for one run;
`--grid name=v1,v2,...` (repeatable) runs every combination and ranks them by `--objective`
(`f1` by default; also `hand_accuracy`, `timing_error_mae_ms`, `combined` and others):

```powershell
.\scripts\evaluate.ps1 --grid onset_threshold=0.2,0.3,0.4 --grid min_ioi_ms=30,40,50
```

That writes `reports\grid-<timestamp>\` with `grid.md`, `grid.csv`, the baseline report,
the best combination's full report (with a comparison against the baseline) and
`best-tuning.json`. MediaPipe landmarks are cached per clip, so only the first run over a
clip is slow; `--no-cache` forces a fresh pass.

## Tuning settings

Every threshold that decides what counts as a stroke, which hand played it and whether
audio and video agree is in one place, `app/tuning.py` (the `Tuning` dataclass, with the
shipped defaults and a comment per setting). Override them without editing code:

1. `tuning.json` in the project folder (or the file named by `TUNING_FILE`), for example
   `{"onset_threshold": 0.25, "min_ioi_ms": 35}`. A grid search's `best-tuning.json` can be
   copied here as is.
2. Environment variables `SIO_TUNE_<NAME>`, e.g. `SIO_TUNE_HAND_WINDOW_MS=50`.

Restart the server (`.\restart-server.ps1`) after changing either. The settings used are
recorded in every report under `engine.tuning`.

| Setting | Default | What it does |
|---|---|---|
| `onset_method` | `specdiff` | aubio onset function (`hfc`, `complex`, `energy`, ...) |
| `onset_threshold` | `0.3` | onset sensitivity: lower finds more, quieter hits |
| `onset_silence_db` | `-90` | ignore audio quieter than this |
| `min_ioi_ms` | `40` | minimum stroke spacing: onsets closer than this count once |
| `min_rel_velocity` | `0.05` | drop onsets under this share of the loudest hit |
| `hand_window_ms` | `40` | wrist motion window around each onset for hand assignment |
| `hand_source` | `velocity` | `velocity` (fastest downward wrist) or `strike_first` (the matched video strike's hand) |
| `min_wrist_visibility` | `0.5` | frames with a less visible wrist are dropped |
| `strike_min_prominence` | `0.02` | how far a wrist must drop (body units) to count as a video strike |
| `strike_min_gap_ms` | `50` | minimum gap between strikes of one hand |
| `strike_smooth_frames` | `3` | smoothing before finding strikes |
| `verify_window_ms` | `40` | default audio/video match window (a request can still set its own) |
| `low_fps_min_window_ms` | `60` | under 50 fps the window is at least this ... |
| `low_fps_window_frames` | `1.75` | ... and at least this many frame intervals |
| `sticking_resync_cost` | `2.0` | cost of restarting the sticking pattern versus calling strokes wrong |
| `match_tolerance_ms` | `50` | evaluation only: label to detection match window |

## API

All JSON. Errors are `{"error": "message"}` with a proper status code. With
`ACCESS_TOKEN` set, send the cookie from the `?key=` link or an `X-Access-Token` header.

| Method and path | Result |
|---|---|
| `POST /api/analyze` | multipart: `video` (required; mp4, mov, m4v, webm, mkv, avi), `rudiment` (default "Single Paradiddle"), `target_bpm`, `av_offset_ms` (default 0), `verify_window_ms` (5 to 200, default 40; widened automatically under 50 fps). `202 {"job_id"}`. `415` bad type, `413` over the cap, `422` bad field or under `MIN_FPS` (about 24 fps; message says the measured rate and how to fix it). |
| `GET /api/jobs/{id}` | `{status: queued, processing, done or error, progress: 0 to 1, stage, error}` |
| `GET /api/results/{id}` | full report (`schema/report.schema.json`); `409` not ready, `422` failed, `404` unknown |
| `GET /api/jobs/{id}/video` | the uploaded video (for playback) |
| `GET /api/config` | `{max_upload_mb, access_gate, min_fps, full_accuracy_fps}` |
| `GET /label` | Label page (training data) |
| `GET /api/dataset` | `{clips: [...]}` with status, stroke counts and details per clip |
| `POST /api/dataset` | multipart: `video` plus optional `player`, `labeler`, `rudiment`, `click_bpm`, `surface`, `camera_angle`, `lighting`, `take_type`. `202 {"clip_id"}`; analysed in the background to pre-fill strokes. Same `413`/`415`/`422` rules as `/api/analyze`. |
| `POST /api/dataset/from-job/{job_id}` | copy a finished analysis (original video and report) into the dataset. `202 {"clip_id", "label_url"}` |
| `GET /api/dataset/{clip_id}` | `{labels, status, video, detections, onsets, analysis}` |
| `PUT /api/dataset/{clip_id}/labels` | save labels (JSON, `schema/labels.schema.json`); `422` with the problem when invalid |
| `POST /api/dataset/{clip_id}/reanalyze` | re-run the analyzer for fresh detections (labels untouched) |
| `GET /api/dataset/{clip_id}/video` | the clip (a browser copy when the original codec will not play) |
| `GET /api/dataset/{clip_id}/waveform` | `{rate, duration_s, peaks}` for the labeling timeline |
| `GET /healthz` | `{"ok": true}`, never gated |

```powershell
curl.exe -H "X-Access-Token: $env:KEY" -F "video=@take.mp4" -F "rudiment=Single Paradiddle" -F "target_bpm=100" https://host/api/analyze
```

Report sections: `source` (fps measured and declared, duration, size, container),
`quality` (`low_fps`, `measured_fps`, `min_fps`, `full_accuracy_fps`, `verify_window_ms`,
`verify_window_widened`, `message`: the disclaimer when `low_fps` is true, otherwise null),
`params`, `audio` (onsets with timing error and velocity, tempo, grid, rolling and top
sustained BPM, IOIs, timing histogram, dynamics, pattern guess, waveform), `video`
(coverage, degraded flag and reason, form metrics, wrist trajectories), `strokes`
(t, hand, expected_hand, timing_error_ms, velocity, stroke_height, arm_vs_wrist_index,
elbow_angle_deg, verification, av_delta_ms), `verification`, `sticking`, `scores`
(with `per_hand`), `engine` (library versions).

Jobs run one at a time in FastAPI BackgroundTasks with flat files under `DATA_DIR/{id}/`.
To scale out, swap `app/jobs.py` and the BackgroundTasks call for a Celery or RQ worker on
Redis (and job.json for a database row); the pipeline does not change.

## Tests

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

| File | Covers |
|---|---|
| `test_audio_synthetic.py` | spec 10.1: 60 s click at 120 BPM, tempo 120 plus or minus 1, mean error under 5 ms, 720 onsets within 2% |
| `test_api.py` | spec 10.3: end-to-end upload of a synthetic 60 fps video, report validated against the schema (no low fps flag, 40 ms window); 30 fps accepted with `quality.low_fps`, the disclaimer and a 60 ms window; 15 fps rejected; schema check of the `quality` rules; `/api/config` fps limits; error contracts |
| `test_fusion_sticking.py` | cross-verification counts (a hidden strike gives 1 unverified, an extra strike gives 1 video_only), hand assignment, sticking breaks and resync, schema of a non-degraded report; verify window widening (only under 50 fps) and 30 fps strikes between frames still verified |
| `test_video_mediapipe.py` | real MediaPipe on the synthetic paradiddle drummer at 60 fps (coverage, Verified, sticking, schema) and at 30 fps (low fps flag, 60 ms window, still verified); skips if MediaPipe cannot run |
| `test_media.py` | frame-rate measurement for WebM, variable frame rate, 30 fps and uneven 30 fps accepted and flagged, below-minimum rejection message, `MIN_FPS` configurable |
| `test_access.py` | access gate, upload cap, old-job cleanup |
| `test_labels_dataset.py` | labels.json schema (Python validator and JSON Schema agree on valid and invalid files), clip upload with pre-filled strokes, saving labels, Add to training set from a job, dataset errors, `/label` behind the gate, no em dashes in user-facing copy |
| `test_evaluate.py` | tuning file, environment and override; metric maths (matching, hands, tempo, sticking caught/missed/false alarms, timing error, form correlation, run comparison); end to end on the synthetic drummer labeled with its known strokes (near perfect F1, hands, tempo, timing), a sloppy-labeled copy, `--compare-to`, `--compare` and a grid search |

Synthetic inputs: `python scripts/make_click_test.py` writes the 120 BPM fixture;
`python scripts/make_test_video.py out.mp4 [--drummer] [--fps 30]` makes test videos
(`--fps 30` gives a low frame rate clip, `--fps 15` one the API rejects).
`--drummer` animates MediaPipe's public pose sample photo so each arm dips on its
paradiddle strokes in time with a click track; `--labels strokes.json` also writes its known
strokes (the answer key used by `test_evaluate.py`).

## Real-sample test (manual)

Spec 10.2, still to be done with a real recording:

1. Record 30 s of single strokes on a practice pad at about 100 BPM, phone at 60 fps on a
   tripod, side angle, with **one loud clap at the start** (hands visible).
2. Analyze it (rudiment "Single Stroke Roll", target 100).
3. Check: `video.landmark_coverage > 0.85`; the report generates without error; the clap
   onset and the video frame where the hands meet are within 50 ms (A/V sync; the
   `verification.median_av_delta_ms` value should also be small); scores are sane (timing
   above 40 for a decent player).
4. Save the report, strip anything identifying (the filename), and commit it as
   `samples/report.json`.

## Deviations from the build spec

- **Python 3.13 on the PC** (the spec pins 3.11). Both official aubio and mediapipe install
  on 3.13. The code is 3.11-compatible: the Docker image is Python 3.11 and the full test
  suite passes on 3.11 with official aubio 0.4.9 and librosa 0.11.
- **opencv-contrib-python** instead of opencv-python: mediapipe requires contrib, and both
  packages installing `cv2` would clash.
- **MediaPipe Tasks API** (PoseLandmarker, HandLandmarker) with downloaded `.task` models:
  mediapipe 1.x removed the legacy `mp.solutions` API.
- **Adaptive grid.** The spec asks for a 16th-note grid, but its own 120 BPM / 720-onset
  test is 6 hits per beat. The grid subdivision is picked from the inter-onset intervals:
  6 per beat for sextuplet-like spacing, otherwise 16ths.
- **Fixture noise floor.** The click fixture has a -60 dBFS noise floor; aubio misbehaves on
  pure digital silence.
- **Side-view normalization.** Heights use shoulder width; if the shoulders overlap (side
  view, shoulder width under half the upper-arm length) the upper-arm length is used and
  the report says so.
- **Hands matched by position.** MediaPipe's handedness labels assume a mirrored selfie
  image, so each detected hand is assigned to the nearest pose wrist instead.
- **Frame-rate thresholds.** 50 fps and up is analysed at full accuracy (60 fps-class
  variable-rate footage passes). From `MIN_FPS` (about 24) up to 50 fps, clips are accepted
  for now with `quality.low_fps`, a disclaimer and a widened verify window; below that they
  are rejected.
- **Scope additions requested during the build:** cross-verification and the Verified score,
  paradiddle sticking check, Record mode with the live skeleton, access gate, Docker, and
  the remote tunnel script.

## Member portal integration (live since 2026-09-26)

The member portal (`Stickitout\workers\app`, Worker `stickitout-portals`) has an **Analyze**
tab at `https://member.stickitoutdrums.com/analyze` that replaced Challenges in the member nav.

- **Design: Worker proxy.** The Worker checks the member session, then proxies an allowlist of
  analyzer routes under `/analyze/`: `/analyze/static/*` (not `label.*`), `GET /api/config`,
  `POST /api/analyze` (the upload body is streamed), `GET /api/jobs/<id>`, `/api/jobs/<id>/video`
  (Range requests pass through for playback) and `/api/results/<id>`. The label page, dataset
  intake and everything else are not reachable from the portal.
- **The key never reaches the browser.** The Worker adds `X-Access-Token` from its
  `ANALYZER_TOKEN` secret. The origin URL is the `ANALYZER_ORIGIN` secret
  (`https://analyzer-origin.stickitoutdrums.com`). Portal cookies are not forwarded, and analyzer
  `Set-Cookie` headers are dropped.
- **UI.** The Worker fetches this app's `index.html` on each page view, takes the `<main>`
  markup, and renders it inside the portal header and dock with the portal's own dark theme
  (the portal does not load `static/style.css`). The JS is served through the proxy with its
  `"/api/"` URLs rewritten to `"/analyze/api/"`, so **keep API calls in `static/*.js` as absolute
  `/api/...` strings** and keep element ids stable. Buttons with ids `add-training`,
  `add-training-msg`, `json-link` and the `.training-guide` block are hidden in the portal.
  Record mode runs top level on the portal page (no iframe), which sends
  `Permissions-Policy: camera=(self), microphone=(self)`.
- **Offline.** If the tunnel or server is down, the tab shows "Analyzer is offline right now, try
  again later." and API calls get a 503 JSON error with the same text.
- **New key.** After `.\start-remote.ps1 -NewKey`, update the portal secret from the
  `Stickitout` folder or the tab shows offline:
  `Get-Content -Raw ..\Stickitout-analyzer\.remote-token | npx wrangler secret put ANALYZER_TOKEN --config workers/app/wrangler.jsonc`
- **Limits.** Uploads over 95 MB are refused by the analyzer and over 100 MB by Cloudflare. Jobs
  are not tied to a member account (ids are random), and they are deleted after `JOB_TTL_HOURS`.
- **Later**, for hosting off the PC: move this container to a VM or container host and point
  `ANALYZER_ORIGIN` at it; nothing in the portal changes.

## Layout

```
app/          FastAPI app and pipeline
  main.py       endpoints, upload checks
  config.py     environment settings
  access.py     ACCESS_TOKEN gate
  jobs.py       flat-file job store and cleanup
  media.py      ffmpeg probe, real fps measurement, audio extraction
  audio.py      onsets, tempo, grid, timing, dynamics (Module 1)
  video.py      MediaPipe landmarks and form metrics (Module 2)
  fusion.py     per-stroke fusion and audio/video cross-verification (Module 3)
  sticking.py   paradiddle sticking check
  scoring.py    0 to 100 scores
  pipeline.py   runs the stages and builds the report
  tuning.py     every analyzer threshold in one settings object (file and env overrides)
  labels.py     labels.json validation
  dataset.py    training dataset: intake, pre-fill, storage
  evaluation.py accuracy metrics (labels versus analyzer)
static/       Analyze page (index.html, app.js, record.js, skeleton.js, style.css)
              Label page (label.html, label.js, label.css)
schema/       report.schema.json, labels.schema.json
scripts/      make_click_test.py, make_test_video.py, fetch_models.py, serve-remote.ps1,
              evaluate.py and evaluate.ps1 (accuracy evaluation)
docs/         training-shot-list.md
reports/      evaluation output (not committed)
tests/        pytest suite
samples/      real-sample report (pending)
Dockerfile, docker-compose.yml, start-local.ps1, start-remote.ps1, stop-remote.ps1, restart-server.ps1
```
