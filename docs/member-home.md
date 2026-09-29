# Member Home — layout spec

Target: `workers/app/src/html.ts` → `memberHome()`, CSS in `workers/app/src/ui.ts`.
Written against `main` @ `9b79788` (Home as rebuilt in `fbfaad0`). Sections 1–7 and 9 are implemented by the PR that adds this file; §8's `analyses` table is not.
Mobile first: every rule below describes the 390 px phone. Desktop is the same order, re-flowed.

---

## 1. The rule the page obeys

> **One state, one gap, one button.** A member should know in under two seconds: where I am, what to fix, and what to tap.

Everything on Home earns its place by answering one of those three. Anything else is a link at the bottom or lives on another tab.

Pro apps (Whoop, Strava, Duolingo) do not put four equal cards on a home screen. They put **one dominant object** at the top, a thin band of evidence under it, and then get out of the way. Today's Home has the dominant object right — the stage is genuinely good — but then repeats it in three smaller cards, which is what makes it read like an internal tool instead of a product.

---

## 2. What's wrong with the shipped page

| # | Problem | Evidence in code |
| --- | --- | --- |
| 1 | The same three facts appear twice. Level in `bench-kicker` **and** beat 01. Badge score in `.readout` **and** beat 01. Rudiment title in `.stage-title` **and** beat 02. Next medal in `stageNote` **and** beat 03. | `memberHome()` lines ~110–145 |
| 2 | The big number is `score.score` — an average medal rank. It cannot be acted on. | `.readout-num` renders `scoreText` |
| 3 | The page has no memory. The route loads `streakState`, `practicePlan`, `recentPracticeDays` — a list of dates, nothing about what was played. | `index.ts`, `path === '/'` |
| 4 | Analyze is invisible. `grep -i analyze workers/app/src/html.ts` → 0 hits. | — |
| 5 | On the phone, `.beats` stacks to three ~8.2 rem cards, so the fold ends on repeated text and the member scrolls past 26 rem of it to reach nothing. | `.beats li { min-height: 8.2rem }` |

---

## 3. Information architecture

Order on the phone, top to bottom. Same order on desktop.

```
[ mast ]        greeting + level + analyzer chip
[ stage ]       THE GAP — rudiment, BPM gap bar, 2 actions, streak ring
[ evidence ]    "Since you were here" — 3 facts, horizontal scroll on phone
[ ladder ]      medal ladder for the gap rudiment + 2 next-closest
[ analyze ]     "Check yourself" strip
[ footer ]      quiet links + membership status
```

Six blocks. No block repeats another block's numbers.

---

## 4. Block by block

### 4.1 Mast

- Line 1: `Hey {first}` — `.greet`, keep as is.
- Line 2: `{Level} · {n} of the last 7 days` — replaces "position on the ladder" (internal language; a member does not think in ladders until they see one).
- Right side, same row: **analyzer chip** — `● Analyzer online` / `○ Analyzer offline`. Small, `--chrome`, 999px border. Offline copy: *Analyzer offline — practice still works.*
  - Data: `GET /analyze/api/config` through the existing proxy, 1.5 s timeout, cached 60 s in the Worker. If the fetch fails, render nothing rather than a red state — Home must never look broken because the Ubuntu box is asleep.
- Phone: mast is one row, chip wraps under the greeting below 360 px.

### 4.2 Stage — the only dominant object

Keep `.stage` / `.stage-main` / `.stage-side` exactly as built. Change what is inside `.stage-main`:

| Slot | Content | Source |
| --- | --- | --- |
| Label | `Work on this today` (was: *The gap*) | static |
| Title | Rudiment name, `.stage-title` clamp(3rem, 7vw, 5rem) | `daily.pattern.title` |
| Sticking | `R R L L R R L L`, letter-spaced, `--chrome` | `pattern.sticking` |
| **Gap bar** | `Your best clean **84 BPM**` … right-aligned `Bronze at 90`, then an 10 px track filled `best / target`, then `6 BPM to go — clean, click on, 30 seconds.` | `pattern.best_bpm`, `nextTargetBpm()`, `HOLD_SECONDS` |
| Actions | **Start practice** (primary, `min-height:52px`) · **Record a take** (ghost → `/analyze`) | — |

The gap bar is the whole point of the redesign: it converts the abstract badge score into the one number the member can move tonight. Max width `430px` so the bar never stretches on desktop.

`.stage-side` keeps the streak ring. Under it, one line: `4/7 this week · longest 14` and `streakLine()`. The badge score **leaves the stage** — it moves to §4.4 as a quiet caption.

