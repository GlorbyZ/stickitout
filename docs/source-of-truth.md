# Stick It Out source of truth

Last updated: 2026-09-26 (Analyze tab replaces Challenges in the member nav: Worker proxy to the analyzer over the named tunnel `analyzer-origin.stickitoutdrums.com`, deployed 3:32 PM MT. Earlier: all tempos and tier thresholds rounded up to a 10, D1 migration 0011 applied. Earlier today: tiers through Insanity, 30 s rule, badge drawer, `/api/health`, readForm fix, migration 0010)

Agents must update this file in the same turn as any behavior change. Status must match production, not intent.

Status: `live` · `partial` · `stub` · `broken` · `redirect` · `not-started`

## Hosts

| Host | Role |
| --- | --- |
| https://stickitoutdrums.com/ | Marketing site (Astro on IONOS, proxied) |
| https://member.stickitoutdrums.com/ | Member portal (Cloudflare Worker + D1) |
| https://admin.stickitoutdrums.com/ | Admin portal (same Worker, allowlist) |
| https://stickitout-portals.zayyo.workers.dev/ | Worker fallback. Local admin is `/_admin` |
| https://analyzer-origin.stickitoutdrums.com/ | Analyzer origin (FastAPI on the studio PC) via its own named Cloudflare Tunnel `sio-analyzer-origin` (id `4a6ec999-62d3-4426-b7ca-4b0ee23e011b`, ingress to `http://127.0.0.1:8800`). Every path except `/healthz` needs the ACCESS_TOKEN. Up only while the PC runs `start-remote.ps1`. Separate from the pre-existing `chud` tunnel service. Zone cache rule `18d1feed09c94fd6a6ec7361c5be78a9` (phase http_request_cache_settings) sets cache off for this host so key-gated files are never served from the CDN cache (added and purged 2026-09-26 3:40 PM MT) |
| stickitoutbook.com | Dead / NXDOMAIN. Do not use |

## Where people live

| Store | What it is |
| --- | --- |
| D1 `people` + `memberships` | Admin dashboard source of truth |
| Resend segments `SIO All`, `SIO Waitlist`, `SIO Founding`, `SIO Active` | Email lists. Campaigns send here |
| IONOS `data/leads.json` | Backup of marketing form posts. Dashboard does **not** read this |

Signup path: marketing form → `/api/capture.php` → `leads.json` **and** `POST member.../api/leads` → D1 waitlist + Resend `SIO Waitlist` / `SIO All`. Unpaid waitlist is never marked founding.

## Marketing (stickitoutdrums.com)

| ID | Feature | Status | Notes |
| --- | --- | --- | --- |
| mkt-home | Homepage hero + waitlist form `#home-email` | live | POST `/api/capture.php` source `waitlist` plan `monthly` |
| mkt-nav | Header Join waitlist | live | No Log in link (removed 2026-09-24, desktop + mobile menu). Waitlist → `#home-email` |
| mkt-book | Book page + Stripe PDF Payment Link | live | `PUBLIC_STRIPE_BOOK_PDF` |
| mkt-lessons | Public lesson title list | live | Titles only. Video locked. CTA waitlist |
| mkt-challenges | Challenges teaser | live | CTA waitlist. No challenge player |
| mkt-membership | `/membership/` | redirect | Redirects to `/` |
| mkt-checkout | `/membership/checkout/` | live | Waitlist form (Stripe checkout URLs empty). source `waitlist` |
| mkt-welcome | `/membership/welcome/` | redirect | Member origin |
| mkt-account | `/account/` | redirect | Member login |
| mkt-portal | `/portal/` | redirect | Member home |
| mkt-unlock | `/unlock/` | live | Static unlock copy + waitlist link |
| mkt-free-lesson | `/free-lesson/` | redirect | Redirects to `/` |
| mkt-payment | `/payment/` | live | Legacy payment page; not founding checkout |
| mkt-brand | `/brand/` + `/brand-lab.html` | live | Internal brand lab |
| mkt-capture | PHP capture | live | Writes `leads.json`, optional notify mail, forwards to Worker ingest. Config must be valid PHP array (JSON.stringify objects 500 the endpoint) |

## Member portal

