# Build spec — Home page (`/`) + Book page (`/book`)

**Repo:** `GlorbyZ/stickitout` · **Domain:** `https://stickitoutbook.com`
**Stack for this build:** static HTML + Tailwind (CDN) + vanilla JS — same as today. Everything here is written so it also survives the Astro migration later (notes marked *Astro:* where the file moves).
**Author:** Viktor · **Date:** 2026-09-16
**Brand:** Direction 02 "House Lights Down" (locked in `brand.html`)

---

## 0. The job in one paragraph

Today `index.html` sells the **book** and `membership.html` sells the **lessons**. That's backwards — the membership is the business. This build makes the membership the home page, moves the book to its own `/book` page, converts both to House Lights Down, and ships a complete SEO / icon / social-image / motion layer so the site looks like a real product the first time anyone taps a link.

**Hard rules for this build**
1. Don't promise anything that doesn't exist. No "giveaways every week", no leaderboard, no challenge results, no fake spots-remaining counter.
2. Not a speed program. Marketing copy leads with **control, timing and feel** — "clean up your hands, your feet and your pocket." BPM logging is framed as *proof of progress*, not the goal.
3. Mike's voice is humble. Berklee appears once, stated flat as context — never as a flex.
4. Blink/Travis is the **door**, not the room: song-first lesson titles, but the product is drum technique through many drummers (Travis, Copeland, Gadd, marching rudiments).
5. Branch + PR only. Never push to `main`.

---

## 1. Routing and file plan

| URL | File (now) | File (after) | Job |
|---|---|---|---|
| `/` | `index.html` (book) | `index.html` (**membership**) | Sell the membership. Free lesson is the primary CTA. |
| `/book` | — | `book.html` | The $19.99 PDF, its own page. |
| `/membership.html` | membership page | → 301/redirect to `/` | Kill the duplicate. |
| `/payment.html` | book checkout | unchanged | Linked from `/book` only. |
| `/unlock.html`, `/account.html`, `/portal.html`, `/membership-checkout.html`, `/membership-welcome.html` | — | unchanged this PR | Out of scope here. |

**Redirects / link hygiene (do not skip — this is the part that quietly tanks SEO):**
- Old book URL was `/` and old membership URL was `/membership.html`. After the swap, `/membership.html` must **301 to `/`** and the book gets a *new* URL, so add a `<link rel="canonical">` to every page and update `sitemap.xml`.
- On the host: if Cloudflare Pages, use `_redirects` → `/membership.html / 301`. If it stays on SFTP/Apache, `.htaccess` → `Redirect 301 /membership.html /`.
- Pretty URL for the book: serve `book.html` at `/book` (Pages does this automatically for `book.html`; on Apache add `RewriteRule ^book/?$ book.html [L]`). Canonical is `https://stickitoutbook.com/book`.
- Grep the whole repo for `membership.html` and `index.html` links and repoint them (`js/navbar.js` included).
- *Astro:* `src/pages/index.astro` and `src/pages/book.astro`.

**Domain note (flag, not a blocker):** the domain literally says "book" while the home page now sells lessons. That's fine for launch — canonical stays `stickitoutbook.com`. If a `stickitout` domain gets bought later, do the migration in one move: 301 everything, keep paths identical.

---

## 2. Design system (replace the teal theme)

`membership.html` currently uses a teal/blue palette that isn't the brand. Convert to House Lights Down. Put the tokens in one place both pages read.

```css
:root{
  --blackout:#0C0B0A;  /* page bg */
  --wings:#161311;     /* panels / cards */
  --cue:#F2EBE3;       /* text */
  --gel:#E8A317;       /* accent, CTA */
  --on-gel:#1A1206;    /* text on accent */
  --chrome:#9AA3AD;    /* muted text, hairlines */
  --line:rgba(242,235,227,.10);
  --radius:14px;
  --ease:cubic-bezier(.2,.8,.2,1);
}
```

