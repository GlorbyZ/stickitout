# Stick It Out

Drum book and lessons membership. Three live sites share one repo.

| Site | URL | What it is |
| --- | --- | --- |
| Public | https://stickitoutdrums.com/ | Astro marketing site on IONOS |
| Members | https://member.stickitoutdrums.com/ | Practice, lessons, analyze |
| Admin | https://admin.stickitoutdrums.com/ | Allowlisted ops portal |

The live inventory, with status for every path, is [docs/source-of-truth.md](docs/source-of-truth.md). Portal setup is [docs/portals.md](docs/portals.md). Shipping the public site is [docs/deploy.md](docs/deploy.md).

`stickitoutbook.com` does not resolve. Do not use it.

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

Login is a magic link. Mail can fail until the Resend domain finishes DKIM and SPF.

After login, the tabs are Home, Practice, Library, Analyze, and Profile. On a phone they sit in a bottom dock. The home-screen install name is Stick It Out.

**Home.** Today's pattern, a streak ring, lesson progress, and the live challenge board when one is published.

**Practice** (`/rudiments`). Two catalogs: Rudiments (hands) and Hand fill drills (four-limb only). Feet patterns stay in the database and in admin. They are not a member tab.

Each pattern is a practice room:

- Drum-book staff. Snare in the middle space, kick in the bottom space, hi-hat foot as an X. Hands stem up, feet stem down. Flams and drags are grace notes, buzz rolls are stem slashes, open rolls are written out. If the staff fails, the sticking text still shows the pattern.
- Metronome that opens at the member's current medal tempo. Tempo, tap, and subdivisions. The session timer is what gets logged.
- Medals from dirt through insanity, based on that pattern's Diamond BPM. A medal moves only when the member marks the session clean and the timer shows at least 30 seconds.

Today's pick stays the same all day: hands on even Denver days, four-limb fills on odd days. The weakest medal, then the stalest practice, wins. An admin override replaces that pick.

Streak rewards sit at 3, 7, 14, 30, 60, 100, and 365 days. They stay even if the streak later breaks. A bell on Home, Practice, and Profile flashes only for a reward that has not been opened.

**Library.** Lesson videos play only for founding and active members, through a signed Cloudflare Stream player. Waitlist and canceled members never get a playback token. The public page still shows titles only.

**Challenges.** Hidden from the member nav. The page is still there. Founding and active members can submit notes on the live prompt. Waitlist can read the board. Mike scores attempts 0–100 from admin, and that board is the same data on home, challenges, and the CRM.

**Analyze.** A member with a finished profile can record or upload a take. The portal proxies the analyzer on the studio PC. The tab works only while that PC is on and running `start-remote.ps1`. Otherwise the page says the analyzer is offline.

Results lead with coaching: a focus card, ranked findings, how to fix them, timestamp chips on the playback, what went well, and a confidence note. Scores sit under that. Playback can draw a skeleton on frames that have a detection. Record mode aims at 60 fps. Long clips upload in resumable pieces. Reports are not stored in the member database. They expire after 72 hours, and a job id is not tied to the member who created it.

**Profile.** First visit is a required form: name, kit, and level. Phone is optional. After that, the page opens with a badge case: medals by tier and by pattern, plus streak badges. Billing management is empty until Stripe is connected.

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