Phone behaviour (existing `@media (max-width: 799px)` block already does this): `.stage-side` becomes a two-column strip — ring left, streak text right — so the ring does not eat a full screen above the fold.

**Above the fold at 390×844 must contain:** title, gap bar, both buttons. Verify with devtools; if the sticking line pushes the buttons down, drop the sticking to `0.82rem`.

### 4.3 Evidence — "Since you were here"

Three facts, all from `practice_logs`. No new tables.

| Card | Primary | Secondary |
| --- | --- | --- |
| Last session | `82 BPM` | `Double Stroke Roll · 12 min · clean` + relative day |
| This week on the kit | `46 min` | `▲ 12 min vs last week` + 7-bar sparkline (one bar per Denver day) |
| Best clean tempo | `84 BPM` | `▲ 4 since last week` + 7-point line |

Source is `pattern_sessions` (`bpm`, `seconds`, `clean`, `at`) — **not** `practice_logs`, which only mirrors a note line for the CRM and has no duration. Implemented as `practiceEvidence()` in `workers/app/src/patterns.ts`:

```sql
SELECT substr(at, 1, 10) AS day,
       SUM(IFNULL(seconds, 0)) AS seconds,
       MAX(CASE WHEN clean = 1 THEN bpm END) AS best_clean
FROM pattern_sessions
WHERE person_id = ?1 AND substr(at, 1, 10) >= ?2   -- 14 days back
GROUP BY day ORDER BY day ASC;
```

plus one `SELECT … JOIN patterns … ORDER BY at DESC LIMIT 1` for the last-session card. Fourteen days, so this week and last week come from one query. Day buckets are `substr(at, 1, 10)`, the same buckets `recentPracticeDays()` already uses for the streak strip.

- Phone: **horizontal scroll rail**, not a stack. `display:flex; overflow-x:auto; scroll-snap-type:x mandatory;` cards `min-width: 72vw; scroll-snap-align:start;` with `-webkit-overflow-scrolling:touch`. This is the single biggest "feels like an app" change — three stacked cards read as a form, a snapping rail reads as a dashboard.
- ≥720 px: `grid-template-columns: repeat(3, minmax(0,1fr))`.
- Deltas: green `#7BC96F` for improvement in the member's direction (more minutes, higher BPM). Never red — this is a practice app, not a report card. A down week says `3 min less than last week` in `--chrome`.
- Numbers use `font-variant-numeric: tabular-nums` (already on `.readout-num`; add to the new `.fact b`).

### 4.4 Ladder

One panel, full width.

- Heading row: `Your ladder · {rudiment}` left, `Badge score 3.4 · Bronze territory` right in `--chrome`, `0.84rem`. That is where the average score now lives — as context, not as the headline.
- Seven rungs, `display:flex; gap:6px`, each `flex:1`: a 8 px cap + the medal name and its BPM under it. Earned rungs at 55 % gel, current rung full gel and label in `--cue` bold, the rest at 8 % cue.
- Below: `Next closest: **Single Stroke Roll** — 8 BPM from Silver · **Paradiddle** — 15 from Bronze`, both links to the rudiment page.
- Phone ≤ 520 px: drop to the **five rungs centred on the member** (current ±2) so the labels stay legible; the caption says `… of 7 tiers`. Never shrink type below `0.68rem`.

### 4.5 Check yourself (Analyze)

One strip, not a card grid: copy left, ghost button right.

> **Check yourself** — Film 30 seconds of {rudiment} and get timing, drift and a coaching line back.
> Last take: *none yet* / *2 days ago · 104 BPM held*

- Button **Open Analyze** → `/analyze`. If the chip in §4.1 says offline, the button stays but the caption becomes *Analyzer offline — try later tonight.*
- The "Last take" line is the only thing on Home that needs data that does not exist yet (see §8). Until then it reads `Never tried it — most members start here.`

### 4.6 Footer

`All rudiments · Library · Challenge board · Profile` as pill links (44 px tall), and the membership line: `Founding member · $19.99/mo locked` or, for waitlist, `Waitlist — founding spots open soon` with no fake checkout link.

---

## 5. States

| State | Home shows |
| --- | --- |
| Waitlist member | Everything renders, buttons visible; stage note: *You can see the path. Logging a session unlocks with a founding spot.* Evidence rail shows `—` with *Your first session lands here.* |
| Brand-new member, no sessions | Gap bar renders at the pattern's start tempo with 0 % fill and copy *No clean run yet — first one sets the mark.* Evidence rail collapses to one card: *Log your first session and this row fills in.* |
| No daily pick (`daily === null`) | Stage title *Your next step*, single button **Open practice**. No gap bar, no ladder. |
| Analyzer offline | Chip greys, Analyze strip keeps the button, caption changes. Nothing else moves. |
| Streak at risk | Ring goes `is-open`, ring line *{n}h left to keep it* (already implemented). |

