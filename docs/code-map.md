# What is current, and what is leftover

Read this before editing Stick It Out. The live inventory of screens is `docs/source-of-truth.md`. How a request moves is `docs/stack.md`. This file says which folder to edit.

There is one git branch: `main`. GitHub: `GlorbyZ/stickitout`.

## Current (edit these)

| Path | Role |
| --- | --- |
| `src/`, `public/` | Marketing site. Ship with `npm run shipit`. |
| `workers/app/` | Member and admin portal. Ship with `npm run portal:deploy`. |
| `analyzer/` | Analyzer that members use. The live process is the `sio-analyzer` container on the Ubuntu server `bdd-secure-server`, bound to `127.0.0.1:8800`. The UI members see is `analyzer/static/` (version 1 layout). The scoring code is `analyzer/app/`. |
| `apps/android/` | Capacitor shell around the member site. Sideload APK. |
| `docs/source-of-truth.md` | What is actually live. |

The portal Analyze tab does not ship its own analyzer page. `workers/app/src/analyze.ts` fetches `<main>` from `https://analyzer-origin.stickitoutdrums.com/` and pastes it into the member shell. The static files that page loads are also proxied from that origin. A portal deploy does not change the analyzer layout. Rebuilding the container does.

Version 1 UI is the Analyze screen with Record, Upload, the rudiment menu, and the review player (skeleton, sticks, joint angles). It lives in `analyzer/static/index.html`, `app.js`, `style.css`, and the modules they import. Keep the element ids those scripts use (`params`, `secure-warning`, `framing`, `playback`, `play-overlay`).

Version 2 backend, in the same `analyzer/app/` tree:

- `audio.py` `detect_template_metronome` matches a take to `analyzer/data/stickitout_click.wav` when that file exists. If the file is absent, tempo stays on beat tracking and, when a click plus snare are both present, Demucs. Do not add the wav to git until it is the real click.
- `stick_tracker.py` keeps stick length and angle as a rigid shaft. Playback drawing in the browser is separate and still uses `analyzer/static/skeleton.js`.
- `config.py` defaults `JOB_TTL_HOURS` to `0`. The host compose file sets the same. Member videos are kept until that value is raised. Disk on `/var/sio/analyzer/jobs` will grow.

Founding prices stay $19.99/mo and $149/yr. Do not invent Stripe URLs.

## Legacy (do not ship from these)

| Path | What it is |
| --- | --- |
| `C:\Users\epicn\Documents\sites\Stickitout-analyzer\` | Older checkout outside this repo. It is not on `main`. Its `static/index.html` glass layout is an experiment. It dropped ids the scripts need and the portal page stops. Do not point the tunnel or the Docker build at this folder. |
| `tmp/` in this repo | Scratch. Not part of the product. |
| `analyzer/data/jobs/` | Local takes. Not committed. The server copies live under `/var/sio/analyzer/jobs`. |

The studio PC scripts `start-remote.ps1` must stay off while `cloudflared-analyzer` is running on the Ubuntu server. Two tunnels on the same name fight.

## Member Analyze access

Any logged-in member with a finished profile can open `/analyze`. The page is not limited to admin emails. `ANALYZER_TOKEN` on the Worker must be the analyzer `ACCESS_TOKEN`, not a server login password. The browser never sees that value.
