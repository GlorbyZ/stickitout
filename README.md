# Stick It Out

Astro (server output) + Cloudflare + Supabase + Resend rebuild of the Stick It Out Lessons site.

**Brand:** Direction 02 “House Lights Down” — tokens in `src/styles/tokens.css` only.

## Product

- **Lessons membership (seller):** Home `/`. Plans still live in `src/lib/commerce.ts` (same prices as the old `js/membership-commerce.js`). Stripe Payment Links for `/join` are empty until Z fills them — do not invent product IDs.
- **Free lesson:** `/free-lesson` → `POST /api/subscribe` → Resend confirm → `/api/confirm` → `/free-lesson/watch?t=…` (Supabase `subscribers`, not localStorage).
- **Book (separate):** `/book` — $19.99 PDF using the **existing** Stripe Payment Link from the old `payment.html`. Thanks: `/book/thanks`.

## Local

```bash
cp .env.example .env
# or .dev.vars for Wrangler-flavored secrets
npm install
npm run dev
```

```bash
npm run build
```

## Cloudflare Pages

1. New Pages project from this repo (production branch stays `main` — Z merges the PR).
2. Framework: Astro. Build command: `npm run build`. Output: `dist`.
3. Compatibility flags: `nodejs_compat` (see `wrangler.jsonc`).
4. Set secrets (Production + Preview) — see `.env.example`:
   - `PUBLIC_SITE_URL` (e.g. `https://stickitoutbook.com`)
   - `PUBLIC_SUPABASE_URL` / `SUPABASE_URL`
   - `PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `RESEND_API_KEY`
   - `RESEND_FROM` (address on a verified Resend domain)
5. Run `supabase/migrations/0001_init.sql` on the Supabase project (SQL editor or CLI).
6. DNS: point the domain at Pages. SPF/DKIM/DMARC for the Resend from-domain are required or confirm mail will dump to spam.

## What Z / Mike still provide

- Supabase project + run the migration
- Resend domain + SPF/DKIM
- Stripe Payment Links for monthly / biannual / annual (paste into `src/lib/commerce.ts`) and Customer Portal URL
- Lesson 01 video URL (and book explainer if there is one)
- Production deploy after PR review (do not merge from this agent)

## Legacy

Pre-Astro HTML is under `_archive/legacy-static/` (membership.html, payment.html, brand lab, etc.). Old URLs redirect where it is obvious (`/payment.html` → `/book`).

Studio credit files are unchanged at `/credits.md`, `/humans.txt`, `/llms.txt`.
