# Deploy Stick It Out

## Setup once

```bash
cp .env.example .env
# fill SFTP_PASSWORD (+ optional CAPTURE_NOTIFY_TO for email alerts)
npm install
```

## Commands

```bash
npm run dev          # local http://localhost:4325
npm run build        # → dist/
npm run shipit       # build + ship-check + SFTP to stickitoutdrums.com
npm run shipit:only  # upload existing dist/
```

## Brand assets

Icons are generated from one square glyph at `assets/brand/sio-glyph.png`:

```bash
npm run build:icons   # favicon.ico, favicon.svg, apple-touch, 192/512/maskable, mstile
```

Social share images live in `public/img/social/`. To regenerate them, build, run
`npm run serve:dist`, open `/og-template/`, and capture each card at its listed
size (1200x630 for `og-home` / `og-book`, 1200x1200 for `og-square`).

## Email capture

Forms POST to `/api/capture.php` → `data/leads.json` on the server (not web-readable).

Optional: set `CAPTURE_NOTIFY_TO` in `.env` so ship writes `data/capture-config.php` and PHP mails you on each signup.

Pull leads via SFTP: `data/leads.json` (ship does **not** overwrite existing leads).

## Member + admin portals

Waitlist capture stays on `/api/capture.php` and now forwards into D1 + Resend (`POST /api/leads`). See [source-of-truth.md](source-of-truth.md).
