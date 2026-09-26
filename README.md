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
- [API](#api)
- [Tests](#tests)
- [Real-sample test (manual)](#real-sample-test-manual)
- [Deviations from the build spec](#deviations-from-the-build-spec)
- [Member portal integration (later)](#member-portal-integration-later)
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
From the Windows PC, one command gives a private HTTPS link without any account:

```powershell
.\start-remote.ps1          # prints https://<random>.trycloudflare.com/?key=<key>
.\stop-remote.ps1           # stops the server and the tunnel
.\start-remote.ps1 -NewKey  # restart with a fresh key (old links stop working)
.\restart-server.ps1       # restart only the server (after a code change); tunnel, link and key stay
```

- It installs `cloudflared` with winget if it is missing, starts the server with a random
  `ACCESS_TOKEN` (kept in `.remote-token`) and `MAX_UPLOAD_MB=95`, opens a Cloudflare quick
  tunnel, and saves the link to `remote-url.txt`.
- Both processes run detached and survive closing the window. The server keeps the PC from
  sleeping while it runs, but **the PC must stay on and online** for the link to work.
- Every `start-remote.ps1` restart gives a new `trycloudflare.com` address (the key stays
  the same). `restart-server.ps1` restarts only the analyzer server and leaves the running
  tunnel alone, so the link keeps working.
- Cloudflare caps uploads at 100 MB. Record mode records at about 8 Mbps and stops itself at
  the cap (about 90 seconds); phone camera files are bigger, so keep uploads to 30 to 45 seconds.
- Quick tunnels are for testing. For something permanent use a named Cloudflare tunnel or
  one of the hosts above.

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

Synthetic inputs: `python scripts/make_click_test.py` writes the 120 BPM fixture;
`python scripts/make_test_video.py out.mp4 [--drummer] [--fps 30]` makes test videos
(`--fps 30` gives a low frame rate clip, `--fps 15` one the API rejects).
`--drummer` animates MediaPipe's public pose sample photo so each arm dips on its
paradiddle strokes in time with a click track.

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

## Member portal integration (later)

The Python pipeline (aubio, librosa, MediaPipe, ffmpeg) cannot run inside a Cloudflare
Worker. Recommended shape:

1. Host this container on a small VM or container host (Fly, Render, Railway, or any Docker
   VM) on its own subdomain (for example `analyzer.<portal domain>`).
2. The portal's Analyze tab records or picks the video in the browser (reuse `record.js`
   and `skeleton.js`) and asks the Worker for an upload slot. The Worker checks the member
   session and returns a presigned R2 upload URL plus a short-lived signed job token (HMAC
   with a secret shared with the analyzer).
3. The browser uploads straight to R2 (large files never pass through the Worker), then the
   Worker calls `POST /api/analyze` on the analyzer with the R2 object key and the signed
   token (a small addition: accept an R2 key instead of a multipart file).
4. The analyzer writes the report back (R2 object or a callback to the Worker, which stores
   the summary in D1 against the member). The portal polls the Worker or receives the callback.
5. Keep the analyzer private: only the Worker calls it (the shared-secret header already
   exists as `X-Access-Token`; Cloudflare Access or a tunnel adds network isolation).
6. Scale out with a queue (Cloudflare Queues or Redis) and more analyzer workers when needed.

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
static/       Analyze page (index.html, app.js, record.js, skeleton.js, style.css)
schema/       report.schema.json
scripts/      make_click_test.py, make_test_video.py, fetch_models.py, serve-remote.ps1
tests/        pytest suite
samples/      real-sample report (pending)
Dockerfile, docker-compose.yml, start-local.ps1, start-remote.ps1, stop-remote.ps1, restart-server.ps1
```
