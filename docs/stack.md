# Stick It Out stack

Briefing for agents. Status of every user-facing path is `docs/source-of-truth.md` in the Stickitout repo. This file is how the pieces fit together. If you change product behavior, update source-of-truth in the same turn. Do not mark something `live` if it only works on this PC.

There is one git repo. The analyzer is the `analyzer/` directory in this checkout. On disk that repo lives at `C:\Users\epicn\Documents\sites\Stickitout`. GitHub: `GlorbyZ/stickitout` (public).

The process that is running on this PC was started from the older sibling folder `C:\Users\epicn\Documents\sites\Stickitout-analyzer`. That folder is the same snapshot that was imported here. New analyzer edits belong in `analyzer/` inside this repo, then restart from that folder when you want the running server to match.

Reference videos used to fit the temporary analyzer profile are not in git: `D:\Stickitout-dataset\reference-videos`.

`stickitoutbook.com` does not resolve. Do not use it. The live public site is `stickitoutdrums.com`.

## Live hosts

| Host | Process |
| --- | --- |
| https://stickitoutdrums.com/ | Astro site, built here, shipped by SFTP to IONOS |
| https://member.stickitoutdrums.com/ | Cloudflare Worker `stickitout-portals` |
| https://admin.stickitoutdrums.com/ | Same Worker, host decides member vs admin |
| https://stickitout-portals.zayyo.workers.dev/ | Worker fallback. Local admin path is `/_admin` |
| https://analyzer-origin.stickitoutdrums.com/ | Named tunnel `sio-analyzer-origin` to this PC, port 8800 |

The analyzer origin answers only while this PC is on and `Stickitout-analyzer\start-remote.ps1` is running. If it is down, the member Analyze tab says the analyzer is offline.

## Request paths

Waitlist signup on the public site:

1. Form posts to IONOS `/api/capture.php`.
2. PHP writes a backup `leads.json` on IONOS and optionally sends mail.
3. PHP also `POST`s to `https://member.stickitoutdrums.com/api/leads` with bearer `LEAD_INGEST_SECRET`.
4. The Worker writes D1 and upserts Resend lists `SIO Waitlist` and `SIO All`.

A form signup does not make someone a paying member. Founding and active are an admin action (or Stripe, which is not connected).

Member Analyze:

1. Browser talks only to `member.stickitoutdrums.com/analyze` and `/analyze/api/...`.
2. `workers/app/src/analyze.ts` checks the member session, then fetches the studio PC.
3. The Worker adds `X-Access-Token` from secret `ANALYZER_TOKEN`. The browser never sees that key. Portal cookies are not forwarded.
4. Allowed upstream paths: static JS/CSS/images except `label.*`, `GET /api/config`, `POST /api/analyze`, resumable upload (`POST /api/uploads`, `GET /api/uploads/:id`, `PUT .../pieces/:n`, `POST .../finish`), `GET /api/jobs/:id`, `/video`, `/landmarks`, `GET /api/results/:id`.
5. Label page, dataset intake, and every other analyzer path are 404 on the portal.

## Public site

Astro app in `src/`, shipped from `dist/` by `npm run shipit` (build, secret scan, SFTP). Config is `.env` (gitignored). Copy `.env.example`.

- Homepage waitlist form is the capture path above.
- `/book` sells the PDF through a Stripe Payment Link.
- `/lessons` lists titles only. Video stays locked.
- `/membership/checkout/` is another waitlist form. Founding checkout URLs are empty.
- Founding prices stay **$19.99/mo** and **$149/yr**. Do not invent other prices, reviews, Stripe URLs, or unpublished lessons.

```bash
npm install
npm run dev          # http://localhost:4325
npm run shipit
```

## Member and admin portal

Code: `workers/app`. One Worker, two hosts. D1 database name `stickitout`. Lessons video is Cloudflare Stream. Custom posters are R2 bucket `stickitout-media`.

Member tabs: Home, Practice, Library, Analyze, Profile. Challenges still exist at `/challenges` but are hidden from the nav (`SHOW_CHALLENGES_IN_NAV` in `workers/app/src/ui.ts`).

Practice (`/rudiments`): Rudiments are hands only. Hand fill drills are four-limb only. Feet patterns stay in D1 and admin, not on the member tab. Staff drawing is client-side VexFlow. Notation strings in D1 start with `drum:`. Sticking text must stay on the page even if the staff script fails.

Medals run dirt through insanity from each pattern's Diamond BPM. A medal moves only on a clean session of at least 30 seconds. Streak days are America/Denver.

Library video plays only for founding or active members. Waitlist and canceled members must never get a Stream playback token.

Admin is an email allowlist (`ADMIN_EMAILS`) plus magic-link login. Off-list visitors see that message and a Log in button. The button does not bypass the list.

