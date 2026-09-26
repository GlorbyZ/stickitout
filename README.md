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
- Cloudflare caps uploads at 100 MB. Record mode records at about 8 to 12 Mbps and stops itself at
  the cap (about 60 to 90 seconds); phone camera files are bigger, so keep uploads to 30 to 45 seconds.
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

The Analyze page has **Record** and **Upload a video** modes. Record works the same in the
portal Analyze tab and on direct access. Details, sources and the September 2026 60 fps
regression are in [docs/60fps-capture.md](docs/60fps-capture.md).

**Camera and 60 fps.** Record opens the camera through `getUserMedia` with a constraint ladder
(`static/camera.js`): 1280x720 with `frameRate {ideal: 60, min: 50}`, then 1920x1080 with the same
rate, then 1280x720 with `ideal: 60` and no minimum, then any rate. Permission errors stop the
ladder. After the camera opens, it checks `track.getCapabilities().frameRate`: if the camera can do
60 but is set lower, it calls `applyConstraints({frameRate: 60})`. On phones the back camera is the
default (`facingMode: environment`). Echo cancellation, noise suppression and auto gain are off so
drum transients survive.

**Live fps badge.** The badge on the preview shows the real delivered rate, measured from
`requestVideoFrameCallback` `presentedFrames` (the camera's `getSettings().frameRate` until a
measurement exists): "60 fps" in green, "30 fps, results will be estimates" in the brand accent,
red under the minimum. The pill next to it shows the size and the rate the camera was set to. When
the camera delivers under 50 fps for about 2 seconds, a tip appears. On phones it reads "Your phone's
browser is limited to 30 fps. For 60 fps, record in your Camera app at 60 fps and use Upload."

**Camera picker.** The picker above the preview lists friendly names ("Back camera", "Back camera
(ultra wide)", "Front camera", "Laptop webcam", "USB camera", "Phone camera", "Virtual camera").
They are inferred from the device label and facing mode, duplicates are numbered, and the raw
label is kept as a tooltip. Labels need camera permission, so the list is refreshed after the first
`getUserMedia`. The first start switches once to the best camera for drumming (main back camera,
then USB, then laptop webcam, front last) unless the member picked one before (remembered in
localStorage). **Switch** flips front and back. Only a camera facing the member is mirrored.

**Skeleton.** The MediaPipe pose and hand skeleton (Tasks Vision, PoseLandmarker lite +
HandLandmarker from jsDelivr) is drawn on a separate canvas over the preview. Shoulders, elbows and
wrists are gold, hands blue, and a framing panel says what to fix. MediaPipe runs on the main
thread, so it is scheduled by presented frames (`detectPlan`): every 2nd frame in preview at 60 fps,
about 10 Hz while recording. It pauses for the rest of a take when the Skeleton box is off, when a
detection costs more than 8 ms on the device, or when a 60 fps camera drops under 55 fps.

**Recording.** MediaRecorder records the **raw camera and microphone track**, never the canvas, so
the skeleton is not in the file. It prefers H.264 MP4 (`avc1.64002A`, level 4.2 which covers
1080p60, then `avc1.640028`, then plain MP4), then WebM VP8 and VP9. The video bitrate is sized
for the capture (about 8.3 Mbps at 720p60, 12 Mbps at 1080p60, never under 4 Mbps), with 1 second
timeslices. Each take shows its measured fps, container and asked bitrate. After upload, the results
show "Saved video: N fps, measured by the server from the file" and a "Video (server measured)" stat.
Before upload the page notes when a take is under 50 fps (analysed with the low frame rate
disclaimer) or under the minimum (rejected).

On the results page, "Draw skeleton on playback" runs the same browser models over the
uploaded video.

Needs internet for the CDN files and a secure page: `http://localhost:8800` on the same
computer, or HTTPS (see [Remote access](#remote-access-over-https)) on a phone.

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
| `test_frontend_js.py` | runs `node --test tests/js` (skipped without node): `static/camera.js` constraint ladder, 60 fps boost, fps badge and tip text, friendly camera names and best default, MediaRecorder type and bitrate, skeleton scheduling and auto-pause |
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
