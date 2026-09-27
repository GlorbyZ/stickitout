# Stick It Out

Astro site for **Stick It Out** (book + Lessons). Local-only agents for this project.

**Live:** https://stickitoutdrums.com/  
**Repo:** https://github.com/GlorbyZ/stickitout

## Commands

```bash
npm install
npm run dev          # http://localhost:4325
npm run build
npm run shipit       # build + secret scan + SFTP
```

## Email capture

Free lesson + waitlist POST to `/api/capture.php` → `data/leads.json` and Cloudflare D1 + Resend lists.

1. Set `SFTP_PASSWORD` in `.env`
2. Optional: `CAPTURE_NOTIFY_TO=you@email.com` for mail alerts on each signup
3. `npm run shipit`
4. Pull leads anytime via SFTP: `data/leads.json`

See [docs/deploy.md](docs/deploy.md).

## Member + admin portals

https://member.stickitoutdrums.com/ and https://admin.stickitoutdrums.com/ (Cloudflare Worker + D1). Setup: [docs/portals.md](docs/portals.md).

## Brand lab

https://stickitoutdrums.com/brand-lab.html (also GitHub Pages until next Pages deploy)