Admin surfaces: dashboard, members CRM, lessons upload, rudiment catalog, challenges, Resend marketing, financials counts only.

```bash
npm run portal:dev      # http://127.0.0.1:8787/   admin: http://127.0.0.1:8787/_admin/login
npm run portal:deploy   # from the Stickitout repo root
```

Remote D1 migrations, from the Stickitout repo root:

```bash
npx wrangler d1 migrations apply stickitout --remote --config workers/app/wrangler.jsonc
```

Mail from `noreply@stickitoutdrums.com` can fail until Resend DKIM and SPF are finished.

## Analyzer

Code in this repo: `analyzer/`. FastAPI app in `analyzer/app`, port 8800. The server currently running on this PC was launched from `C:\Users\epicn\Documents\sites\Stickitout-analyzer` and still reads that folder.

Recording clips are not planted into a folder by hand. Set `CLIP_SHARE` to the shared-drive directory and `DATASET_DIR` (use `D:\Stickitout-dataset\clips`, not C:) before starting. Every 30 seconds the server copies videos that have finished arriving. The originals stay on the share. Then label them at `http://127.0.0.1:8800/label`. Do not send these takes through the member Analyze tab: those jobs are deleted after 72 hours.

```powershell
cd C:\Users\epicn\Documents\sites\Stickitout\analyzer
$env:CLIP_SHARE = '\\server\share\sio-takes'   # the real shared-drive path
$env:DATASET_DIR = 'D:\Stickitout-dataset\clips'
$env:JOB_TTL_HOURS = '0'
$env:MAX_UPLOAD_MB = '2048'
# The venv and models live in the sibling folder until this copy has its own.
& "..\..\Stickitout-analyzer\.venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8800
```

The older sibling folder still starts with `C:\Users\epicn\Documents\sites\Stickitout-analyzer\start-local.ps1` and `start-remote.ps1`. It does not see this change until you start from `analyzer/` here or copy these files across.

What a take actually runs:

1. Audio onsets and tempo from the clip (aubio). Timing is against a grid fitted to the player's own hits, not a click, unless they played to one.
2. Body points from Google MediaPipe pose and hands (`models\`, public `.task` files). This model was trained on ordinary people, not drummers. Nothing in this repo fine-tunes those weights.
3. A hit counts as verified when a wrist low point lands in the same window as an onset. Left versus right is which wrist that strike belongs to.
4. Coaching text in `app/coaching.py` is rules on those numbers. It is not an LLM. It does not judge posture, elbow angle, flams, or stick height. Stick tips are not tracked. "Wrist travel" is how far the wrist moves up and down in the picture, so a side or three-quarter camera shows stroke height and a front camera mostly does not.
5. Reports are files on this PC under the analyzer data dir. They are not in D1. They expire (`JOB_TTL_HOURS`, default 72). A job id is not tied to a member.

Side view is the shot list default. A 45 degree angle is a label value (`side`, `front`, `45`, `overhead`, `other` in `app/labels.py`) but almost no reference clips use it. Pure side hides the far stick. Pure front loses stroke height.

## Temporary threshold profile

`analyzer/tuning.temp.json` was fit by `python -m scripts.temp_train` on the 13 CC-BY clips in `D:\Stickitout-dataset\reference-videos`. `analyzer/scripts/serve-remote.ps1` sets `SIO_TEMP_TRAINING=1` when that file exists, and `analyzer/app/tuning.py` then loads it instead of the shipped defaults.

Current overrides: `hand_source=strike_first`, `strike_min_prominence=0.012`. On those clips the fit score went from 17.35 to 35.49. Median video-to-hit match is still about 29 percent. Sticking is only a few points above shuffled hands. Do not describe this as a trained drum model.

Delete `analyzer/tuning.temp.json` and restart the analyzer to restore shipped thresholds. `SIO_TEMP_TRAINING=0` also ignores the file. A later `TUNING_FILE` env value wins over both.

Raw numbers: `analyzer/reports/temp-training.json` is gitignored (local only). The sibling folder may still have `C:\Users\epicn\Documents\sites\Stickitout-analyzer\reports\temp-training.json`. Credits for the clips: `D:\Stickitout-dataset\reference-videos\ATTRIBUTION.md`.

## Do not

- Invent Stripe URLs, reviews, or lessons that are not published.
- Change founding prices.
- Treat IONOS `leads.json` as the member list. Admin Members reads D1.
- Give waitlist or canceled members a Stream token.
- Ship MediaPipe, OSMD, or Verovio weights to the marketing site. Notation in the portal stays VexFlow.
- Commit `.env`, `workers/app/.dev.vars`, `.remote-token`, `.tunnel-token`, or `tuning` secrets.
- Assume `stickitoutbook.com` works.