- **Display:** Bebas Neue — uppercase, tight leading (`0.9`), used for H1/H2/stat numbers/buttons.
- **Body:** Barlow 400/500/600. Body copy min `17px` mobile / `18px` desktop, line-height `1.6`.
- **Accent discipline:** gold is for *one* thing per screen — the primary action. Two gold buttons side by side = neither reads as primary.
- Contrast: `--cue` on `--blackout` = 16.6:1. Gold on blackout = 9.1:1, safe at any size; text sitting *on* gold uses `--on-gel`.
- Load fonts with `display=swap` + `preconnect` (already in the repo) and preload only the Bebas file used above the fold.
- **Tailwind:** extend the theme in the inline `tailwind.config` (same pattern as `membership.html` today) with `blackout/wings/cue/gel/chrome` so no hex codes appear in markup. *Note:* the Tailwind CDN is a real performance cost (~40kb JS, render-blocking). Acceptable for this PR; a compiled `styles.css` is the follow-up.

---

## 3. Home page (`/`) — section by section

Order matters. This is the sequence.

### 3.1 Header
Sticky, 64px, `backdrop-filter: blur(10px)` over `rgba(12,11,10,.72)`, 1px bottom hairline that only appears after 24px of scroll.
- Left: logo (`img/logo.png`, 32px, links `/`).
- Center (desktop ≥1024px): `Lessons · Pricing · About Mike · Book`.
- Right: `Log in` (text) + **Start free lesson** (gold button).
- Mobile: logo + gold **Free lesson** button only. No hamburger — there are four links; put them in the footer instead. Fewer taps, less code.

### 3.2 Hero
> **Eyebrow:** Don't flinch on the one.
> **H1:** ONE LESSON. / ONE WEEK. / THEN THE NEXT ONE.
> **Sub:** Structured drum training from Mike Staus — we clean up your hands, your feet and your pocket, so you can sit behind any kit and know you can play. One ~10-minute lesson a week, and the routine that goes with it.
> **Primary CTA:** Start with a free lesson
> **Secondary:** See what's in the library →
> **Micro-line under CTA:** No card. Just the first lesson and your email.

Layout: single column, centered, max-width `860px`, `min-height: 88svh` (use `svh`, not `vh` — `vh` jumps on mobile Safari). Background = one image (`img/gym/hero-bg.jpg`) at `opacity:.35` under a `linear-gradient(180deg, rgba(12,11,10,.55), var(--blackout) 85%)`.
Trust row under the CTA, 4 items, `--chrome`, 13px: `Berklee-trained` · `Touring + studio drummer` · `New lesson every week` · `Cancel anytime`.

### 3.3 How it works — three steps
`THREE STEPS, NO HOMEWORK PILE`
1. **Pick your week.** Browse the library, grab the lesson you want. Nothing's locked once you're in.
2. **Get the routine.** ~10 minutes of teaching plus a written daily plan — 15 minutes a day and your starting tempo.
3. **Log it and move on.** Log day 1 and day 7. Beat your own number, then take the next lesson.

> Rule we actually enforce: never more than two lessons a week. Two weeks of real reps beats ten videos you watched once.

Three cards, `--wings`, gold numeral in Bebas at 48px.

### 3.4 The library
`THE LIBRARY` — **8 lessons at launch. One more every week.**
One featured card (the free lesson, 16:9 thumbnail, gold `FREE` pill) + a grid of the rest (2 up mobile, 4 up desktop). Each card: thumbnail, title, `~10 min · week routine · BPM log`, and a lock glyph on paid ones.
Titles are song-first and Mike renames freely. Under the grid: **Tracks** — "Not sure where to start? Take a Track: four lessons in order, one month of practice."
*Implementation:* lessons live in one array in `js/lessons.js` (`{slug,title,minutes,free,thumb,track}`) and the grid renders from it, so adding lesson 9 is one line. Do **not** hardcode 8 cards in HTML.

