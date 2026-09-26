# Member + Admin portals

Marketing stays on IONOS: https://stickitoutbook.com/

Portals run on a Cloudflare Worker (`stickitout-portals`) with D1 `stickitout`.

- Members: https://member.stickitoutdrums.com/
- Admin: https://admin.stickitoutdrums.com/
- Workers.dev fallback: https://stickitout-portals.zayyo.workers.dev/
- Local member: `npm run portal:dev` then http://127.0.0.1:8787/
- Local admin: http://127.0.0.1:8787/_admin/login

## DNS (stickitoutdrums.com)

Zone `stickitoutdrums.com` is on this Cloudflare account (`ca920695eda5d6f43cef8a5e7068b867`) and is **active**. Worker custom domains:

- `member.stickitoutdrums.com`
- `admin.stickitoutdrums.com`

## Cloudflare Access (admin)

Zero Trust → Access → Applications → Self-hosted:

- Application domain: `admin.stickitoutdrums.com`
- Policy: allow emails `zaylynbyoung@gmail.com` and `mikestaus@gmail.com`
- Session duration: 24h is fine

The Worker also checks `ADMIN_EMAILS` (`zaylynbyoung@gmail.com,mikestaus@gmail.com`) and `Cf-Access-Authenticated-User-Email`, so a missed Access policy cannot open admin to the public. Until Access is attached, admin still requires an allowlisted magic link.

Wrangler OAuth does not include Access write, so this step is dashboard-only.

## Secrets

```bash
npx wrangler secret put RESEND_API_KEY --config workers/app/wrangler.jsonc
```

Copy `workers/app/.dev.vars.example` to `workers/app/.dev.vars` for local mail. If `RESEND_API_KEY` is empty and `DEV_LOG_LINKS=1`, the login page prints the magic link.

From-address: `noreply@stickitoutdrums.com`.

Resend domain `stickitoutdrums.com` is created but **not verified** until these DNS records exist on the Cloudflare zone (DNS only, not proxied):

| Type | Name | Content | Priority |
| --- | --- | --- | --- |
| TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC9RdBTWcemvs/KoRo56FLEe3ejLYd1Pq0jAOaDB0GDKk74uJRcrPTaJEVRV/HDFgfESItcvY0X+aQ+HcMqzsQwmi0Ap6R7VvmuYkiz/ou3VE+bOjA9Cs/jM8mYMMs/rt89n//NnjiMMVs48Ndqsxm3OlVxanP1PqGTeK7SqI0sMQIDAQAB` | |
| MX | `send` | `feedback-smtp.us-east-1.amazonses.com` | 10 |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | |
| CNAME | `rsend` | `send.forge.rmta.net` | |
| TXT | `_dmarc` | `v=DMARC1; p=none;` | |

Wrangler OAuth cannot write DNS. After the records are in, run verify from Resend (or `node workers/app/scripts/setup-mail.mjs` with a `CLOUDFLARE_API_TOKEN` that has Zone DNS Edit).

Admin allowlist: `ADMIN_EMAILS` in `workers/app/wrangler.jsonc` (comma-separated). Currently `zaylynbyoung@gmail.com` and `mikestaus@gmail.com`.

## Commands

```bash
npm run portal:dev
npm run portal:types
npx wrangler d1 migrations apply stickitout --local --config workers/app/wrangler.jsonc
npx wrangler d1 migrations apply stickitout --remote --config workers/app/wrangler.jsonc
npm run portal:deploy
```

Stripe stays off Cloudflare. Financials is a placeholder until checkout URLs exist.

## Members CRM

Admin → Members is a CRM on D1, not a list-only roster.

- `/members` search, status chips, add to waitlist
- `/members/:id` profile (name, kit, level, phone, source), notes, tags, membership, Resend sync, login link, lesson progress, practice logs, challenge attempts, audit
- Status change writes D1 and upserts the matching Resend list (`SIO Waitlist` / `SIO Founding` / `SIO Active`)
- Waitlist never becomes founding from a marketing form

## Cloudflare Stream

Worker binding `STREAM` (`wrangler.jsonc` `stream.binding`). Lessons store `stream_uid`. Custom stills live in R2 `stickitout-media` (`MEDIA`) as `lessons.poster_key`.

- Admin lesson page: POST a file to a one-time upload URL (under 200MB) or ingest a public URL
- Custom thumbnail upload (JPG/PNG/WebP, under 5MB). If none, signed Stream first frame (`time=0s`)
- Playback iframe uses `generateToken()` so the UID is not public
- Do not set Stream `allowedOrigins` on lesson videos. That list is checked against the iframe host (`customer-*.cloudflarestream.com`), so restricting it to member/admin makes the player flash then show Video not found
- Member `/library/:id` only mints a token when membership status is `founding` or `active`
- Watch + complete write `lesson_progress`. Practice form writes `practice_logs`

## Member profile and challenges

Member host gates the app until display name, kit setup, and playing level are set. Phone is optional. Same fields edit on Profile and admin CRM.

Challenges: one live prompt. Founding/active members submit notes. Mike scores 0-100 in admin. Leaderboard is the same D1 query on member home, `/challenges`, admin Challenges, and CRM.

## Portal chrome

Under 840px the member portal uses a bottom SVG dock (Home, Library, Challenges, Profile). Admin uses a hamburger drawer. Desktop keeps the top link row. Marketing home is unchanged. Brand marks are served by the Worker at `/img/brand/glyph.png` and `/img/brand/wordmark.png` so they load on login and every inner page.

## Marketing (admin)

Admin → Marketing wraps Resend: broadcasts, segments, contacts, templates, topics, metrics, suppressions, and a one-off test send.

- Overview: domain status, 7-day metrics, D1 counts, **Sync D1 into Resend lists**
- Sync creates `SIO All`, `SIO Waitlist`, `SIO Founding`, `SIO Active` and upserts people from D1
- Campaigns: draft / schedule / send (confirmation required). Unsubscribe URL is appended if missing
- Do not send a real broadcast until lists look right. Use **Test send** first

Marketing lives on the admin portal (`admin.stickitoutdrums.com/marketing`), not on the IONOS site.