| ID | Feature | Status | Notes |
| --- | --- | --- | --- |
| mem-login | Magic-link login | partial | Resend domain still pending (DKIM/SPF). Mail can fail until verified. `readForm()` no longer throws on an empty or malformed body: POST `/login` (member and admin) with an empty body or invalid email returns 400 and sends nothing |
| mem-home | Home | live | Animated GSAP roadmap of kit, published weeks, live challenge, plus the D1 board |
| mem-library | Library | live | Locked unless status `founding` or `active`. Poster cards open `/library/:id` |
| mem-watch | Stream watch | live | Signed iframe for founding/active. Waitlist/canceled never get a token |
| mem-challenges | Challenges | live | Hidden from the member nav since 2026-09-26 (`SHOW_CHALLENGES_IN_NAV = false` in `src/ui.ts`). `/challenges`, the home Challenge tile and board, the code, and the D1 data are unchanged and still reachable. Live prompt, founding/active submit notes. Waitlist can view board only |
| mem-board | Challenge leaderboard | live | Same D1 scores on member home, `/challenges`, admin, CRM. Ranked after Mike scores 0-100 |
| mem-profile | Profile | live | Completed profiles lead with a drawer-style badge case. Closed face: top-tier medal, medal count, patterns medaled, streak badges, gold pull handle. Opens with a slide (also via `#badges`) to medals by tier, then by rudiment family and Hand fill drills with a 7-tier strip per pattern (locked tiers dimmed), then streak badges. Rows stack on mobile. Setup stays a form. Name, kit, and level still required. Billing portal empty |
| mem-medals | Medal ladder | live | 8 badge images, dirt through insanity (`medal-insanity.png` + `.svg` added 2026-09-26). Tiers are shares of each pattern's Diamond BPM (`patterns.bpm_goal`): bronze 50, silver 65, gold 80, platinum 92, diamond 100, legendary 200/190, insanity 220/190. Every threshold is rounded UP to a 10 (`ceilTo10` inside `medalTarget`), so ladder, drawer, awarding, admin preview, metronome open tempo, and next target all agree. Single Stroke Roll: Bronze 100, Silver 130, Gold 160, Platinum 180, Diamond 190, Legendary 200, Insanity 220. A session moves a medal only if it is clean and 30 s or more on the metronome session timer. Legendary is tempo only (the old 3-session rule is gone). Migration 0010 rescaled all 45 hands rudiments off singles (ratios and full table in `docs/rudiment-tempo-review-2026-09-26.md`) and recomputed stored medals from `best_bpm`. Migration 0011 rounded every `bpm_goal` and `bpm_start` up to a 10 and recomputed medals with the rounded thresholds |
| mem-nav | Portal chrome | live | Wordmark header. Member tabs: Home, Practice, Library, Analyze, Profile (Analyze took the Challenges slot). Dock under 840px (5 tabs, 75 px each at 390 px, no clipping, no horizontal scroll at 360 to 430 px). Home-screen install name is Stick It Out on member, admin, and the public site |
| mem-ingest | `POST /api/leads` | live | Bearer `LEAD_INGEST_SECRET`. D1 + Resend. Used by IONOS PHP |
| mem-practice | Practice logs | live | Member watch page writes `practice_logs`. Admin CRM reads them |
| mem-rudiments | Practice tab `/rudiments` | live | Session hero, then Rudiments (hands) and Hand fill drills (four-limb only). Staff is drum-book percussion: snare in the middle space, kick in the bottom space, hi-hat foot as an X, flams and drags as grace notes, buzz as stem slashes, open rolls written out. Hands stem up, feet stem down. Pattern cards show sticking, medal, and tempo |
| mem-metronome | Adaptive metronome | live | Pattern page is a practice room: medal / best / sessions, notation, then the click (big tempo, ±5, tap, 1/4–1/16). Opens at the member's medal tempo. Session timer fills the log. Slider tops out at the pattern's Insanity tempo plus 10 |
| mem-daily | Daily pattern | live | Weakest medal then stalest practice inside the member's tiers. Hands on even days, four-limb fills on odd. Stable all day in `daily_pattern_picks`. Admin override wins |
| mem-streaks | Practice streaks | live | Denver day. Rewards at 3, 7, 14, 30, 60, 100, and 365 stay if the streak breaks. The board is a bell on Home, Practice, and Profile. It flashes only for an unopened reward, then opens as a popup |
| mem-health | `GET`/`HEAD /api/health` | live | Public on member and admin hosts, no auth. Returns 200 `{ok, db}` after a D1 ping |
| mem-analyze | Analyze tab `/analyze` | partial | Live, but only while the studio PC runs the analyzer (`Stickitout-analyzer\start-remote.ps1`). Any logged-in member with a completed profile (waitlist included); `/analyze` without a session redirects to `/login`, `/analyze/*` returns 401 JSON. `src/analyze.ts`: the Worker fetches the analyzer's `<main>` markup from `ANALYZER_ORIGIN` on each page view and renders it in the portal shell with portal-native dark CSS (`ANALYZE_CSS`, portal variables, analyzer `style.css` not loaded). Proxy allowlist: `/analyze/static/*.js/css/img` (not `label.*`; JS has `"/api/"` rewritten to `"/analyze/api/"`), `GET /analyze/api/config`, `POST /analyze/api/analyze` (body streamed, analyzer caps 95 MB, Cloudflare refuses over 100 MB), `GET /analyze/api/jobs/:id`, `/jobs/:id/video` (Range passes through, 206), `/results/:id`. Label page, dataset intake, and every other analyzer path are 404. The Worker adds `X-Access-Token` from secret `ANALYZER_TOKEN`; the browser never sees the key, portal cookies are never forwarded, analyzer `Set-Cookie` is dropped. Origin down (tunnel 502/530, timeout, or origin 401) shows "Analyzer is offline right now, try again later." (page 503 with a Try again button, API 503 JSON). Staff-only analyzer controls (Add to training set, training guide, raw JSON link) are hidden. Page sends `Permissions-Policy: camera=(self), microphone=(self)`; Record mode runs top level (no iframe). Charts stay hidden (analyzer `SHOW_CHARTS=false`); playback video sits right under the scores; 30 fps reports show the Low frame rate warning in the Verified box; 60 fps capture (2026-09-26 3:52 PM MT): camera picker with friendly names, live fps badge, 30 fps tip, and the portal top bar and dock drop their backdrop blur on this page so it does not re-blur every camera frame (see analyzer `docs/60fps-capture.md`) |