### 3.5 Learn with Mike
Photo (`img/mike.jpg`, 4:5, gold hairline) + copy. Humble register:
> Mike Staus is a studio and touring drummer out of Billings, MT. He studied at Berklee and has spent years obsessing over this instrument — and he was stuck for a long time before any of it clicked. That's what he teaches: what actually got him unstuck.
Four checkmarks: one instructor / a written routine with every lesson / progress you can prove / a new lesson every week. Pull-quote in Barlow italic with a gold left rule.

### 3.6 Pricing
`FOUNDING MEMBER PRICING` — **$19.99/month. Locked for life. First 100 members.** After that it's $29.99 — founding members never move.
Two cards: **Founding Monthly $19.99/mo** (default, gold border + `MOST POPULAR` tag) and **Founding Annual $149/yr** (`~$12.42/mo`, book PDF included). Below: `Cancel anytime from your account.`
- Prices come from `js/membership-commerce.js` — **do not retype them into the HTML**, render from the config. Update that file's `priceLabel`s to the decided founding numbers in the same PR.
- If `checkoutUrl` is empty the button shows the email-capture / waitlist state (existing behaviour) instead of a dead link.
- **No spots-remaining counter until it can be a real number.** A fake one gets caught.

### 3.7 Free-lesson capture (the money block)
Full-width band, `--wings`, single email field + gold **Send me lesson 01**. One field, `type="email"`, `autocomplete="email"`, `inputmode="email"`, `enterkeyhint="send"`.
States: idle → validating (inline, on blur, never a browser alert) → submitting (button label swaps to a 3-dot pulse, button stays the same width so nothing jumps) → success (field collapses, gold check draws in, "Check your inbox — it's on the way") → error ("That didn't go through. Try again or DM Mike.").
**This must POST somewhere real.** Today the waitlist only writes to `localStorage`, which means every signup is lost. Wire it to the endpoint Z is building; until then keep `localStorage` as a fallback *and* leave a `TODO(email-capture)` comment at the fetch call. Never show a success state for a submit that only touched `localStorage`.

### 3.8 FAQ
6 questions max, native `<details>/<summary>` (keyboard + screen-reader accessible for free), chevron rotates 180° on open, content height animated with `grid-template-rows: 0fr → 1fr`. Mirrors the FAQ JSON-LD in §5 exactly — same words, or it's a rich-result violation.

### 3.9 Book strip
One row above the footer: **Want the coordination work on paper?** *Stick It Out*, Mike's book — PDF $19.99, or included with the founding annual plan. `See the book →` links `/book`. Small. It must not compete with the membership CTA.

### 3.10 Final CTA + footer
`DON'T FLINCH ON THE ONE.` + `Start free lesson` (gold) · `See pricing` (ghost).
Footer: logo, nav links, socials (TikTok/IG/YouTube), `© 2026 Stick It Out`, and the existing Blaze credit block — keep that block byte-for-byte, it's on every page on purpose.

