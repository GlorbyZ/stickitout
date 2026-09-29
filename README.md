# Stick It Out

Drum book and lessons membership. Three live sites share one repo.

| Site | URL | What it is |
| --- | --- | --- |
| Public | https://stickitoutdrums.com/ | Astro marketing site on IONOS |
| Members | https://member.stickitoutdrums.com/ | Practice, lessons, analyze |
| Admin | https://admin.stickitoutdrums.com/ | Allowlisted ops portal |

How the pieces fit together is [docs/stack.md](docs/stack.md). The live inventory, with status for every path, is [docs/source-of-truth.md](docs/source-of-truth.md). Portal setup is [docs/portals.md](docs/portals.md). Shipping the public site is [docs/deploy.md](docs/deploy.md). Ship the member and admin portal with `npm run portal:deploy` from the repo root. That one command updates both hosts.

## Public site

The homepage collects waitlist emails. The header button goes to that form. There is no Log in link on the marketing site.

- `/` waitlist form. Each signup is stored as a backup on IONOS and forwarded into the member database and the Resend lists `SIO Waitlist` and `SIO All`.
- `/book` sells the book PDF through a Stripe Payment Link.
- `/lessons` lists lesson titles. Video stays locked. The call to action is the waitlist.
- `/challenges` is a public teaser. There is no challenge player.
- `/membership/checkout/` is another waitlist form. Founding checkout is not wired up.
- `/unlock/` is static unlock copy plus a waitlist link.
- `/payment/` is an older payment page. It is not founding checkout.
- `/membership/`, `/free-lesson/`, `/account/`, `/portal/`, and `/membership/welcome/` redirect to the homepage or the member site.
- `/brand/` and `/brand-lab.html` are the internal brand lab.

Founding prices stay **$19.99/mo** and **$149/yr**. There is no Stripe membership checkout and no billing portal yet. A form signup does not make someone a paying member.

## Member portal

Login is a magic link to `https://member.stickitoutdrums.com/auth/callback`. The Android app (`apps/android`, package `com.stickitoutdrums.app`) is a shell around that site, and a login email opens the app when version 1.0.1 or newer is installed. Mail can fail until the Resend domain finishes DKIM and SPF. Logged-out member URLs redirect to `/login`.

After login, the tabs are Home, Practice, Rudiments, Analyze, and Profile. Rudiments is the gold circle in the center of the phone dock. Library and Challenges are off the nav. Their pages still exist. The home-screen install name is Stick It Out. The shell version label is 1.0.0.

**Home.** Where the member is, the weakest rudiment, and the next medal. A Stick with it streak ring sits beside that. No lesson cards and no challenge board.

**Practice** (`/practice`). One main drill and two alternates, chosen from hands rudiments for the member's playing level (beginner, intermediate, advanced, pro). The lowest medal, then the fewest sessions, wins. That primary pick stays the same for the Denver day. Waitlist members can see the drills and cannot log a session.

**Rudiments** (`/rudiments`). The catalog: hands, then hand-fill drills. The member's level section opens first. Feet patterns stay in the database and in admin. They are not a member tab.

Each pattern page is a practice room:

- Drum-book staff. Snare in the middle space, kick in the bottom space, hi-hat foot as an X. Hands stem up, feet stem down. Flams and drags are grace notes, buzz rolls are stem slashes, open rolls are written out. If the staff fails, the sticking text still shows the pattern.
- Metronome that opens at the member's current medal tempo. Tempo, tap, and subdivisions. The session timer is what gets logged.
- Medals from dirt through insanity, based on that pattern's Diamond BPM. A medal moves only when the member marks the session clean and the timer shows at least 30 seconds.

**Library.** Hidden from the nav. Lesson videos play only for founding and active members, through a signed Cloudflare Stream player. Waitlist and canceled members never get a playback token. The public page still shows titles only.

**Challenges.** Hidden from the nav and from Home. The page is still there. Founding and active members can submit notes on the live prompt. Waitlist can read the board. Mike scores attempts 0–100 from admin.

**Analyze.** A member with a finished profile can record or upload a take. The portal proxies `https://analyzer-origin.stickitoutdrums.com/`. That origin runs on the Ubuntu server, not the studio PC. Otherwise the page says the analyzer is offline.

Results lead with coaching in plain language, shaped by the nine recorded rudiments. Playback can draw a skeleton, elbow degrees, and stick trails. Record mode aims at 60 fps. Long clips upload in resumable pieces. Reports are not stored in the member database. They expire after 72 hours, and a job id is not tied to the member who created it.

**Profile.** First visit is a required form: name, kit, and level. Phone is optional. After that: a photo, the Stick with it streak, a badge case, and a membership pass. The badge number is the average medal rank across the hands rudiments for that playing level. Unplayed rudiments count as dirt. Founding is $19.99/mo or $149/yr. The billing button appears only when `STRIPE_PORTAL_URL` is set. It is empty, so the pass says billing is not connected.

Streak rewards sit at 3, 7, 14, 30, 60, 100, and 365 days. They stay even if the streak later breaks. A bell on Profile flashes only for a reward that has not been opened.

## Admin

Admin is locked to an allowlist. Someone off the list sees that message and a Log in button. The button opens the same magic-link form, and a non-allowlisted email still cannot enter.

- **Dashboard.** Counts, pending challenge scores, newest people into the CRM.
- **Members.** Search, plan chips, subscribed filter, one-tap Promote, Activate, and Cancel. The person page holds profile, notes, tags, a login link, Resend sync, lessons, practice, medals, streak, challenges, and an audit trail.
- **Lessons.** Upload a video to Cloudflare Stream, set a poster, preview it, and publish. Watchers show up on the lesson.
- **Rudiments.** Edit start tempo, Diamond tempo, tier, level, sticking, and the coaching note. Tempos save rounded up to a 10. This is also where today's practice pick can be overridden.
- **Challenges.** Write the prompt, publish it, and score attempts.
- **Marketing.** Resend broadcasts, lists, templates, topics, suppressions, a test send, and a sync from the member database into the lists.
- **Financials.** Member counts only. Stripe is not connected.

## Commands

Public site, from the repo root:

```bash
npm install
npm run dev          # http://localhost:4325
npm run build
npm run shipit       # build, secret scan, SFTP to IONOS
```

Waitlist mail and the database forward read `.env` (gitignored). Copy `.env.example`. `SFTP_PASSWORD` is required to ship. `LEAD_INGEST_SECRET` is how the public site posts signups into the member database.

Portals:

```bash
npm run portal:dev      # http://127.0.0.1:8787/  and  /_admin/login
npm run portal:deploy
```