## Admin portal

| ID | Feature | Status | Notes |
| --- | --- | --- | --- |
| adm-login | Magic-link + `ADMIN_EMAILS` | live | zaylyn + Mike. Cloudflare Access not attached yet |
| adm-dash | Dashboard | live | Interactive ops board. Pending challenge scores KPI. Newest people open CRM |
| adm-members | Member list | live | Subscribed filter (founding+active), plan chips, KPI counts, one-tap Promote / Activate / Cancel. Full edit stays in CRM |
| adm-crm | Member CRM `/members/:id` | live | Sticky Promote / Activate / Cancel / change plan. Profile, notes, tags, login link, Resend, lessons, practice, rudiment medals + streak, challenges, audit |
| adm-lessons | Lesson video studio | live | Library grid, drop-to-upload, poster upload, signed preview, publish, watchers |
| adm-stream | Cloudflare Stream | live | Worker binding `STREAM`. R2 `MEDIA` for custom posters. First-frame fallback. `requireSignedURLs`. Playback gated founding/active |
| adm-rudiments | Rudiments catalog | live | Filter by discipline, edit start BPM and Diamond BPM (`bpm_goal`) in steps of 10 (saves round up to a 10) with a preview line of every tier's tempo, tier, level, sticking, VexFlow notation, coaching note. Set today's global override pick |
| adm-challenges | Challenge studio | live | CRUD plus attempt scoring 0-100. Same board as members |
| adm-marketing | Resend campaigns UI | live | Broadcasts, lists, templates, topics, suppressions, test send, D1→Resend sync |
| adm-financials | Financials | stub | Stripe not connected. Counts only |

## Commerce

| ID | Feature | Status | Notes |
| --- | --- | --- | --- |
| pay-founding | Founding membership checkout | stub | $19.99/mo · $149/yr locked. No Stripe checkout URLs |
| pay-book | Book PDF Payment Link | live | Stripe Payment Link on book page |
| pay-portal | Stripe billing portal | stub | Empty `STRIPE_PORTAL_URL` |

## Mail (Resend)

| ID | Feature | Status | Notes |
| --- | --- | --- | --- |
| mail-domain | `stickitoutdrums.com` | partial | SPF CNAME verified. DKIM + SPF MX/TXT still pending |
| mail-from | `Stick It Out <noreply@stickitoutdrums.com>` | live | Configured. Sending depends on domain verify |
| mail-magic | Member/admin login emails | partial | Blocked while domain pending |
| mail-lists | Auto-subscribe on capture | live | Ingest upserts `SIO Waitlist` + `SIO All` |
| mail-campaigns | Admin Marketing tab | live | Do not blast until lists look right. Test send first |

## Known gaps