Every state is server-rendered. No skeletons, no client fetch on Home — the Worker already has the data in one round trip, so the page should paint complete.

---

## 6. Responsive rules

| Width | Behaviour |
| --- | --- |
| ≤ 360 px | Chip wraps under greeting; dock labels already shrink (`.dock a { font-size:.54rem }`); ladder shows 5 rungs |
| 390–839 px | Single column; evidence is a snap rail; `.stage-side` is the ring+text strip; **bottom padding must clear the dock** — `body.kind-member` already reserves `7.6rem + safe-area`, keep the footer above it |
| ≥ 800 px | `.stage` goes 1.55fr / 0.72fr (existing rule) |
| ≥ 720 px | Evidence becomes a 3-up grid |
| ≥ 1100 px | Content max-width stays at the existing wrap; do **not** widen the stage past ~1140 px or the title reads as a billboard |

Touch: every tappable thing ≥ `var(--touch)`; the two stage buttons stay 52 px. Respect `env(safe-area-inset-*)` — already handled in `.bar` and `.dock`, just don't add fixed elements.
Motion: keep `.rise-in` on the stage only, and keep the existing `@media (prefers-reduced-motion: reduce)` guard. Nothing else animates on load. Bars may transition width `.4s ease` after paint.

---

## 7. Copy rules

- Second person, present tense, no exclamation marks.
- Never "position on the ladder", "the gap", "readout" in member-facing text — those are internal words. Say *Work on this today*, *Your best clean*, *Next medal*.
- Numbers always carry their unit (`84 BPM`, `12 min`), and a target always carries its condition (`clean, click on, 30 seconds`).
- Never promise a feature that is off: no Stripe checkout copy, no lesson counts while the library is unpublished.

---

## 8. Data: what exists, what doesn't

**Ships with no schema change** — mast, stage + gap bar, evidence rail, ladder, Analyze strip (minus the "last take" line), footer. Sources: `practicePlan`, `streakState`, `recentPracticeDays`, one new `practice_logs` aggregate.

**Blocked** — "Last take: 2 days ago · 104 BPM held". Analyzer reports live in the container, expire at `JOB_TTL_HOURS` (72), and a job id is not tied to a member (source-of-truth gap 14). Needs a D1 table:

```sql
CREATE TABLE analyses (
  id TEXT PRIMARY KEY,            -- analyzer job id
  person_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  pattern_slug TEXT,
  tempo_held REAL, drift REAL, spread_ms REAL, score REAL,
  coaching TEXT, confidence TEXT  -- none | weak | ok, from analyzer/app/confidence.py
);
CREATE INDEX analyses_person ON analyses (person_id, created_at DESC);
```

Written by the Worker when it proxies `GET /analyze/api/results/:id` (~1 KB a row). Side benefit: it gives a report an owner, which closes "anyone with a job id can open someone else's report". When `confidence` is `weak` or `none`, Home shows timing only and says the video check did not run — never a verdict off a 24 %-match take.

---

## 9. Acceptance checklist

- [ ] No number appears twice on the page.
- [ ] At 390×844, title + gap bar + both buttons are above the fold.
- [ ] Nothing on Home is hidden behind the dock at 390 px or with the iOS home indicator.
- [ ] Evidence rail snaps and scrolls with one thumb; no horizontal scroll on `body`.
- [ ] Page renders complete server-side; no layout shift after paint.
- [ ] Waitlist, zero-session, no-daily-pick and analyzer-offline states all tested.
- [ ] Lighthouse mobile ≥ 95 performance / ≥ 95 accessibility on `/`.
- [ ] `docs/source-of-truth.md`: `mem-home` rewritten, and the stale `mem-board` line (“Same D1 scores on member home”) corrected in the same PR.

---

## 10. Build order

1. Stage rework (label, sticking, gap bar, actions) + remove `.beats`. Pure `html.ts` + `ui.ts`.
2. Evidence rail + the `practice_logs` aggregate in the home route.
3. Ladder strip (reuse `MEDALS`, `nextTargetBpm`, `medalLabel`).
4. Analyze strip + analyzer chip.
5. `analyses` table + Worker write-through → turns on the "last take" line and, later, a real last-analysis card.

Steps 1–4 are one PR against `main`. Step 5 is its own PR with the migration.