### 3.11 Mobile sticky CTA
After the hero scrolls out of view, slide up a bottom bar: `From $19.99/mo` + **Start free lesson**. `padding-bottom: max(12px, env(safe-area-inset-bottom))`. Hides again when the pricing section or the email capture is in view (don't stack two CTAs). Mobile only.

---

## 4. Book page (`/book`)

Keep the current book hero's structure — it's genuinely good — and restyle it to House Lights Down (the red `#B91C1C` becomes `--gel`; Cinzel/Lato become Bebas/Barlow so the two pages feel like one site).

Sections, in order:
1. **Hero:** cover image (`img/cover.jpg`, preloaded, `fetchpriority="high"`, explicit `width/height`) + H1 `STICK IT OUT` + `Rhythm is resilience.` + primary **Buy the PDF — $19.99** (→ `payment.html?format=pdf`) + secondary `Get the weekly lessons instead →` (→ `/`).
2. **What it is:** 3–4 bullets on what the coordination system covers. Say it plainly: patterns, kick/hand independence, how to practice them.
3. **What's inside:** page count, exercise count, format (PDF), what device it reads on. If those numbers aren't confirmed, leave the block out — don't invent them.
4. **Sample:** 2–3 page images or a single spread. If Mike's book explainer video exists, embed it here, lazy (poster image + click-to-load iframe, never an autoloading embed — it costs ~700kb and a second of LCP).
5. **Who it's for / who it isn't.** Honest framing sells the PDF better than hype.
6. **Physical copy:** "Print edition — summer." Not a form, not a waitlist, just a line (the physical option is disabled today).
7. **Membership cross-sell:** "The book is the paper version. The lessons are the weekly version — the founding annual plan includes this PDF." → `/`
8. **FAQ (3 questions):** delivery (instant download after Stripe), refunds, is it for beginners.
9. Footer, same as home.

Checkout truth: `payment.html` holds the **live** Stripe link for the PDF — don't touch that link, and don't duplicate it into `book.html`; link to `payment.html`.

---

## 5. SEO

### 5.1 Per-page meta

**`/`**
```html
<title>Stick It Out — Weekly Drum Lessons with Mike Staus</title>
<meta name="description" content="Structured drum training with Mike Staus. One ~10-minute lesson a week that cleans up your hands, your feet and your pocket, plus the routine to practice it. First lesson free.">
<link rel="canonical" href="https://stickitoutbook.com/">
```
**`/book`**
```html
<title>Stick It Out — The Drum Coordination Book (PDF) | Mike Staus</title>
<meta name="description" content="Stick It Out is Mike Staus's kick-and-hand coordination system for drummers — demanding patterns, no filler. Instant PDF download, $19.99.">
<link rel="canonical" href="https://stickitoutbook.com/book">
```
Both: `<meta name="robots" content="index,follow,max-image-preview:large">`, `<meta name="theme-color" content="#0C0B0A">`, `<html lang="en">`, `og:locale=en_US`, `og:site_name=Stick It Out`.
Rules: exactly one `<h1>` per page; `<h2>` per section, no level skipping; every image gets a real `alt` (decorative ones get `alt=""`); every image gets `width`/`height` (CLS); everything below the fold gets `loading="lazy" decoding="async"`.

### 5.2 Structured data
One `<script type="application/ld+json">` per page with an `@graph`. Keep the existing Blaze credit JSON-LD block untouched and add a second block — don't merge them.

- **Both pages:** `Organization` (`@id: https://stickitoutbook.com/#org`, name, url, logo, `sameAs` TikTok/IG/YouTube) + `WebSite` + `Person` for Mike (`@id .../#mike`, jobTitle "Drummer / Instructor", `alumniOf` Berklee College of Music).
- **Home:** `Course` → `hasCourseInstance` (`courseMode: online`, `courseWorkload: PT10M`), `provider` → `#org`, `instructor` → `#mike`; plus `Product` + `Offer` for the membership (`price 19.99`, `priceCurrency USD`, `availability InStock`, `url https://stickitoutbook.com/#pricing`); plus `FAQPage` matching §3.8 verbatim.
- **Book:** `Book` + `Offer` (`price 19.99`, `bookFormat EBook`, `author` → `#mike`, `isbn` only if one exists) + `BreadcrumbList` (Home → Book).
- **No `aggregateRating` and no `review` until real reviews exist.** Fake review markup is a manual-action risk, not a gray area.
- Validate both pages in Google's Rich Results Test before merge.

### 5.3 Crawl files
- `sitemap.xml`: `/` (priority 1.0), `/book` (0.8), `/free-lesson` when it exists. **Remove `membership.html`.** Update `lastmod`.
- `robots.txt` already allows the AI crawlers and points at the sitemap — keep it, just confirm the sitemap URL still resolves.
- `llms.txt` / `credits.md` / `humans.txt`: these currently describe the Blaze demo path (`blazedigitaldesign.com/demos/stickitout/`). On the real domain those URLs are wrong — update them to `stickitoutbook.com` paths in this PR, plus one added line describing what the site sells now.
- Internal linking: home → book (strip), book → home (twice), footer nav on both. Descriptive anchor text, never "click here".

### 5.4 Performance budget (SEO is mostly speed now)
| Metric | Target |
|---|---|
| LCP (mobile, 4G) | < 2.0s |
| CLS | < 0.05 |
| INP | < 150ms |
| Total page weight, home | < 900kb |
| Hero image | < 180kb, AVIF/WebP with JPG fallback via `<picture>` |
Also: `preconnect` fonts only (drop unused preconnects), no web font for numerals, no carousel libraries, zero third-party JS beyond Tailwind CDN + Stripe. Run Lighthouse mobile before merge — 90+ on Performance, 100 on Best Practices/SEO/Accessibility is achievable on a static page.
**CSP:** `index.html` ships a strict CSP today. Whatever the new home page needs (Stripe `js.stripe.com`, `checkout.stripe.com` in `frame-src`, the email endpoint in `connect-src`) has to be added deliberately — don't delete the CSP to make something work.

---

## 6. Icons and favicons (complete set)

Source: `img/logo.png`. Build a proper square glyph first — the "SIO" mark or a single drumstick pair in gold on `--blackout`, with ~12% padding so it survives circular and squircle cropping.

Generate into `/icons/`:

| File | Size | Purpose |
|---|---|---|
| `favicon.ico` | 16+32+48 multi-res | legacy / IE / bookmark bars |
| `favicon.svg` | vector | modern browsers, sharp at any size |
| `favicon-96.png` | 96×96 | fallback |
| `apple-touch-icon.png` | 180×180 | iOS home screen (no transparency — iOS makes it black) |
| `icon-192.png` | 192×192 | Android / manifest |
| `icon-512.png` | 512×512 | manifest, splash |
| `icon-maskable-512.png` | 512×512 | Android adaptive — art inside the 80% safe circle |
| `mstile-150.png` | 150×150 | Windows tiles |
| `safari-pinned-tab.svg` | monochrome | Safari pinned tab |

Head block (both pages, identical):
```html
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/icons/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="mask-icon" href="/icons/safari-pinned-tab.svg" color="#E8A317">
<meta name="theme-color" content="#0C0B0A">
<meta name="apple-mobile-web-app-title" content="Stick It Out">
<meta name="msapplication-TileColor" content="#0C0B0A">
```
`site.webmanifest`: `name: "Stick It Out"`, `short_name: "Stick It Out"`, `start_url: "/"`, `display: "standalone"`, `background_color: "#0C0B0A"`, `theme_color: "#0C0B0A"`, icons 192/512/maskable. (This also makes the site installable — which is the cheap version of the "app" conversation, no extra work.)
`favicon.ico` and `favicon.svg` go at the **web root**, not in `/icons/`. Some clients only look at `/favicon.ico`.

---

## 7. Social / OG images (all types)

Keep every one flat: `--blackout` background, one gold element, huge Bebas headline, logo bottom-left. Text must be legible in a 200px-wide preview — so ≤ 7 words, ≥ 64px type at 1200 wide. Safe margin 80px all round; Slack/Twitter crop edges.

| File | Size | Where it shows |
|---|---|---|
| `og-home.jpg` | 1200×630 | Facebook, Slack, iMessage, LinkedIn, Discord, X large card |
| `og-book.jpg` | 1200×630 | book page shares |
| `og-square.jpg` | 1200×1200 | WhatsApp, some LinkedIn/IG renderers |
| `og-story.jpg` | 1080×1920 | IG/TikTok story link stickers (already produced for the teasers) |
| `og-lesson-template.jpg` | 1200×630 | per-lesson shares later — title area left blank |

Copy on the home OG: **"One lesson. One week. Then the next one."** + `stickitoutbook.com` + `First lesson free`.
Book OG: the cover image on the right, `STICK IT OUT` + `Rhythm is resilience.` + `PDF $19.99` on the left.

Head block (absolute URLs — relative `og:image` paths fail in most scrapers, which is the bug on the current pages):
```html
<meta property="og:type" content="website">              <!-- book page: "book" -->
<meta property="og:site_name" content="Stick It Out">
<meta property="og:title" content="A drum lesson a week. Not a pile of videos.">
<meta property="og:description" content="Structured drum training with Mike Staus. Hands, feet, pocket. First lesson free.">
<meta property="og:url" content="https://stickitoutbook.com/">
<meta property="og:image" content="https://stickitoutbook.com/img/social/og-home.jpg">
<meta property="og:image:secure_url" content="https://stickitoutbook.com/img/social/og-home.jpg">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Stick It Out — one lesson, one week, then the next one.">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="A drum lesson a week. Not a pile of videos.">
<meta name="twitter:description" content="Structured drum training with Mike Staus. First lesson free.">
<meta name="twitter:image" content="https://stickitoutbook.com/img/social/og-home.jpg">
<meta name="twitter:image:alt" content="Stick It Out — weekly drum lessons.">
```
Keep each OG JPG under 300kb (hard limits: WhatsApp ~300kb, most scrapers 8MB but slow = no preview). Validate with Facebook Sharing Debugger, X Card Validator, LinkedIn Post Inspector, and by pasting the link into Slack + iMessage. Scrapers cache hard — re-scrape after changing an image, or bump the filename.

---

## 8. UX rules

- **Tap targets ≥ 44×44px** with ≥ 8px between them. Current membership page already has a `.tap` helper — use it everywhere.
- **Focus visible, always:** `:focus-visible { outline: 2px solid var(--gel); outline-offset: 2px }`. Never `outline: none` without a replacement.
- **Skip link** to `#main` as the first focusable element.
- **One primary action per screenful.** Everything gold points at the free lesson (top/middle) or the founding plan (pricing down).
- **No modals, no popups, no exit-intent, no cookie banner** (there's nothing to consent to if analytics are cookieless — use Cloudflare Web Analytics or Plausible).
- **No autoplaying audio or video.** Ever. Drummers browse at work.
- **Forms:** labels present (visually hidden is fine), inline validation on blur not keystroke, errors in text + color (not color alone), `aria-live="polite"` for the success/error line, keyboard `Enter` submits.
- **Every link that leaves the page** or opens Stripe says so: `Opens secure Stripe checkout`.
- **Empty/pending states are honest:** locked lesson cards say `Members only`, not a broken player. If checkout isn't wired, the button says `Join the founding list` — not `Buy now`.
- **Reduced motion:** `@media (prefers-reduced-motion: reduce) { *,*::before,*::after { animation-duration:.01ms !important; transition-duration:.01ms !important; scroll-behavior:auto !important } }`
- **Test at 320px wide** (iPhone SE) and at 200% zoom. No horizontal scroll at either.
- **Dark-mode-only is fine** — but set `color-scheme: dark` so form controls and scrollbars match.

---

## 9. Microanimations

Rules first: animate **`transform` and `opacity` only** (never `top/left/width/height`), 150–350ms for interactions, ≤ 700ms for entrances, one easing (`--ease`), and nothing may shift layout. If an animation can't run at 60fps on a mid-range Android, cut it.

| # | Where | What | Spec |
|---|---|---|---|
| 1 | Section entrances | fade + rise | `opacity 0→1`, `translateY(16px→0)`, 520ms, IntersectionObserver at `threshold:.15`, `once`. Stagger children 60ms. |
| 2 | Hero headline | lines rise in sequence | three lines, 80ms apart, 600ms each. Runs on load, no observer. |
| 3 | Header | condense on scroll | after 24px: height 72→56px, hairline fades in, bg blur increases. 200ms. |
| 4 | Primary buttons | hover/press | hover: `translateY(-2px)` + gold glow `0 8px 28px rgba(232,163,23,.28)`, 180ms. active: `scale(.98)`, 90ms. |
| 5 | Gold button sheen | one-pass highlight | the existing `translate-x-[-100%] → [100%]` gradient sweep, 700ms, hover only (already in `index.html` — keep it, it's good). |
| 6 | Lesson cards | lift + thumb zoom | card `translateY(-4px)`, thumbnail `scale(1.04)`, 260ms; gold hairline fades in on the border. |
| 7 | Lock glyph | shake on click of a locked card | `translateX(±3px)` ×2, 220ms, then scroll to pricing. Tells the user *why* nothing happened. |
| 8 | FAQ | chevron + height | chevron `rotate(180deg)` 200ms; body `grid-template-rows: 0fr→1fr` 280ms. |
| 9 | Email field | focus + submit | focus: border → gold, `box-shadow` ring grows 160ms. Submitting: 3-dot pulse in the button, fixed width. Success: SVG check `stroke-dashoffset` draws in 420ms + field fades out. |
| 10 | Pricing cards | selected state | selected card `scale(1.02)` + gold border, 220ms. Not a hover effect — a state. |
| 11 | Mobile CTA bar | slide up | `translateY(100%→0)` + fade, 280ms, when hero leaves viewport; reverse when pricing enters. |
| 12 | Counters (stat numbers) | count up | only if the number is real (lesson count, minutes of teaching). 900ms, `requestAnimationFrame`, starts when 50% visible. Skip entirely under reduced motion — show the final number. |
| 13 | Metronome accent | brand touch | a 2px gold bar under the hero eyebrow pulsing at 100bpm (`animation: pulse 600ms steps(1) infinite`). Subtle, on-brand, cheap. Kill it under reduced motion. |
| 14 | Page transitions | cross-fade | `@view-transition { navigation: auto }` — one line, progressive, ignored by browsers that don't support it. |
| 15 | Anchor scrolls | smooth + offset | `scroll-behavior:smooth` on `html`, `scroll-margin-top:80px` on every anchor target so the sticky header doesn't cover the heading. |

Anti-patterns, explicitly banned: parallax on mobile, scroll-jacking, animating in on *every* scroll pass (`once` only), spinners longer than 400ms without a skeleton, text that fades in per-letter, anything that delays the first CTA becoming clickable.

---

## 10. Accessibility acceptance

- Keyboard-only pass: every CTA, the FAQ, and the email form reachable and operable, focus order matches visual order.
- `axe` DevTools: zero violations.
- Contrast: all body text ≥ 4.5:1, large display ≥ 3:1. Gold on blackout is 9.1:1 and on `--wings` 8.5:1 — both fine. Chrome on blackout is 7.7:1. Never gold on white (1.9:1).
- Screen reader: the lesson grid is a `<ul>`, locked cards announce "Members only", images have alt text, decorative background images are CSS not `<img>`.

---

## 11. Definition of done (check every box before requesting review)

- [ ] `/` sells the membership; `/book` sells the PDF; `/membership.html` 301s to `/`.
- [ ] No teal left anywhere; both pages read as House Lights Down.
- [ ] Prices render from `js/membership-commerce.js` ($19.99 monthly founding / $149 annual founding / $29.99 after), nothing hardcoded.
- [ ] Empty `checkoutUrl` degrades to email capture, no dead buttons.
- [ ] Email capture POSTs to a real endpoint, or shows no success state.
- [ ] Full icon set + `site.webmanifest`, favicon at web root, verified on iOS home screen and Android.
- [ ] 5 social images generated; both pages validated in the FB, X and LinkedIn debuggers plus a Slack and iMessage paste.
- [ ] Canonicals set, `sitemap.xml` updated, `llms.txt`/`credits.md`/`humans.txt` point at the live domain.
- [ ] Rich Results Test passes for `Course`+`Product`+`FAQPage` (home) and `Book`+`Offer` (book).
- [ ] Lighthouse mobile: Perf ≥ 90, A11y 100, Best Practices 100, SEO 100.
- [ ] `prefers-reduced-motion` kills every animation.
- [ ] 320px and 200% zoom: no horizontal scroll.
- [ ] Nothing on either page promises a feature that doesn't exist.
- [ ] Blaze credit block intact on both pages.
- [ ] Branch + PR, not `main`.

---

## 12. Out of scope (parked — do not build in this PR)

Member portal / video player, `/lessons` index and lesson pages, `/free-lesson` page (the capture band on `/` covers launch), challenges + leaderboard, profiles / handles / badges / streaks, earned merch, donate or tip jar, blog, PWA offline, other instruments, Astro migration.