1. Resend domain verify still pending (DKIM + SPF MX/TXT), so login mail and campaigns can fail.
2. Cloudflare Access on admin is dashboard-only, not attached.
3. IONOS `leads.json` imported 2026-09-16: 3 waitlist + 1 existing active in D1. New homepage signups now forward live.
4. Stream videos require signed playback. Waitlist must never receive a playback token. Do not set Stream `allowedOrigins` on lesson videos (it blocks the player iframe after the first second).
5. Unpaid waitlist is never marked founding. Founding/active is an admin CRM action (or Stripe later).
6. Cloudflare Stream is enabled. Admin Lessons drop-zone POSTs the file to the one-time upload URL (not tus). Waitlist must never receive a playback token.
7. `stickitoutbook.com` DNS is NXDOMAIN. Marketing + capture live on `stickitoutdrums.com`. 2026-09-19: fixed `capture-config.php` generation (invalid JSON-as-PHP caused `/api/capture.php` 500s so waitlist UI looked broken).
8. Admin Members list has a Subscribed filter and one-tap status changes. Stripe billing is still not connected. Status is D1 + Resend only.
9. Rudiment tiers gate on `patterns.tier` through `src/access.ts`. Waitlist reads `free` patterns but cannot log or run the metronome. `pro` (hybrids, advanced four-limb) is locked for everyone until the next paid plan exists: flip it by returning `pro` from `entitlement()`.
10. Session `clean` is self-reported. Only clean sessions of 30 s or more (metronome session timer, not time held at the exact tempo) raise `best_bpm` and medals. Admin can correct values in the CRM.
11. VexFlow loads from jsDelivr and draws on window load. If it fails the staff hides and the sticking text carries the pattern, so never remove the sticking line.
12. D1 migrations are applied through `0010_medal_tiers_tempo.sql` (remote 2026-09-26 1:19 PM MT). 0010 changed 3 stored medals: mikestaus Single Stroke Roll bronze to dirt (80 vs Bronze 95), mikestaus Triple Ratamacue legendary to diamond (135 vs Diamond 133, Legendary 140), zaylynbyoung Seven Stroke Roll diamond to platinum (165 vs Diamond 167). Feet patterns and four-limb drills kept their goals and get the new tiers by ratio. Pre-migration export: `tmp/backup-2026-09-26-badges/prod-pre-0010/`.
13. Migration `0011_tempos_round_up_10.sql` applied remotely 2026-09-26 1:30 PM MT: all 65 patterns now have start and Diamond on a 10. It changed 1 stored medal: mikestaus Triple Ratamacue diamond to platinum (135 vs Diamond 140, Platinum 130). Side effect of rounding up: 11 feet/four-limb patterns with Diamond 110 or 120 have Platinum equal to Diamond, so reaching Diamond on them skips Platinum. No rudiment is affected. Pre-migration export: `tmp/backup-2026-09-26-round10/prod-pre-0011/`. Final numbers: `docs/rudiment-tempo-review-2026-09-26.md`.
14. Analyze tab (2026-09-26): the analyzer runs on the studio PC, so the tab only works while that PC is on, awake, online, and running `start-remote.ps1` (named tunnel + server on port 8800). Otherwise members get the offline message. Worker secrets `ANALYZER_ORIGIN` (`https://analyzer-origin.stickitoutdrums.com`) and `ANALYZER_TOKEN` (same value as `Stickitout-analyzer\.remote-token`). After `start-remote.ps1 -NewKey`, re-put `ANALYZER_TOKEN` or the tab shows offline. Job ids are random 128-bit ids, not tied to a member (a member with another member's job id could open that report); reports and uploads are deleted by the analyzer after 72 h. Nothing is stored in D1. No D1 migration. Rollback: `npx wrangler rollback 58206a32-08d4-431f-88b6-24fc49a1c7f9 --config workers/app/wrangler.jsonc` (pre-Analyze code with the new secrets). Pre-deploy source copy: `tmp/backup-2026-09-26-analyze/pre-deploy/`. End-to-end check: `node workers/app/scripts/analyze-e2e.mjs <base> <clip.mp4> --cookie sio_member=... [--token-file <key file>]`.
15. Analyze Record mode 60 fps (2026-09-26 3:52 PM MT, Worker version `4a62e58d-711e-4a7d-84a5-748444a7d810`, rollback target `80853b41-77cf-4b02-80c5-a24ae3928656`): ANALYZE_CSS styles the camera bar, fps badge and saved-fps line, and removes `backdrop-filter` from `header.bar` and the member dock on the Analyze page only. Keep blur, filters and animated layers away from the camera preview. Details and sources: `Stickitout-analyzer\docs\60fps-capture.md`.
