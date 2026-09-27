import { escapeHtml, type Person } from './auth';
import { lockReason, tierLocked } from './access';
import type { Attempt, BoardRow, Challenge } from './challenges';
import {
  ANCHOR_DIAMOND_BPM,
  DISCIPLINES,
  HOLD_SECONDS,
  LEVELS,
  MEDALS,
  PRACTICE_TABS,
  TOP_MEDALS,
  tabForDiscipline,
  medalIndex,
  medalLabel,
  medalTarget,
  type DailyPick,
  type MedalTally,
  type Pattern,
  type PatternWithProgress,
  type SessionRow,
} from './patterns';
import { initials, levelSelect, profileComplete } from './profile';
import type { StreakState } from './streaks';
import { MILESTONES } from './streaks';
import type { Broadcast, Contact, Domain, MetricsTotals, Segment, Suppression, Template, Topic } from './resend';
import { STREAM_DASH } from './stream';
import { shell } from './ui';

export { shell } from './ui';

export function loginPage(base: string, kind: 'member' | 'admin', note = '', error = ''): string {
  return shell({
    title: 'Log in | Stick It Out',
    base,
    kind,
    path: '/login',
    body: `
      <h1 class="display" style="font-size:3rem;line-height:0.9;">Log in</h1>
      <p class="muted" style="margin:0.8rem 0 1.4rem;">We'll send a link. No password.</p>
      ${error ? `<p class="err">${escapeHtml(error)}</p>` : ''}
      ${note ? `<p class="flash">${escapeHtml(note)}</p>` : ''}
      <form class="panel stack" method="post" action="${base}/login">
        <div>
          <label for="email">Email</label>
          <input id="email" name="email" type="email" required autocomplete="email" placeholder="you@email.com" />
        </div>
        <button class="btn" type="submit">Send login link</button>
      </form>
    `,
  });
}

function boardMarkup(rows: BoardRow[], youId = '', empty = 'Nobody scored yet. Mike ranks attempts from 0 to 100.'): string {
  if (!rows.length) return `<p class="empty">${empty}</p>`;
  return `<ol class="board">
    ${rows
      .map(
        (row, i) => `<li class="board-row ${row.person_id === youId ? 'is-you' : ''}">
          <span class="rank">${i + 1}</span>
          <span>${escapeHtml(row.name)}${row.person_id === youId ? ' · you' : ''}</span>
          <span class="score">${row.score}</span>
        </li>`,
      )
      .join('')}
  </ol>`;
}

export function memberHome(
  base: string,
  user: Person,
  data: {
    lessons: MemberLesson[];
    challenge: Challenge | null;
    board: BoardRow[];
    attempt: Attempt | null;
    streak?: StreakState;
    daily?: DailyPick | null;
    medals?: MedalTally[];
    practiceDays?: string[];
  },
): string {
  const waitlist = user.status === 'waitlist';
  const gated = user.status !== 'founding' && user.status !== 'active';
  const first = (user.name || user.email.split('@')[0]).split(' ')[0];
  const currentLesson = data.lessons.find((l) => !l.completed_at) || data.lessons[data.lessons.length - 1] || null;
  const doneCount = data.lessons.filter((l) => l.completed_at).length;
  const streak = data.streak;
  const daily = data.daily || null;
  const dailyDone = Boolean(daily?.completed_at);

  const medalRows = (data.medals || []).filter((m) => m.medal !== 'dirt');
  const medalCount = medalRows.reduce((sum, m) => sum + m.n, 0);
  const practiced = (data.medals || []).reduce((sum, m) => sum + m.n, 0);
  const bestMedal = MEDALS.slice()
    .reverse()
    .find((m) => medalRows.some((row) => row.medal === m.id));

  const heroCta = daily
    ? `<a class="btn hero-cta" href="${base}/rudiments/${escapeHtml(daily.pattern.slug)}">${
        dailyDone ? 'Practice again' : 'Start today'
      }</a>`
    : `<a class="btn hero-cta" href="${base}/rudiments">Open practice</a>`;

  const hero = `<section class="panel hero-card dash-wide rise-in">
    <div class="hero-copy">
      <p class="label">${dailyDone ? 'Logged today' : 'Today'}</p>
      <h1 class="display hero-title">${daily ? escapeHtml(daily.pattern.title) : `Hey ${escapeHtml(first)}.`}</h1>
      ${daily ? stickingMarkup(daily.pattern.sticking) : ''}
      <p class="muted hero-note">${
        waitlist
          ? "You're on the founding waitlist. Free patterns are open, logging unlocks with a spot."
          : daily
            ? `${medalLabel(daily.pattern.medal)} · target ${daily.pattern.bpm_goal} BPM`
            : 'Pick a pattern and put in the work.'
      }</p>
      <div class="hero-actions">
        ${heroCta}
        ${currentLesson && !gated ? `<a class="btn ghost" href="${base}/library/${currentLesson.id}">Week ${currentLesson.week_index} lesson</a>` : ''}
      </div>
    </div>
    ${streak ? streakRing(streak, data.practiceDays || []) : ''}
  </section>`;

  const challengeStat = data.attempt
    ? data.attempt.score == null
      ? 'Pending'
      : String(data.attempt.score)
    : data.challenge
      ? 'Open'
      : '--';

  const tiles = `<div class="tiles dash-wide">
    <a class="stat-tile rise-in" href="${base}/rudiments">
      <span class="stat-label">Medals</span>
      <span class="stat-num">${medalCount}</span>
      <span class="stat-foot muted">${bestMedal ? `Best ${bestMedal.label}` : 'Log a session'}</span>
    </a>
    <a class="stat-tile rise-in" href="${base}/rudiments">
      <span class="stat-label">Patterns</span>
      <span class="stat-num">${practiced}</span>
      <span class="stat-foot muted">practiced</span>
    </a>
    <a class="stat-tile rise-in" href="${base}/library">
      <span class="stat-label">Weeks</span>
      <span class="stat-num">${doneCount}</span>
      <span class="stat-foot muted">of ${data.lessons.length} done</span>
    </a>
    <a class="stat-tile rise-in" href="${base}/challenges">
      <span class="stat-label">Challenge</span>
      <span class="stat-num">${escapeHtml(challengeStat)}</span>
      <span class="stat-foot muted">${data.challenge ? escapeHtml(data.challenge.title) : 'none live'}</span>
    </a>
  </div>`;

  const nextThumb =
    currentLesson?.thumbnail && !gated
      ? `<img src="${escapeHtml(currentLesson.thumbnail)}" alt="" />`
      : `<div class="missing">${gated ? 'Locked' : 'Dark'}</div>`;

  const nextUp = currentLesson
    ? `<section class="panel next-card rise-in">
        <div class="label">${currentLesson.completed_at ? 'Latest lesson' : 'Next up'}</div>
        <a class="next-body" href="${gated ? `${base}/library` : `${base}/library/${currentLesson.id}`}">
          <span class="next-thumb">${nextThumb}</span>
          <span class="next-meta">
            <span class="next-week">Week ${currentLesson.week_index}</span>
            <strong>${escapeHtml(currentLesson.title)}</strong>
            <span class="muted">${
              gated
                ? 'Unlocks with founding'
                : currentLesson.completed_at
                  ? 'Completed'
                  : currentLesson.watched_at
                    ? 'In progress'
                    : 'Ready to watch'
            }</span>
          </span>
        </a>
      </section>`
    : `<section class="panel next-card rise-in">
        <div class="label">Next up</div>
        <p class="empty">New weeks land here when Mike publishes them.</p>
      </section>`;

  const boardPanel = `<section class="panel rise-in">
    <div class="label">Live board</div>
    <h2 style="margin:0.15rem 0 0.5rem;">${data.challenge ? escapeHtml(data.challenge.title) : 'Leaderboard'}</h2>
    ${boardMarkup(data.board, user.id)}
    ${data.challenge ? `<p style="margin:0.8rem 0 0;"><a class="btn ghost" href="${base}/challenges">Open challenge</a></p>` : ''}
  </section>`;

  const quick = `<nav class="quick-row dash-wide" aria-label="Shortcuts">
    <a href="${base}/rudiments">Practice</a>
    <a href="${base}/library">Library</a>
    <a href="${base}/challenges">Challenges</a>
    <a href="${base}/profile">Profile</a>
  </nav>`;

  return shell({
    title: 'Home | Stick It Out',
    base,
    kind: 'member',
    path: '/',
    user,
    wide: true,
    body: `
      <div class="page-tools">
        <p class="greet muted">Hey ${escapeHtml(first)}${
          doneCount ? ` · ${doneCount} week${doneCount === 1 ? '' : 's'} in` : ''
        }</p>
        ${streak ? streakRewards(streak, base) : ''}
      </div>
      <div class="dash-grid">
        ${hero}
        ${tiles}
        ${nextUp}
        ${boardPanel}
        ${quick}
      </div>
    `,
  });
}

/** Seven day ring. Filled arc is the share of the last week with a logged practice. */
function streakRing(streak: StreakState, days: string[]): string {
  const hit = Math.max(0, Math.min(7, new Set(days).size));
  const pct = Math.round((hit / 7) * 100);
  const state = streak.current_days > 0 ? (streak.todayCredited ? 'is-safe' : 'is-open') : 'is-cold';
  const line =
    streak.current_days === 0
      ? 'Start your streak today'
      : streak.todayCredited
        ? 'Today is logged'
        : streak.atRisk
          ? `${streak.hoursLeft}h left to keep it`
          : 'Log anything today to keep it';
  return `<div class="streak-ring ${state}">
    <div class="ring" style="--pct:${pct}%" role="img" aria-label="${hit} of the last 7 days practiced">
      <span class="ring-num">${streak.current_days}</span>
      <span class="ring-unit">day${streak.current_days === 1 ? '' : 's'}</span>
    </div>
    <p class="ring-line">${escapeHtml(line)}</p>
    <p class="ring-best muted">${hit}/7 this week · longest ${streak.longest_days}</p>
  </div>`;
}

function streakRewards(streak: StreakState, base: string): string {
  const progress = streak.current_days > 0 || streak.longest_days > 0 || streak.rewards.earnedDays.length > 0;
  if (!progress) return '';
  const earned = new Set(streak.rewards.earnedDays);
  const nextDays = streak.rewards.next?.days;
  const unseen = streak.rewards.unseen > 0;
  const items = MILESTONES.map((m) => {
    const got = earned.has(m.days);
    const isNext = m.days === nextDays;
    const flag = got ? 'Earned' : isNext ? `${streak.rewards.next?.left ?? m.days} to go` : 'Locked';
    return `<li class="${got ? 'is-earned' : ''}${isNext ? ' is-next' : ''}">
      <img class="reward-mark" src="/img/badges/streak-${escapeHtml(m.title.toLowerCase())}.png" alt="" width="40" height="40" />
      <span class="reward-copy">
        <strong>${escapeHtml(m.title)}</strong>
        <span class="muted">${m.days} days · ${escapeHtml(m.line)}</span>
      </span>
      <span class="reward-flag">${flag}</span>
    </li>`;
  }).join('');
  const head = streak.rewards.latest
    ? `${streak.rewards.latest.title} is yours.`
    : 'Hit a streak and it stays, even if you miss a day.';
  const next = streak.rewards.next
    ? `Next is ${streak.rewards.next.title} at ${streak.rewards.next.days} days.`
    : 'Every reward on the board is earned.';
  return `<div class="reward-slot">
    <button type="button" class="reward-bell${unseen ? ' is-new' : ''}" data-reward-open data-seen="${base}/streak-rewards/seen" aria-label="${
      unseen ? 'New streak rewards' : 'Streak rewards'
    }">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9.2a6 6 0 0 1 12 0c0 4.2 1.2 5.6 1.8 6.4H4.2C4.8 14.8 6 13.4 6 9.2Z"/><path d="M10 18.2a2 2 0 0 0 4 0"/></svg>
      ${unseen ? '<span class="reward-pip" aria-hidden="true"></span>' : ''}
    </button>
    <dialog class="reward-pop" data-reward-pop>
      <div class="reward-head">
        <h2>Streak rewards</h2>
        <button type="button" class="btn ghost" data-reward-close>Close</button>
      </div>
      <p class="muted">${escapeHtml(head)} ${escapeHtml(next)}</p>
      <ol class="reward-list">${items}</ol>
    </dialog>
  </div>
  <script>
    (function () {
      var open = document.querySelector('[data-reward-open]');
      var pop = document.querySelector('[data-reward-pop]');
      if (!open || !pop || !pop.showModal) return;
      function ack() {
        open.classList.remove('is-new');
        var pip = open.querySelector('.reward-pip');
        if (pip) pip.remove();
        fetch(open.getAttribute('data-seen'), { method: 'POST', credentials: 'same-origin' });
      }
      open.addEventListener('click', function () {
        if (!pop.open) pop.showModal();
        ack();
      });
      var close = pop.querySelector('[data-reward-close]');
      if (close) close.addEventListener('click', function () { pop.close(); });
      pop.addEventListener('click', function (e) { if (e.target === pop) pop.close(); });
    })();
  </script>`;
}

export type MemberLesson = {
  id: string;
  title: string;
  week_index: number;
  video_url: string | null;
  stream_uid?: string | null;
  poster_key?: string | null;
  summary?: string;
  watched_at?: string | null;
  completed_at?: string | null;
  thumbnail?: string;
};

export function memberLibrary(base: string, user: Person, lessons: MemberLesson[]): string {
  const gated = user.status !== 'founding' && user.status !== 'active';
  let inner: string;
  if (gated) {
    inner = `<p class="empty">Stream lessons unlock for founding and active members.</p>`;
  } else if (!lessons.length) {
    inner = `<p class="empty">No lesson published yet.</p>`;
  } else {
    inner = `<div class="video-grid">${lessons
      .map((l) => {
        const done = l.completed_at ? 'Completed' : l.watched_at ? 'In progress' : 'Watch';
        const thumb = l.thumbnail
          ? `<img src="${escapeHtml(l.thumbnail)}" alt="" />`
          : `<div class="missing">${l.stream_uid ? 'Stream' : 'Dark'}</div>`;
        return `<a class="video-card" href="${base}/library/${l.id}">
          <div class="thumb">${thumb}<span class="cue-week">Week ${l.week_index}</span></div>
          <div class="meta">
            <h2>${escapeHtml(l.title)}</h2>
            <p class="muted">${escapeHtml(done)}</p>
          </div>
        </a>`;
      })
      .join('')}</div>`;
  }
  return shell({
    title: 'Library | Stick It Out',
    base,
    kind: 'member',
    path: '/library',
    user,
    body: `<h1 class="display" style="font-size:3rem;line-height:0.9;">Library</h1><p class="muted" style="margin:0.45rem 0 1.1rem;">Mike's weekly work. Founding and active members get the signed player.</p>${inner}`,
  });
}

export function memberWatch(
  base: string,
  user: Person,
  lesson: MemberLesson,
  player: { src: string; ready: boolean; error?: string },
  note = '',
): string {
  const gated = user.status !== 'founding' && user.status !== 'active';
  let media: string;
  if (gated) {
    media = `<p class="empty">This video is gated. Founding and active members can watch.</p>`;
  } else if (player.src) {
    media = `<div class="player"><iframe src="${escapeHtml(player.src)}" referrerpolicy="origin" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;" allowfullscreen title="${escapeHtml(lesson.title)}"></iframe></div>
      ${player.ready ? '' : `<p class="muted">Cloudflare Stream is still processing this file. Refresh in a minute.</p>`}`;
  } else if (lesson.video_url) {
    media = `<p><a class="btn" href="${escapeHtml(lesson.video_url)}">Open linked video</a></p>`;
  } else {
    media = `<p class="empty">${escapeHtml(player.error || 'No Stream video on this lesson yet.')}</p>`;
  }
  return shell({
    title: `${lesson.title} | Stick It Out`,
    base,
    kind: 'member',
    path: `/library/${lesson.id}`,
    user,
    body: `
      <p class="crumb"><a href="${base}/library">Library</a> · Week ${lesson.week_index}</p>
      <h1 class="display" style="font-size:3rem;line-height:0.9;margin-top:0.4rem;">${escapeHtml(lesson.title)}</h1>
      ${note ? `<p class="flash">${escapeHtml(note)}</p>` : ''}
      ${lesson.summary ? `<p class="muted" style="margin:0.8rem 0 1.1rem;">${escapeHtml(lesson.summary)}</p>` : ''}
      <div class="stack" style="margin-top:1.1rem;">
        ${media}
        ${
          gated
            ? ''
            : `<form method="post" action="${base}/library/${lesson.id}">
            <input type="hidden" name="action" value="complete" />
            <button class="btn" type="submit">${lesson.completed_at ? 'Completed' : 'Mark complete'}</button>
          </form>
        <form class="panel stack" method="post" action="${base}/library/${lesson.id}">
          <input type="hidden" name="action" value="practice" />
          <h2>Log practice</h2>
          <div><label for="bpm">BPM</label><input id="bpm" name="bpm" type="number" min="20" max="400" step="1" inputmode="numeric" /></div>
          <div><label for="notes">Notes</label><textarea id="notes" name="notes" placeholder="What felt sticky"></textarea></div>
          <button class="btn ghost" type="submit">Save log</button>
        </form>`
        }
      </div>
    `,
  });
}

const FAMILY_LABELS: Record<string, string> = {
  roll: 'Rolls',
  diddle: 'Diddles',
  flam: 'Flams',
  drag: 'Drags',
  hybrid: 'Hybrids',
};

/** Profile badge case: a closed drawer with the summary, sliding open to every medal by rudiment and tier. */
function badgeDrawer(medals: MedalTally[], streak: StreakState, patterns: PatternWithProgress[]): string {
  const tiers = MEDALS.filter((m) => m.at > 0);
  const tally = new Map(medals.map((row) => [row.medal, row.n]));
  const reached = (id: string) =>
    patterns.length
      ? patterns.filter((p) => medalIndex(p.medal) >= medalIndex(id)).length
      : MEDALS.filter((m) => medalIndex(m.id) >= medalIndex(id)).reduce((sum, m) => sum + (tally.get(m.id) || 0), 0);
  const medaled = patterns.filter((p) => medalIndex(p.medal) > 0);
  const medalCount = patterns.length
    ? medaled.reduce((sum, p) => sum + medalIndex(p.medal), 0)
    : medals.reduce((sum, row) => sum + medalIndex(row.medal) * row.n, 0);
  const top = tiers.slice().reverse().find((m) => reached(m.id) > 0) || null;
  const earnedDays = new Set(streak.rewards.earnedDays);
  const streakEarned = MILESTONES.filter((m) => earnedDays.has(m.days)).length;

  const tierItems = tiers
    .map((m) => {
      const n = reached(m.id);
      const hot = n > 0 && TOP_MEDALS.has(m.id);
      return `<li class="${n ? 'is-earned' : 'is-locked'}${hot ? ' is-hot' : ''}">
        <img src="/img/badges/medal-${m.id}.png" alt="" width="52" height="52" loading="lazy" />
        <strong>${escapeHtml(m.label)}</strong>
        <span class="muted">${n} earned</span>
      </li>`;
    })
    .join('');

  const row = (p: PatternWithProgress) => {
    const goal = p.bpm_goal || 120;
    const best = Math.round(p.best_bpm || 0);
    const strip = tiers
      .map((m) => {
        const got = medalIndex(p.medal) >= medalIndex(m.id);
        const hot = got && TOP_MEDALS.has(m.id);
        return `<li class="${got ? 'is-earned' : 'is-locked'}${hot ? ' is-hot' : ''}" title="${escapeHtml(m.label)} ${medalTarget(goal, m.id)} BPM">
          <img src="/img/badges/medal-${m.id}.png" alt="${escapeHtml(m.label)} ${got ? 'earned' : 'locked'}" width="24" height="24" loading="lazy" />
        </li>`;
      })
      .join('');
    return `<li class="case-row${best ? '' : ' is-idle'}">
      <div class="case-name">
        <strong>${escapeHtml(p.title)}</strong>
        <span class="muted">${best ? `Best ${best}` : 'Not started'} &middot; Diamond ${goal}</span>
      </div>
      <ol class="case-strip" aria-label="${escapeHtml(p.title)} medals">${strip}</ol>
    </li>`;
  };

  const hands = patterns.filter((p) => p.discipline === 'hands');
  const families = Object.keys(FAMILY_LABELS).concat(
    [...new Set(hands.map((p) => p.family))].filter((f) => !(f in FAMILY_LABELS)),
  );
  const groups = families
    .map((f) => ({ label: FAMILY_LABELS[f] || f, items: hands.filter((p) => p.family === f) }))
    .concat([{ label: 'Hand fill drills', items: patterns.filter((p) => p.discipline === 'four-limb') }])
    .filter((g) => g.items.length)
    .map(
      (g) => `<div class="case-group">
        <h4>${escapeHtml(g.label)}</h4>
        <ol class="case-rows">${g.items.map(row).join('')}</ol>
      </div>`,
    )
    .join('');

  const streakItems = MILESTONES.map((m) => {
    const got = earnedDays.has(m.days);
    const slug = m.title.toLowerCase();
    const hot = got && slug === 'year';
    return `<li class="${got ? 'is-earned' : 'is-locked'}${hot ? ' is-hot' : ''}">
      <img src="/img/badges/streak-${slug}.png" alt="" width="72" height="72" loading="lazy" />
      <strong>${escapeHtml(m.title)}</strong>
      <span class="muted">${m.days} days</span>
    </li>`;
  }).join('');

  return `<section class="badge-drawer" data-drawer>
    <button type="button" class="drawer-face" data-drawer-toggle aria-expanded="false" aria-controls="badge-tray">
      <img class="drawer-mark${top && TOP_MEDALS.has(top.id) ? ' is-hot' : ''}" src="/img/badges/medal-${top ? top.id : 'dirt'}.png" alt="" width="56" height="56" />
      <span class="drawer-summary">
        <span class="label">Badge case</span>
        <strong class="drawer-count">${medalCount} ${medalCount === 1 ? 'medal' : 'medals'}</strong>
        <span class="muted">${top ? `Top tier ${escapeHtml(top.label)}` : 'No medals yet'} &middot; ${medaled.length} of ${patterns.length} patterns &middot; ${streakEarned} streak ${streakEarned === 1 ? 'badge' : 'badges'}</span>
      </span>
      <span class="drawer-cta" data-drawer-cta>Open</span>
      <span class="drawer-pull" aria-hidden="true"></span>
    </button>
    <div class="drawer-tray" id="badge-tray">
      <div class="drawer-inner">
        <div class="drawer-bed">
          <h3>By tier</h3>
          <ol class="case-tiers">${tierItems}</ol>
          <p class="muted case-rule">Each medal needs a clean run of ${HOLD_SECONDS} seconds or more at its tempo. Singles set the bar: Diamond ${ANCHOR_DIAMOND_BPM}, Legendary 200, Insanity 220.</p>
          <h3>By rudiment</h3>
          ${groups || '<p class="empty">No patterns yet.</p>'}
          <h3>Streak</h3>
          <ol class="badge-grid">${streakItems}</ol>
        </div>
      </div>
    </div>
  </section>`;
}

function drawerScript(): string {
  return `<noscript><style>.drawer-tray{grid-template-rows:1fr}.drawer-inner{visibility:visible}.drawer-cta{display:none}</style></noscript>
<script>
(function () {
  var drawer = document.querySelector('[data-drawer]');
  if (!drawer) return;
  var toggle = drawer.querySelector('[data-drawer-toggle]');
  var cta = drawer.querySelector('[data-drawer-cta]');
  function setOpen(open) {
    drawer.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (cta) cta.textContent = open ? 'Close' : 'Open';
  }
  toggle.addEventListener('click', function () { setOpen(!drawer.classList.contains('is-open')); });
  if (location.hash === '#badges') setOpen(true);
})();
</script>`;
}

export function memberProfile(
  base: string,
  user: Person,
  stripePortal: string,
  opts: {
    setup?: boolean;
    note?: string;
    error?: string;
    streak?: StreakState;
    medals?: MedalTally[];
    patterns?: PatternWithProgress[];
  } = {},
): string {
  const plan = user.plan ? `${user.plan}` : 'none yet';
  const setup = Boolean(opts.setup) && !profileComplete(user);
  const drawer = !setup && opts.streak ? badgeDrawer(opts.medals || [], opts.streak, opts.patterns || []) : '';
  return shell({
    title: setup ? 'Set up your kit | Stick It Out' : 'Profile | Stick It Out',
    base,
    kind: 'member',
    path: '/profile',
    user,
    scripts: drawer ? drawerScript() : undefined,
    body: `
      <div class="row" style="align-items:center;margin-bottom:1rem;">
        <div class="hero-mark" aria-hidden="true">${escapeHtml(initials(user))}</div>
        <div>
          <h1 class="display" style="font-size:3rem;line-height:0.9;">${setup ? 'Before you sit down' : 'Profile'}</h1>
          <p class="muted" style="margin:0.35rem 0 0;">${setup ? 'Name, kit, and playing level. Phone is optional.' : escapeHtml(user.email)}</p>
        </div>
        ${opts.streak ? streakRewards(opts.streak, base) : ''}
      </div>
      ${drawer}
      ${opts.error ? `<p class="err">${escapeHtml(opts.error)}</p>` : ''}
      ${opts.note ? `<p class="flash">${escapeHtml(opts.note)}</p>` : ''}
      <form class="panel stack" method="post" action="${base}/profile">
        <div><label for="name">Display name</label><input id="name" name="name" required autocomplete="name" value="${escapeHtml(user.name || '')}" /></div>
        <div><label for="kit">Kit setup</label><textarea id="kit" name="kit" required placeholder="4-piece, hats, two crashes">${escapeHtml(user.kit || '')}</textarea></div>
        <div><label for="level">Playing level</label>${levelSelect('level', user.level || '')}</div>
        <div><label for="phone">Phone (optional)</label><input id="phone" name="phone" autocomplete="tel" value="${escapeHtml(user.phone || '')}" /></div>
        <button class="btn" type="submit">${setup ? 'Save and enter' : 'Save profile'}</button>
      </form>
      <section class="panel stack" style="margin-top:1rem;">
        <h2>Membership</h2>
        <p><span class="pill ${escapeHtml(user.status)}">${escapeHtml(user.status)}</span> · ${escapeHtml(plan)}</p>
        <p class="muted">Email is your login. ${escapeHtml(user.email)}</p>
        ${
          stripePortal
            ? `<p><a class="btn" href="${escapeHtml(stripePortal)}">Manage billing</a></p>`
            : `<p class="muted">Billing portal coming soon. Founding stays $19.99/mo or $149/yr.</p>`
        }
      </section>
    `,
  });
}

export function memberChallenges(
  base: string,
  user: Person,
  data: {
    challenge: Challenge | null;
    board: BoardRow[];
    attempt: Attempt | null;
    note?: string;
    error?: string;
  },
): string {
  const waitlist = user.status === 'waitlist';
  const canSubmit = user.status === 'founding' || user.status === 'active';
  const challenge = data.challenge;
  const form = !challenge
    ? `<p class="empty">No challenge published yet.</p>`
    : waitlist
      ? `<p class="empty">Founding and active members can submit. You can still watch the board.</p>`
      : !canSubmit
        ? `<p class="empty">Submissions are for founding and active members.</p>`
        : `<form class="panel stack" method="post" action="${base}/challenges">
            <input type="hidden" name="challenge_id" value="${escapeHtml(challenge.id)}" />
            <h2>${data.attempt ? 'Update your attempt' : 'Submit an attempt'}</h2>
            <p class="muted">Mike scores 0 to 100. Updating notes puts you back in the pending pile.</p>
            <div><label for="notes">How you played it</label><textarea id="notes" name="notes" required placeholder="Tempo, sticking, what clicked">${escapeHtml(data.attempt?.notes || '')}</textarea></div>
            <button class="btn" type="submit">${data.attempt ? 'Update attempt' : 'Send to Mike'}</button>
          </form>`;
  return shell({
    title: 'Challenges | Stick It Out',
    base,
    kind: 'member',
    path: '/challenges',
    user,
    body: `
      <h1 class="display" style="font-size:3rem;line-height:0.9;">Challenges</h1>
      <p class="muted" style="margin:0.45rem 0 1.1rem;">One live challenge. Same board on this page, home, and admin.</p>
      ${data.error ? `<p class="err">${escapeHtml(data.error)}</p>` : ''}
      ${data.note ? `<p class="flash">${escapeHtml(data.note)}</p>` : ''}
      ${
        challenge
          ? `<section class="panel stack">
              <div class="label">Live now</div>
              <h2>${escapeHtml(challenge.title)}</h2>
              <p style="white-space:pre-wrap;margin:0;">${escapeHtml(challenge.prompt || '')}</p>
              ${
                data.attempt
                  ? `<p class="flash">${data.attempt.score == null ? 'Awaiting Mike\'s score.' : `Your score: ${data.attempt.score}`}</p>`
                  : ''
              }
            </section>`
          : ''
      }
      ${form}
      <section class="panel" style="margin-top:1rem;">
        <div class="label">Leaderboard</div>
        <h2 style="margin-bottom:0.4rem;">${challenge ? escapeHtml(challenge.title) : 'Board'}</h2>
        ${boardMarkup(data.board, user.id)}
      </section>
    `,
  });
}

const LIMB_LEGEND = `<p class="legend-limbs"><span><b>R</b> right hand</span><span><b>L</b> left hand</span><span><b>K</b> kick</span><span><b>H</b> hi-hat foot</span></p>`;

function medalChip(medal: string, locked = false): string {
  const id = escapeHtml(medal);
  const label = escapeHtml(medalLabel(medal));
  return `<span class="medal medal-${id}${locked ? ' is-locked' : ''}"><img src="/img/badges/medal-${id}.png" alt="" width="28" height="28" />${label}</span>`;
}

function stickingMarkup(sticking: string, limit = 0): string {
  const parts = sticking.split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const shown = limit > 0 ? parts.slice(0, limit) : parts;
  const extra = limit > 0 && parts.length > limit ? `<span class="stick">+${parts.length - limit}</span>` : '';
  return `<p class="sticking">${shown
    .map((token) => {
      const limb = token.replace(/[^A-Za-z]/g, '').slice(-1).toUpperCase();
      const grace = /^[a-z]{1,2}[A-Z]/.test(token);
      return `<span class="stick limb-${escapeHtml(limb)}${grace ? ' is-grace' : ''}">${escapeHtml(token)}</span>`;
    })
    .join('')}${extra}</p>`;
}

export function memberRudiments(
  base: string,
  user: Person,
  data: {
    patterns: PatternWithProgress[];
    tab: 'rudiments' | 'drills';
    daily: DailyPick | null;
    streak: StreakState;
    practiceDays: string[];
    note?: string;
  },
): string {
  const tab = data.tab === 'drills' ? 'drills' : 'rudiments';
  const tabNav = `<nav class="practice-switch" aria-label="Practice">
    ${PRACTICE_TABS.map(
      (item) =>
        `<a class="${tab === item.id ? 'is-on' : ''}" href="${base}/rudiments?tab=${item.id}"${
          tab === item.id ? ' aria-current="page"' : ''
        }>${item.label}</a>`,
    ).join('')}
  </nav>`;

  const card = (p: PatternWithProgress, hot = false) => {
    const locked = tierLocked(user, p.tier);
    const goal = p.bpm_goal || 120;
    const best = Math.round(p.best_bpm || 0);
    const pct = Math.min(100, Math.round((best / goal) * 100));
    const heat = Math.max(best > 0 ? 0.12 : 0, pct / 100);
    return `<li>
      <a class="practice-card${locked ? ' is-locked' : ''}${hot ? ' is-hot' : ''}" href="${base}/rudiments/${escapeHtml(p.slug)}" style="--heat:${heat}">
        <span class="practice-top">
          <span class="practice-name">${escapeHtml(p.title)}</span>
          ${medalChip(p.medal, locked)}
        </span>
        ${stickingMarkup(p.sticking, 8)}
        <span class="practice-foot">
          <span class="practice-bpm">${
            locked ? escapeHtml(lockReason(user, p.tier)) : `${best}<span> / ${goal}</span>`
          }</span>
          <span class="meter" role="img" aria-label="${pct} percent of goal tempo"><i style="width:${pct}%"></i></span>
        </span>
      </a>
    </li>`;
  };

  const going = data.patterns.filter((p) => (p.best_bpm || 0) > 0 || p.sessions > 0);
  const goingBlock = going.length
    ? `<section class="practice-group">
        <h2 class="practice-head">Keep going <span>${going.length}</span></h2>
        <ul class="practice-list">${going.map((p) => card(p, true)).join('')}</ul>
      </section>`
    : '';

  const sections = LEVELS.map((level) => ({ id: level, label: level }));
  const groups = sections
    .map((section) => {
      const rows = data.patterns.filter(
        (p) => p.level === section.id && !((p.best_bpm || 0) > 0 || p.sessions > 0),
      );
      if (!rows.length) return '';
      return `<section class="practice-group">
      <h2 class="practice-head">${section.label} <span>${rows.length}</span></h2>
      <ul class="practice-list">${rows.map((p) => card(p)).join('')}</ul>
    </section>`;
    })
    .join('');

  const daily = data.daily;
  const hero = `<section class="panel hero-card daily-card">
    <div class="hero-copy">
      <p class="label">${daily ? (daily.completed_at ? 'Logged today' : 'Today') : 'Practice'}</p>
      <h1 class="display hero-title">${daily ? escapeHtml(daily.pattern.title) : 'Pick a pattern.'}</h1>
      ${daily ? stickingMarkup(daily.pattern.sticking) : '<p class="muted hero-note">Open one, run the click, log the tempo you held.</p>'}
      <div class="hero-actions">
        ${daily ? medalChip(daily.pattern.medal) : ''}
        ${
          daily
            ? `<a class="btn hero-cta" href="${base}/rudiments/${escapeHtml(daily.pattern.slug)}">${
                daily.completed_at ? 'Practice again' : 'Start'
              }</a>`
            : ''
        }
        ${daily?.completed_at ? '<span class="gel">Done</span>' : ''}
      </div>
    </div>
    ${streakRing(data.streak, data.practiceDays)}
  </section>`;

  return shell({
    title: 'Practice | Stick It Out',
    base,
    kind: 'member',
    path: '/rudiments',
    user,
    wide: true,
    body: `
      ${data.note ? `<p class="flash">${escapeHtml(data.note)}</p>` : ''}
      <div class="page-tools">${streakRewards(data.streak, base)}</div>
      ${hero}
      ${tabNav}
      ${goingBlock}
      ${groups || '<p class="empty">Nothing in this tab yet.</p>'}
    `,
  });
}

export function memberRudimentDetail(
  base: string,
  user: Person,
  data: {
    pattern: PatternWithProgress;
    sessions: SessionRow[];
    startBpm: number;
    nextTarget: number;
    locked: boolean;
    canLog: boolean;
    streak: StreakState;
    note?: string;
  },
): string {
  const p = data.pattern;
  const goal = p.bpm_goal || 120;
  const pct = Math.min(100, Math.round(((p.best_bpm || 0) / goal) * 100));
  const metroMax = Math.max(goal + 20, medalTarget(goal, 'insanity') + 10);
  const ladder = MEDALS.map((m) => {
      const earned = medalIndex(p.medal) >= medalIndex(m.id);
      const target = medalTarget(goal, m.id) || p.bpm_start;
      const next = medalIndex(m.id) === medalIndex(p.medal) + 1;
      return `<li class="${earned ? 'is-earned' : ''}${next ? ' is-next' : ''}">
        ${medalChip(m.id, !earned)}
        <span class="muted">${next ? 'next · ' : ''}${m.id === 'dirt' ? 'start' : `${target} BPM`}</span>
      </li>`;
    })
    .join('');

  const sessions = data.sessions.length
    ? `<ul>${data.sessions
        .map(
          (s) => `<li class="list-link">
            <span>${s.bpm ? `${Math.round(s.bpm)} BPM` : 'no tempo'}${s.clean ? ' · clean' : ''}${
              s.seconds ? ` · ${Math.round(s.seconds / 60)} min` : ''
            }</span>
            <span class="muted">${escapeHtml((s.at || '').replace('T', ' ').slice(0, 16))}</span>
          </li>`,
        )
        .join('')}</ul>`
    : '<p class="empty">No sessions logged yet.</p>';

  const metronome = data.locked
    ? `<section class="panel"><p class="empty">${escapeHtml(lockReason(user, p.tier) || 'Locked')}</p></section>`
    : `<section class="panel stack metro" data-metro
         data-start="${data.startBpm}"
         data-min="${p.bpm_start}"
         data-max="${metroMax}">
        <div class="metro-read">
          <span class="metro-bpm" data-metro-read>${data.startBpm}</span>
          <span class="metro-unit">BPM</span>
          <span class="metro-dot" data-metro-dot aria-hidden="true"></span>
        </div>
        <p class="muted metro-hint">Opens at your ${escapeHtml(medalLabel(p.medal))} tempo. Next medal at ${data.nextTarget}.</p>
        <input type="range" data-metro-range min="${p.bpm_start}" max="${metroMax}" step="1" value="${data.startBpm}" aria-label="Tempo" />
        <div class="metro-controls">
          <button type="button" class="btn ghost" data-metro-down aria-label="Slower by 5">−5</button>
          <button type="button" class="btn metro-play" data-metro-toggle aria-pressed="false">Start</button>
          <button type="button" class="btn ghost" data-metro-up aria-label="Faster by 5">+5</button>
        </div>
        <div class="metro-side">
          <div class="label" id="click-label">Click</div>
          <button type="button" class="btn ghost" data-metro-tap>Tap tempo</button>
        </div>
        <div class="sub-switch" role="group" aria-labelledby="click-label">
          <button type="button" data-metro-sub data-value="1" class="is-on" aria-pressed="true">1/4</button>
          <button type="button" data-metro-sub data-value="2" aria-pressed="false">1/8</button>
          <button type="button" data-metro-sub data-value="3" aria-pressed="false">Trip</button>
          <button type="button" data-metro-sub data-value="4" aria-pressed="false">1/16</button>
        </div>
        <p class="metro-timer" data-metro-timer>0:00</p>
      </section>`;

  const logForm = !data.canLog
    ? `<section class="panel"><p class="empty">${escapeHtml(
        user.status === 'waitlist' ? 'Founding and active members log sessions and earn medals.' : 'Membership required to log sessions.',
      )}</p></section>`
    : `<form class="panel stack log-card" method="post" action="${base}/rudiments/${escapeHtml(p.slug)}" data-log-form>
        <input type="hidden" name="action" value="session" />
        <input type="hidden" name="seconds" value="0" data-log-seconds />
        <div>
          <h2>Save what you held</h2>
          <p class="muted" style="margin:0.3rem 0 0;">The number follows the click. Change it if you backed off.</p>
        </div>
        <div><label for="bpm">Tempo</label><input id="bpm" name="bpm" type="number" min="${p.bpm_start}" max="400" step="1" inputmode="numeric" value="${data.startBpm}" data-log-bpm required /></div>
        <label class="check"><input type="checkbox" name="clean" value="1" checked /> <span>Clean at this tempo for ${HOLD_SECONDS} seconds or more. That is what moves the medal.</span></label>
        <button class="btn" type="submit">Save session</button>
      </form>`;

  return shell({
    title: `${p.title} | Stick It Out`,
    base,
    kind: 'member',
    path: '/rudiments',
    user,
    wide: true,
    body: `
      <p class="crumb"><a href="${base}/rudiments?tab=${tabForDiscipline(p.discipline)}">${
        tabForDiscipline(p.discipline) === 'drills' ? 'Hand fill drills' : 'Rudiments'
      }</a> · ${escapeHtml(p.level)}</p>
      <h1 class="display pattern-title">${escapeHtml(p.title)}</h1>
      <div class="pattern-stats">
        <div class="pattern-stat">
          <span class="label">Medal</span>
          ${medalChip(p.medal)}
        </div>
        <div class="pattern-stat">
          <span class="label">Best</span>
          <strong>${Math.round(p.best_bpm || 0)}<span>/${goal}</span></strong>
        </div>
        <div class="pattern-stat">
          <span class="label">Sessions</span>
          <strong>${p.sessions}</strong>
        </div>
      </div>
      ${data.note ? `<p class="flash">${escapeHtml(data.note)}</p>` : ''}
      <div class="room">
        <div class="stack">
          <section class="panel stack sheet">
            <div class="label">Pattern</div>
            <div class="staff-stage">
              <div class="staff" data-staff
                data-notes="${escapeHtml(p.vex_notes || '')}"
                data-feet="${escapeHtml(p.vex_feet || '')}"></div>
            </div>
            ${stickingMarkup(p.sticking)}
            ${p.discipline === 'hands' ? '' : LIMB_LEGEND}
            ${p.notes ? `<p class="muted" style="margin:0;">${escapeHtml(p.notes)}</p>` : ''}
          </section>
          ${metronome}
          ${logForm}
        </div>
        <aside class="stack">
          <section class="panel stack">
            <div class="label">Medals</div>
            <span class="meter" role="img" aria-label="${pct} percent of goal tempo"><i style="width:${pct}%"></i></span>
            <ol class="medal-ladder">${ladder}</ol>
            <p class="muted" style="margin:0;">Each medal needs a clean run of ${HOLD_SECONDS} seconds or more at its tempo. Keep the click running while you hold it.</p>
          </section>
          <section class="panel">
            <div class="label">Recent sessions</div>
            ${sessions}
          </section>
        </aside>
      </div>
    `,
    scripts: patternScripts(),
  });
}

/** Metronome and notation. Sticking text is already in the HTML as the fallback. */
function patternScripts(): string {
  return `<script src="https://cdn.jsdelivr.net/npm/vexflow@4.2.3/build/cjs/vexflow.js" defer></script>
<script>
(function () {
  var staff = document.querySelector('[data-staff]');
  function paintStaff(root) {
    var nodes = root.querySelectorAll('path, rect, line, circle, ellipse, polygon');
    nodes.forEach(function (el) {
      var fill = el.getAttribute('fill');
      var stroke = el.getAttribute('stroke');
      if (fill && fill !== 'none' && fill !== 'transparent') el.setAttribute('fill', '#F2EBE3');
      if (stroke && stroke !== 'none' && stroke !== 'transparent') el.setAttribute('stroke', '#F2EBE3');
    });
    root.querySelectorAll('text').forEach(function (el) { el.setAttribute('fill', '#F2EBE3'); });
  }
  function drawDrum(spec, VF, host) {
    var time = '4/4';
    var body = spec.trim();
    var cut = body.indexOf('||');
    var hands = cut === -1 ? body : body.slice(0, cut).trim();
    var feetLine = cut === -1 ? '' : body.slice(cut + 2).trim();
    var timed = hands.match(/^(\\d+\\/\\d+)\\s+([\\s\\S]+)$/);
    if (timed) { time = timed[1]; hands = timed[2]; }
    function expand(tok) {
      var star = tok.lastIndexOf('*');
      if (star === -1) return [tok];
      var n = parseInt(tok.slice(star + 1), 10) || 1;
      var base = tok.slice(0, star);
      var out = [];
      for (var i = 0; i < n; i++) out.push(base);
      return out;
    }
    function tokenNote(tok, stemHint) {
      var accent = false, grace = 0, buzz = 0;
      while (tok && /[\\^fdzc]/.test(tok.charAt(0))) {
        var ch = tok.charAt(0);
        if (ch === '^') accent = true;
        else if (ch === 'f') grace = 1;
        else if (ch === 'd' || ch === 'c') grace = 2;
        else if (ch === 'z') buzz = 3;
        tok = tok.slice(1);
      }
      var rest = tok.charAt(0) === 'r';
      var key = 'c/5';
      var stem = stemHint || 1;
      var dur = '4';
      if (rest) {
        dur = (tok.slice(1) || '4') + 'r';
        key = 'b/4';
        stem = stemHint || 1;
      } else {
        var inst = tok.slice(0, 2);
        dur = tok.slice(2) || '4';
        if (inst === 'bd') { key = 'f/4'; stem = -1; }
        else if (inst === 'ph') { key = 'd/4/x2'; stem = -1; }
        else { key = 'c/5'; stem = 1; }
      }
      var note = new VF.StaveNote({ keys: [key], duration: dur, stem_direction: stem, clef: 'percussion' });
      if (grace && !rest) {
        var gs = [];
        for (var g = 0; g < grace; g++) {
          gs.push(new VF.GraceNote({ keys: ['c/5'], duration: '8', slash: grace === 1, stem_direction: 1 }));
        }
        var group = new VF.GraceNoteGroup(gs, false);
        if (group.beamNotes) group.beamNotes();
        note.addModifier(group, 0);
      }
      if (accent && VF.Articulation) note.addModifier(new VF.Articulation('a>'), 0);
      if (buzz && VF.Tremolo) note.addModifier(new VF.Tremolo(buzz), 0);
      return note;
    }
    function chunks(line) {
      line = line.split('[').join(' [ ').split(']').join(' ] ').split('(').join(' ( ').split(')').join(' ) ');
      var raw = line.trim().split(/\\s+/);
      var list = [];
      var i = 0;
      while (i < raw.length) {
        var tok = raw[i];
        var kind = tok.charAt(0);
        if (kind === '[' || kind === '(') {
          i++;
          var end = kind === '[' ? ']' : ')';
          var inner = [];
          while (i < raw.length && raw[i].charAt(0) !== end) {
            inner = inner.concat(expand(raw[i]));
            i++;
          }
          var closer = raw[i] || end;
          if (i < raw.length) i++;
          var repeat = 1;
          var hit = closer.match(/\\*(\\d+)/);
          if (hit) repeat = parseInt(hit[1], 10);
          if (raw[i] && /^\\*\\d+$/.test(raw[i])) { repeat = parseInt(raw[i].slice(1), 10); i++; }
          for (var r = 0; r < repeat; r++) list.push({ tokens: inner.slice(), tuplet: kind === '(' });
        } else {
          var bits = expand(tok);
          for (var b = 0; b < bits.length; b++) list.push({ tokens: [bits[b]], tuplet: false });
          i++;
        }
      }
      return list;
    }
    function buildVoice(line, stemHint) {
      var notes = [];
      var tuplets = [];
      chunks(line).forEach(function (chunk) {
        var group = [];
        chunk.tokens.forEach(function (tok) {
          var note = tokenNote(tok, stemHint);
          group.push(note);
          notes.push(note);
        });
        if (chunk.tuplet && group.length > 1 && VF.Tuplet) {
          if (group.length === 6) tuplets.push(new VF.Tuplet(group, { num_notes: 6, notes_occupied: 4 }));
          else tuplets.push(new VF.Tuplet(group));
        }
      });
      return { notes: notes, tuplets: tuplets };
    }
    var upper = buildVoice(hands, 1);
    var lower = feetLine ? buildVoice(feetLine, -1) : null;
    var count = upper.notes.length + (lower ? lower.notes.length : 0);
    var width = Math.min(980, Math.max(360, count * 28 + 88));
    var height = lower ? 210 : 168;
    var factory = new VF.Factory({ renderer: { elementId: host, width: width, height: height } });
    var ink = factory.getContext();
    ink.setFillStyle('#F2EBE3');
    ink.setStrokeStyle('#F2EBE3');
    function toVoice(pack) {
      var voice = factory.Voice({ time: time });
      if (voice.setStrict) voice.setStrict(false);
      voice.addTickables(pack.notes);
      return voice;
    }
    var voices = [toVoice(upper)];
    if (lower && lower.notes.length) voices.push(toVoice(lower));
    var system = factory.System({ width: width - 16 });
    var stave = system.addStave({ voices: voices }).addClef('percussion');
    if (stave.setTimeSignature) stave.setTimeSignature(time);
    var beams = [];
    function addBeams(pack) {
      try {
        if (VF.Beam && VF.Beam.generateBeams) beams = beams.concat(VF.Beam.generateBeams(pack.notes));
      } catch (beamErr) { /* figures with rests still draw */ }
    }
    addBeams(upper);
    if (lower) addBeams(lower);
    factory.draw();
    beams.forEach(function (beam) { beam.setContext(ink).draw(); });
    upper.tuplets.concat(lower ? lower.tuplets : []).forEach(function (tuplet) {
      tuplet.setContext(ink).draw();
    });
    paintStaff(host);
  }
  function drawStaff() {
    if (!staff || !window.Vex) return;
    var notes = (staff.dataset.notes || '').trim();
    var feet = (staff.dataset.feet || '').trim();
    if (!notes && !feet) return;
    try {
      var VF = window.Vex.Flow;
      if (notes.indexOf('drum:') === 0) {
        drawDrum(notes.slice(5), VF, staff);
        return;
      }
      var factory = new VF.Factory({ renderer: { elementId: staff, width: Math.max(staff.clientWidth || 320, 320), height: feet ? 180 : 140 } });
      var score = factory.EasyScore();
      var voices = [];
      var beams = [];
      function addVoice(line, stem) {
        var list = score.notes(line, { stem: stem, clef: 'percussion' });
        var voice = score.voice(list, { time: '4/4' });
        if (voice.setStrict) voice.setStrict(false);
        voices.push(voice);
        try {
          if (VF.Beam && VF.Beam.generateBeams) beams = beams.concat(VF.Beam.generateBeams(list));
        } catch (beamErr) {
          beams = [];
        }
      }
      if (notes) addVoice(notes, 'up');
      if (feet) addVoice(feet, 'down');
      if (!voices.length) return;
      var width = Math.max((staff.clientWidth || 320) - 16, 280);
      var system = factory.System({ width: width });
      system.addStave({ voices: voices }).addClef('percussion');
      var ink = factory.getContext && factory.getContext();
      if (ink) {
        if (ink.setFillStyle) ink.setFillStyle('#F2EBE3');
        if (ink.setStrokeStyle) ink.setStrokeStyle('#F2EBE3');
      }
      factory.draw();
      beams.forEach(function (beam) { beam.setContext(factory.getContext()).draw(); });
      paintStaff(staff);
    } catch (err) {
      staff.setAttribute('hidden', 'hidden');
    }
  }
  if (staff) {
    window.addEventListener('load', drawStaff);
  }

  var panel = document.querySelector('[data-metro]');
  if (!panel) return;
  var read = panel.querySelector('[data-metro-read]');
  var dot = panel.querySelector('[data-metro-dot]');
  var range = panel.querySelector('[data-metro-range]');
  var toggle = panel.querySelector('[data-metro-toggle]');
  var up = panel.querySelector('[data-metro-up]');
  var down = panel.querySelector('[data-metro-down]');
  var tap = panel.querySelector('[data-metro-tap]');
  var subBtns = panel.querySelectorAll('[data-metro-sub]');
  var timerEl = panel.querySelector('[data-metro-timer]');
  var bpmInput = document.querySelector('[data-log-bpm]');
  var secondsInput = document.querySelector('[data-log-seconds]');

  var min = Number(panel.dataset.min) || 40;
  var max = Number(panel.dataset.max) || 200;
  var bpm = Number(panel.dataset.start) || 80;
  var sub = 1;
  var ctx = null;
  var running = false;
  var nextTick = 0;
  var beat = 0;
  var timer = null;
  var startedAt = 0;
  var elapsed = 0;
  var taps = [];

  function clamp(v) { return Math.max(min, Math.min(max, Math.round(v))); }

  function setBpm(v) {
    bpm = clamp(v);
    if (read) read.textContent = String(bpm);
    if (range) range.value = String(bpm);
    if (bpmInput) bpmInput.value = String(bpm);
  }

  function schedule() {
    if (!ctx) return;
    while (nextTick < ctx.currentTime + 0.12) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      var accent = beat % sub === 0;
      osc.frequency.value = accent ? 1600 : 1100;
      gain.gain.setValueAtTime(accent ? 0.5 : 0.25, nextTick);
      gain.gain.exponentialRampToValueAtTime(0.0001, nextTick + 0.045);
      osc.connect(gain).connect(ctx.destination);
      osc.start(nextTick);
      osc.stop(nextTick + 0.05);
      if (accent && dot) {
        window.setTimeout(function () { dot.classList.add('is-hit'); window.setTimeout(function () { dot.classList.remove('is-hit'); }, 90); }, Math.max(0, (nextTick - ctx.currentTime) * 1000));
      }
      nextTick += 60 / bpm / sub;
      beat += 1;
    }
  }

  function tick() {
    schedule();
    if (timerEl) {
      var total = elapsed + (running ? (Date.now() - startedAt) / 1000 : 0);
      var m = Math.floor(total / 60);
      var s = Math.floor(total % 60);
      timerEl.textContent = 'Session ' + m + ':' + (s < 10 ? '0' : '') + s;
      if (secondsInput) secondsInput.value = String(Math.round(total));
    }
  }

  function start() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    running = true;
    beat = 0;
    nextTick = ctx.currentTime + 0.1;
    startedAt = Date.now();
    timer = window.setInterval(tick, 25);
    if (toggle) {
      toggle.textContent = 'Stop';
      toggle.setAttribute('aria-pressed', 'true');
    }
    panel.classList.add('is-running');
  }

  function stop() {
    running = false;
    if (timer) window.clearInterval(timer);
    timer = null;
    elapsed += (Date.now() - startedAt) / 1000;
    if (toggle) {
      toggle.textContent = 'Start';
      toggle.setAttribute('aria-pressed', 'false');
    }
    panel.classList.remove('is-running');
    tick();
  }

  if (toggle) toggle.addEventListener('click', function () { running ? stop() : start(); });
  if (range) range.addEventListener('input', function () { setBpm(Number(range.value)); });
  if (up) up.addEventListener('click', function () { setBpm(bpm + 5); });
  if (down) down.addEventListener('click', function () { setBpm(bpm - 5); });
  subBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      sub = Number(btn.getAttribute('data-value')) || 1;
      beat = 0;
      subBtns.forEach(function (other) {
        var on = other === btn;
        other.classList.toggle('is-on', on);
        other.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    });
  });
  if (tap) tap.addEventListener('click', function () {
    var now = Date.now();
    taps = taps.filter(function (t) { return now - t < 2500; });
    taps.push(now);
    if (taps.length > 1) {
      var spans = [];
      for (var i = 1; i < taps.length; i += 1) spans.push(taps[i] - taps[i - 1]);
      var avg = spans.reduce(function (a, b) { return a + b; }, 0) / spans.length;
      if (avg > 0) setBpm(60000 / avg);
    }
  });
  setBpm(bpm);
})();
</script>`;
}

export function adminDash(
  base: string,
  user: Person,
  data: {
    note: string;
    counts: { waitlist: number; founding: number; active: number; canceled: number };
    people: number;
    lessons: { published: number; draft: number };
    challenges: { published: number; draft: number };
    pendingScores: number;
    recentPeople: Person[];
    audit: { actor: string; action: string; at: string }[];
    stripe: boolean;
    mail: {
      domain: string;
      status: string;
      totals: MetricsTotals | null;
      error: string;
    };
    broadcasts: Broadcast[];
    segments: Segment[];
  },
): string {
  const c = data.counts;
  const total = c.waitlist + c.founding + c.active + c.canceled;
  const pct = (n: number) => (total ? `${Math.round((n / total) * 100)}%` : '0%');
  const mix = total
    ? `<div class="mix" role="img" aria-label="Membership mix: ${c.waitlist} waitlist, ${c.founding} founding, ${c.active} active, ${c.canceled} canceled">
        ${c.waitlist ? `<i class="mix-wait" style="width:${pct(c.waitlist)}"></i>` : ''}
        ${c.founding ? `<i class="mix-found" style="width:${pct(c.founding)}"></i>` : ''}
        ${c.active ? `<i class="mix-active" style="width:${pct(c.active)}"></i>` : ''}
        ${c.canceled ? `<i class="mix-cancel" style="width:${pct(c.canceled)}"></i>` : ''}
      </div>
      <div class="legend">
        <span><b>${c.waitlist}</b> waitlist</span>
        <span><b>${c.founding}</b> founding</span>
        <span><b>${c.active}</b> active</span>
        <span><b>${c.canceled}</b> canceled</span>
      </div>`
    : `<p class="empty">No people in D1 yet. Add one below or wait for a homepage signup.</p>`;
  const alerts: string[] = [];
  if (data.mail.status && data.mail.status !== 'verified') {
    alerts.push(`Mail domain ${escapeHtml(data.mail.domain || 'stickitoutdrums.com')} is ${escapeHtml(data.mail.status)}. Login links and campaigns can fail until Resend verifies DKIM and SPF.`);
  }
  if (data.mail.error) alerts.push(`Resend: ${escapeHtml(data.mail.error)}`);
  if (!data.stripe) alerts.push('Stripe is not connected. Founding rates stay $19.99/mo and $149/yr. Do not invent checkout URLs.');
  if (data.lessons.published === 0) alerts.push('No published lessons. The member library is empty even for founding/active.');
  const attn = alerts.length
    ? `<section class="panel attn dash-full" aria-live="polite">
        <h2>Needs attention</h2>
        <ul>${alerts.map((a) => `<li>${a}</li>`).join('')}</ul>
      </section>`
    : '';
  const peopleRows = data.recentPeople.length
    ? data.recentPeople
        .map(
          (p) => `<tr class="click-row">
            <td><a href="${base}/members/${p.id}">${escapeHtml(p.name || p.email)}</a></td>
            <td>${escapeHtml(p.email)}</td>
            <td><span class="pill ${escapeHtml(p.status)}">${escapeHtml(p.status)}</span></td>
            <td>${escapeHtml(p.plan || '—')}</td>
            <td>${escapeHtml((p.created_at || '').replace('T', ' ').slice(0, 16))}</td>
          </tr>`,
        )
        .join('')
    : `<tr><td colspan="5" class="empty">No signups yet.</td></tr>`;
  const auditRows = data.audit.length
    ? data.audit
        .map(
          (a) => `<li class="list-link">
            <span>${escapeHtml(a.action)}</span>
            <span class="muted">${escapeHtml((a.at || '').replace('T', ' ').slice(0, 16))}</span>
          </li>`,
        )
        .join('')
    : `<li class="empty">No admin actions yet.</li>`;
  const campaigns = data.broadcasts.slice(0, 5);
  const campaignList = campaigns.length
    ? campaigns
        .map(
          (b) => `<a class="list-link" href="${base}/marketing/campaigns/${escapeHtml(b.id)}">
            <span class="gel">${escapeHtml(b.name || b.subject || 'Untitled')}</span>
            <span class="muted">${escapeHtml(b.status || '')}</span>
          </a>`,
        )
        .join('')
    : `<p class="empty">No campaigns yet. Compose in Marketing.</p>`;
  const segs = data.segments.length
    ? data.segments.map((s) => `<li>${escapeHtml(s.name)}</li>`).join('')
    : '<li class="muted">Lists appear after the first ingest or Marketing sync.</li>';
  const m = data.mail.totals;
  const metric = (key: string) => (m && m[key] != null ? String(m[key]) : '—');
  return shell({
    title: 'Dashboard | SIO Admin',
    base,
    kind: 'admin',
    path: '/',
    user,
    wide: true,
    body: `
      <h1 class="display" style="font-size:3rem;line-height:0.9;">Dashboard</h1>
      <p class="muted" style="margin:0.55rem 0 1.1rem;">Live D1 + Resend. Click a number to open the list.</p>
      ${data.note ? `<p class="flash">${escapeHtml(data.note)}</p>` : ''}
      <div class="kpis" style="margin-bottom:1.1rem;">
        <a class="kpi-card" href="${base}/members?status=waitlist">
          <div class="label">Waitlist</div>
          <p class="kpi">${c.waitlist}</p>
          <div class="go">Open members →</div>
        </a>
        <a class="kpi-card" href="${base}/members?status=founding">
          <div class="label">Founding</div>
          <p class="kpi">${c.founding}</p>
          <div class="go">Open members →</div>
        </a>
        <a class="kpi-card" href="${base}/members?status=active">
          <div class="label">Active</div>
          <p class="kpi">${c.active}</p>
          <div class="go">Open members →</div>
        </a>
        <a class="kpi-card" href="${base}/challenges">
          <div class="label">Pending scores</div>
          <p class="kpi">${data.pendingScores}</p>
          <div class="go">${data.challenges.published} live challenges →</div>
        </a>
      </div>
      <div class="dash">
        ${attn}
        <section class="panel">
          <h2>Roster mix</h2>
          <p class="muted">${data.people} people in D1</p>
          ${mix}
        </section>
        <section class="panel">
          <h2>Jump</h2>
          <form method="get" action="${base}/members" class="stack" style="margin-top:0.8rem;">
            <div>
              <label for="dash-q">Find a member</label>
              <input id="dash-q" name="q" type="search" placeholder="Name or email" autocomplete="off" />
            </div>
            <button class="btn" type="submit">Search members</button>
          </form>
          <form method="post" action="${base}/members" class="stack" style="margin-top:1rem;">
            <div><label for="dash-name">Add to waitlist</label><input id="dash-name" name="name" autocomplete="name" /></div>
            <div><label for="dash-email">Email</label><input id="dash-email" name="email" type="email" required autocomplete="email" /></div>
            <button class="btn ghost" type="submit">Add person</button>
          </form>
        </section>
        <section class="panel" style="overflow:auto;">
          <h2>Newest people</h2>
          <table class="stack-sm">
            <thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Plan</th><th>Joined</th></tr></thead>
            <tbody>${peopleRows}</tbody>
          </table>
        </section>
        <section class="panel">
          <h2>Quick actions</h2>
          <div class="stack" style="margin-top:0.8rem;">
            <form method="post" action="${base}/marketing/sync"><button class="btn" type="submit">Sync D1 into Resend lists</button></form>
            <a class="btn ghost" href="${base}/marketing/test">Send a test email</a>
            <a class="btn ghost" href="${base}/marketing/campaigns">Compose a campaign</a>
            <a class="btn ghost" href="${base}/challenges">Challenges · ${data.challenges.draft} draft / ${data.challenges.published} live</a>
            <a class="btn ghost" href="${base}/financials">${data.stripe ? 'Financials' : 'Financials · Stripe off'}</a>
          </div>
        </section>
        <section class="panel">
          <h2>Mail last 7 days</h2>
          <p class="muted">${escapeHtml(data.mail.domain || 'stickitoutdrums.com')} · ${data.mail.status ? `<span class="${data.mail.status === 'verified' ? 'ok' : 'err'}">${escapeHtml(data.mail.status)}</span>` : '—'}</p>
          <div class="grid two" style="margin-top:0.8rem;">
            <div><div class="label muted">Sent</div><p class="kpi">${escapeHtml(metric('sent'))}</p></div>
            <div><div class="label muted">Delivered</div><p class="kpi">${escapeHtml(metric('delivered'))}</p></div>
            <div><div class="label muted">Opened</div><p class="kpi">${escapeHtml(metric('unique_opened'))}</p></div>
            <div><div class="label muted">Bounced</div><p class="kpi">${escapeHtml(metric('bounced'))}</p></div>
          </div>
          <p style="margin-top:0.9rem;"><a href="${base}/marketing">Open Marketing</a></p>
          <h2 style="margin-top:1.1rem;">Lists</h2>
          <ul>${segs}</ul>
        </section>
        <section class="panel">
          <h2>Campaigns</h2>
          ${campaignList}
        </section>
        <section class="panel dash-full">
          <h2>Recent admin activity</h2>
          <ul>${auditRows}</ul>
        </section>
      </div>
    `,
  });
}

function membersQuery(opts: { status?: string; plan?: string; q?: string }): string {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  if (opts.plan) params.set('plan', opts.plan);
  if (opts.q) params.set('q', opts.q);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function statusForm(base: string, personId: string, status: string, plan: string | null, label: string, next = 'list'): string {
  return `<form method="post" action="${base}/members/${personId}">
    <input type="hidden" name="action" value="status" />
    <input type="hidden" name="next" value="${next}" />
    <input type="hidden" name="status" value="${escapeHtml(status)}" />
    <input type="hidden" name="plan" value="${escapeHtml(plan || '')}" />
    <button class="btn ghost" type="submit">${label}</button>
  </form>`;
}

function memberQuick(base: string, p: Person, next = 'list'): string {
  const plan = p.plan || 'monthly';
  const bits: string[] = [];
  if (p.status !== 'founding') bits.push(statusForm(base, p.id, 'founding', plan, 'Promote', next));
  if (p.status !== 'active') bits.push(statusForm(base, p.id, 'active', plan, 'Activate', next));
  if (p.status !== 'canceled') bits.push(statusForm(base, p.id, 'canceled', p.plan, 'Cancel', next));
  return `<div class="quick-actions">${bits.join('')}</div>`;
}

export function adminMembers(
  base: string,
  user: Person,
  people: Person[],
  note = '',
  q = '',
  status = '',
  plan = '',
  counts: { waitlist: number; founding: number; active: number; canceled: number } = {
    waitlist: 0,
    founding: 0,
    active: 0,
    canceled: 0,
  },
): string {
  const rows = people.length
    ? people
        .map(
          (p) => `<tr>
            <td data-label="Name"><a href="${base}/members/${p.id}">${escapeHtml(p.name || p.email)}</a></td>
            <td data-label="Email">${escapeHtml(p.email)}</td>
            <td data-label="Status"><span class="pill ${escapeHtml(p.status)}">${escapeHtml(p.status)}</span></td>
            <td data-label="Plan">${escapeHtml(p.plan || '-')}</td>
            <td data-label="Actions">${memberQuick(base, p)}<a class="btn ghost" href="${base}/members/${p.id}">Edit</a></td>
          </tr>`,
        )
        .join('')
    : `<tr><td colspan="5" class="empty">No members yet.</td></tr>`;
  const statusChips = ['', 'subscribed', 'waitlist', 'founding', 'active', 'canceled']
    .map((s) => {
      const href = `${base}/members${membersQuery({ status: s, plan, q })}`;
      const on = status === s || (!status && !s);
      return `<a class="pill ${s === 'subscribed' ? 'founding' : s} ${on ? 'is-on' : ''}" href="${href}">${s || 'all'}</a>`;
    })
    .join('');
  const planChips = ['', 'monthly', 'annual']
    .map((p) => {
      const href = `${base}/members${membersQuery({ status, plan: p, q })}`;
      const on = plan === p || (!plan && !p);
      return `<a class="pill ${on ? 'is-on' : ''}" href="${href}">${p || 'any plan'}</a>`;
    })
    .join('');
  return shell({
    title: 'Members | SIO Admin',
    base,
    kind: 'admin',
    path: '/members',
    user,
    body: `
      <h1 class="display" style="font-size:3rem;line-height:0.9;">Members</h1>
      ${note ? `<p class="flash">${escapeHtml(note)}</p>` : ''}
      <div class="kpis" style="margin-top:1rem;">
        <a class="kpi-card" href="${base}/members?status=waitlist"><p class="muted">Waitlist</p><p class="kpi">${counts.waitlist}</p></a>
        <a class="kpi-card" href="${base}/members?status=founding"><p class="muted">Founding</p><p class="kpi">${counts.founding}</p></a>
        <a class="kpi-card" href="${base}/members?status=active"><p class="muted">Active</p><p class="kpi">${counts.active}</p></a>
        <a class="kpi-card" href="${base}/members?status=canceled"><p class="muted">Canceled</p><p class="kpi">${counts.canceled}</p></a>
      </div>
      <form class="panel stack" method="get" action="${base}/members" style="margin:1.2rem 0;">
        <div>
          <label for="q">Search</label>
          <input id="q" name="q" value="${escapeHtml(q)}" placeholder="Name or email" />
        </div>
        <input type="hidden" name="status" value="${escapeHtml(status)}" />
        <input type="hidden" name="plan" value="${escapeHtml(plan)}" />
        <button class="btn ghost" type="submit">Search</button>
      </form>
      <p class="row" style="margin:0 0 0.5rem;">${statusChips}</p>
      <p class="row" style="margin:0 0 1rem;">${planChips}</p>
      <form class="panel stack" method="post" action="${base}/members" style="margin:1.2rem 0;">
        <div class="grid two">
          <div><label for="name">Name</label><input id="name" name="name" /></div>
          <div><label for="email">Email</label><input id="email" name="email" type="email" required /></div>
        </div>
        <button class="btn" type="submit">Add to waitlist</button>
      </form>
      <div class="panel" style="overflow:auto;">
        <table class="stack-sm">
          <thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Plan</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `,
  });
}

export type AdminLesson = {
  id: string;
  slug: string;
  title: string;
  week_index: number;
  published_at: string | null;
  video_url: string | null;
  stream_uid?: string | null;
  poster_key?: string | null;
  summary?: string;
  ready?: boolean;
  thumbnail?: string;
  duration?: number;
  watchers?: number;
};

export type StreamHealth = { ok: boolean; error?: string };

function lessonVideoLabel(l: AdminLesson): { text: string; cls: string } {
  if (l.stream_uid && l.ready) return { text: 'Ready', cls: 'founding' };
  if (l.stream_uid) return { text: 'Processing', cls: 'waitlist' };
  if (l.video_url) return { text: 'External', cls: 'waitlist' };
  return { text: 'No video', cls: 'canceled' };
}

function formatDuration(sec?: number): string {
  if (!sec || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function streamBanner(stream: StreamHealth): string {
  if (stream.ok) {
    return `<p class="ok" style="margin:0.4rem 0 0;">Stream is on. Drop a file onto a lesson. Playback stays signed and gated.</p>`;
  }
  return `<section class="panel attn" style="margin:1rem 0;">
    <h2>Video hosting is dark</h2>
    <p>${escapeHtml(stream.error || 'Cloudflare Stream is not enabled yet.')}</p>
    <p style="margin-top:0.8rem;"><a class="btn" href="${STREAM_DASH}" target="_blank" rel="noreferrer">Enable Stream</a></p>
  </section>`;
}

function flashLine(note: string): string {
  if (!note) return '';
  const bad = /not enabled|failed|error|forbidden|could not/i.test(note);
  return `<p class="${bad ? 'err' : 'flash'}">${escapeHtml(note)}</p>`;
}

export function adminLessons(
  base: string,
  user: Person,
  lessons: AdminLesson[],
  note = '',
  stream: StreamHealth = { ok: false },
  view = '',
): string {
  const live = lessons.filter((l) => l.published_at).length;
  const drafts = lessons.length - live;
  const ready = lessons.filter((l) => l.stream_uid && l.ready).length;
  const missing = lessons.filter((l) => !l.stream_uid && !l.video_url).length;
  const shown = lessons.filter((l) => {
    if (view === 'live') return Boolean(l.published_at);
    if (view === 'draft') return !l.published_at;
    if (view === 'ready') return Boolean(l.stream_uid && l.ready);
    if (view === 'missing') return !l.stream_uid && !l.video_url;
    return true;
  });
  const filter = (id: string, label: string, n: number) => {
    const href = id ? `${base}/lessons?view=${id}` : `${base}/lessons`;
    const on = view === id || (!view && !id);
    return `<a class="pill ${on ? 'founding' : ''}" href="${href}">${label} ${n}</a>`;
  };
  const cards = shown.length
    ? `<div class="video-grid">${shown
        .map((l) => {
          const vid = lessonVideoLabel(l);
          const dur = formatDuration(l.duration);
          const thumb = l.thumbnail
            ? `<img src="${escapeHtml(l.thumbnail)}" alt="" />`
            : `<div class="missing">${l.stream_uid ? 'Processing' : 'Dark'}</div>`;
          return `<a class="video-card" href="${base}/lessons/${l.id}">
            <div class="thumb">
              ${thumb}
              <span class="cue-week">Week ${l.week_index}</span>
            </div>
            <div class="meta">
              <h2>${escapeHtml(l.title)}</h2>
              <p class="row">
                <span class="pill ${l.published_at ? 'founding' : ''}">${l.published_at ? 'Live' : 'Draft'}</span>
                <span class="pill ${vid.cls}">${vid.text}</span>
                ${dur ? `<span class="muted">${dur}</span>` : ''}
                <span class="muted">${l.watchers || 0} watched</span>
              </p>
            </div>
          </a>`;
        })
        .join('')}</div>`
    : `<p class="empty">${lessons.length ? 'Nothing in this filter.' : 'No lessons yet. Create one, then drop the video on the stage.'}</p>`;
  return shell({
    title: 'Lessons | SIO Admin',
    base,
    kind: 'admin',
    path: '/lessons',
    user,
    wide: true,
    body: `
      <h1 class="display" style="font-size:3rem;line-height:0.9;">Lessons</h1>
      <p class="muted" style="margin:0.45rem 0 0;">Host videos here. Members only get a signed player if they are founding or active.</p>
      ${flashLine(note)}
      ${streamBanner(stream)}
      <div class="bar-stats">
        ${filter('', 'All', lessons.length)}
        ${filter('live', 'Live', live)}
        ${filter('draft', 'Drafts', drafts)}
        ${filter('ready', 'Ready', ready)}
        ${filter('missing', 'No video', missing)}
      </div>
      <form class="panel" method="post" action="${base}/lessons" style="margin:0 0 1.2rem;">
        <div class="grid two" style="align-items:end;">
          <div><label for="title">New lesson</label><input id="title" name="title" required placeholder="Paradiddle warmup" /></div>
          <div class="row" style="align-items:end;">
            <div style="flex:1;min-width:6rem;"><label for="week_index">Week</label><input id="week_index" name="week_index" type="number" min="0" value="${lessons.length + 1}" /></div>
            <button class="btn" type="submit" style="margin-bottom:0;">Create</button>
          </div>
        </div>
      </form>
      ${cards}
    `,
  });
}

function uploadDeck(base: string, lesson: AdminLesson, stream: StreamHealth, upload: { id: string; uploadURL: string } | null): string {
  const disabled = !stream.ok;
  return `
    <div id="drop" class="drop" role="button" tabindex="0" aria-disabled="${disabled ? 'true' : 'false'}">
      <input id="stream-file" type="file" accept="video/*" ${disabled ? 'disabled' : ''} />
      <strong class="gel">${lesson.stream_uid ? 'Replace video' : 'Drop video on the stage'}</strong>
      <span>MP4, MOV, or WebM. Under 200MB. Signed playback. Waitlist cannot watch.</span>
      <p id="stream-status" class="muted" style="margin:0.35rem 0 0;">${
        disabled ? escapeHtml(stream.error || 'Enable Stream first.') : upload ? 'Slot ready. Pick a file or drop it here.' : 'Click or drop a file.'
      }</p>
    </div>
    <script>
      (function () {
        var drop = document.getElementById('drop');
        var input = document.getElementById('stream-file');
        var status = document.getElementById('stream-status');
        var endpoint = ${JSON.stringify(`${base}/lessons/${lesson.id}`)};
        var readyUrl = ${JSON.stringify(upload?.uploadURL || '')};
        var blocked = ${disabled ? 'true' : 'false'};
        function postFile(url, file) {
          return new Promise(function (resolve, reject) {
            var body = new FormData();
            body.append('file', file, file.name);
            var xhr = new XMLHttpRequest();
            xhr.open('POST', url);
            xhr.upload.onprogress = function (e) {
              if (e.lengthComputable) status.textContent = 'Uploading ' + Math.round((e.loaded / e.total) * 100) + '%';
            };
            xhr.onload = function () {
              if (xhr.status >= 200 && xhr.status < 300) resolve();
              else reject(new Error(xhr.responseText ? xhr.responseText.slice(0, 180) : 'Upload failed (' + xhr.status + ')'));
            };
            xhr.onerror = function () { reject(new Error('Network error while uploading.')); };
            xhr.send(body);
          });
        }
        function start(file) {
          if (blocked) { status.textContent = ${JSON.stringify(stream.error || 'Enable Stream first.')}; return; }
          if (!file) return;
          if (file.size > 200 * 1024 * 1024) { status.textContent = 'Keep files under 200MB.'; return; }
          function send(url) {
            status.textContent = 'Uploading…';
            postFile(url, file).then(function () {
              status.textContent = 'Uploaded. Stream is processing. Refreshing…';
              setTimeout(function () { location.reload(); }, 1400);
            }).catch(function (err) { status.textContent = err.message || String(err); });
          }
          if (readyUrl) { var url = readyUrl; readyUrl = ''; send(url); return; }
          status.textContent = 'Opening a signed slot…';
          fetch(endpoint, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'action=stream-upload'
          }).then(function (r) { return r.json(); }).then(function (data) {
            if (data.error) { status.textContent = data.error; return; }
            send(data.uploadURL);
          }).catch(function (err) { status.textContent = String(err); });
        }
        drop.addEventListener('click', function () { if (!blocked) input.click(); });
        drop.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!blocked) input.click(); }
        });
        input.addEventListener('change', function () { start(input.files && input.files[0]); });
        ['dragenter', 'dragover'].forEach(function (ev) {
          drop.addEventListener(ev, function (e) { e.preventDefault(); if (!blocked) drop.classList.add('is-over'); });
        });
        drop.addEventListener('dragleave', function () { drop.classList.remove('is-over'); });
        drop.addEventListener('drop', function (e) {
          e.preventDefault(); drop.classList.remove('is-over');
          start(e.dataTransfer && e.dataTransfer.files[0]);
        });
      })();
    </script>
  `;
}

export function adminLessonDetail(
  base: string,
  user: Person,
  lesson: AdminLesson,
  player: { src: string; ready: boolean; error?: string },
  watchers: { email: string; name: string; watched_at: string | null; completed_at: string | null; person_id: string }[],
  upload: { id: string; uploadURL: string } | null,
  note = '',
  stream: StreamHealth = { ok: false },
): string {
  const vid = lessonVideoLabel(lesson);
  const media = player.src
    ? `<div class="player"><iframe src="${escapeHtml(player.src)}" referrerpolicy="origin" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;" allowfullscreen title="${escapeHtml(lesson.title)}"></iframe></div>`
    : `<div class="player"><div class="stage-empty">
        <div>
          <div class="label">Stage is dark</div>
          <p class="muted" style="margin:0.45rem 0 0;">${escapeHtml(player.error && !/No Stream video/i.test(player.error) ? player.error : 'Drop a file on the stage. Waitlist never gets a token.')}</p>
        </div>
      </div></div>`;
  const watcherRows = watchers.length
    ? watchers
        .map(
          (w) => `<tr>
            <td><a href="${base}/members/${w.person_id}">${escapeHtml(w.name || w.email)}</a></td>
            <td>${w.watched_at ? escapeHtml(w.watched_at.replace('T', ' ').slice(0, 16)) : '—'}</td>
            <td>${w.completed_at ? escapeHtml(w.completed_at.replace('T', ' ').slice(0, 16)) : '—'}</td>
          </tr>`,
        )
        .join('')
    : `<tr><td colspan="3" class="empty">Nobody has watched this yet.</td></tr>`;
  return shell({
    title: `${lesson.title} | SIO Admin`,
    base,
    kind: 'admin',
    path: '/lessons',
    user,
    wide: true,
    body: `
      <p class="crumb"><a href="${base}/lessons">Lessons</a> · Week ${lesson.week_index}</p>
      <div class="row" style="justify-content:space-between;align-items:flex-start;margin-top:0.35rem;">
        <div>
          <h1 class="display" style="font-size:3rem;line-height:0.9;">${escapeHtml(lesson.title)}</h1>
          <p class="row" style="margin-top:0.55rem;">
            <span class="pill ${lesson.published_at ? 'founding' : ''}">${lesson.published_at ? 'Live for members' : 'Draft'}</span>
            <span class="pill ${vid.cls}">${vid.text}</span>
          </p>
        </div>
        <form method="post" action="${base}/lessons/${lesson.id}">
          <button class="${lesson.published_at ? 'btn ghost' : 'btn'}" name="action" value="toggle" type="submit">${lesson.published_at ? 'Unpublish' : 'Publish'}</button>
        </form>
      </div>
      ${flashLine(note)}
      ${stream.ok ? '' : streamBanner(stream)}
      <div class="studio" style="margin-top:1.1rem;">
        <div class="stack">
          ${media}
          ${uploadDeck(base, lesson, stream, upload)}
          <form class="panel stack" method="post" action="${base}/lessons/${lesson.id}" enctype="multipart/form-data">
            <input type="hidden" name="action" value="poster" />
            <h2>Thumbnail</h2>
            <p class="muted">${lesson.poster_key ? 'Custom still on file. Upload another to replace it.' : 'No custom still. We grab the first frame of the Stream video until you upload one.'}</p>
            ${lesson.thumbnail ? `<div class="thumb" style="max-width:18rem;border-radius:var(--radius);overflow:hidden;"><img src="${escapeHtml(lesson.thumbnail)}" alt="" /></div>` : ''}
            <div><label for="poster">JPG, PNG, or WebP. Under 5MB.</label><input id="poster" name="poster" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></div>
            <button class="btn ghost" type="submit">Save thumbnail</button>
          </form>
          <form class="panel stack" method="post" action="${base}/lessons/${lesson.id}">
            <h2>Pull from a URL</h2>
            <p class="muted">Public https file. Stream copies it and signs playback.</p>
            <input id="ingest_url" name="ingest_url" placeholder="https://" ${stream.ok ? '' : 'disabled'} />
            <button class="btn ghost" name="action" value="stream-ingest" type="submit" ${stream.ok ? '' : 'disabled'}>Ingest URL</button>
          </form>
        </div>
        <div class="stack">
          <form class="panel stack" method="post" action="${base}/lessons/${lesson.id}">
            <input type="hidden" name="action" value="save" />
            <h2>Lesson</h2>
            <div><label for="title">Title</label><input id="title" name="title" value="${escapeHtml(lesson.title)}" /></div>
            <div><label for="week_index">Week</label><input id="week_index" name="week_index" type="number" value="${lesson.week_index}" /></div>
            <div><label for="summary">What members see</label><textarea id="summary" name="summary" placeholder="Hands only. Slow to tempo.">${escapeHtml(lesson.summary || '')}</textarea></div>
            <button class="btn" type="submit">Save</button>
          </form>
          <section class="panel" style="overflow:auto;">
            <h2>Who watched</h2>
            <p class="muted">${watchers.length} member${watchers.length === 1 ? '' : 's'}</p>
            <table class="stack-sm">
              <thead><tr><th>Member</th><th>Watched</th><th>Done</th></tr></thead>
              <tbody>${watcherRows}</tbody>
            </table>
          </section>
          <details class="panel">
            <summary>Advanced</summary>
            <form method="post" action="${base}/lessons/${lesson.id}" class="stack" style="margin-top:0.9rem;">
              <input type="hidden" name="action" value="save" />
              <input type="hidden" name="title" value="${escapeHtml(lesson.title)}" />
              <input type="hidden" name="week_index" value="${lesson.week_index}" />
              <input type="hidden" name="summary" value="${escapeHtml(lesson.summary || '')}" />
              <div><label for="stream_uid">Stream id</label><input id="stream_uid" name="stream_uid" value="${escapeHtml(lesson.stream_uid || '')}" /></div>
              <div><label for="video_url">Fallback URL</label><input id="video_url" name="video_url" value="${escapeHtml(lesson.video_url || '')}" placeholder="Optional public URL" /></div>
              <button class="btn ghost" type="submit">Save ids</button>
            </form>
            <form method="post" action="${base}/lessons/${lesson.id}" style="margin-top:0.9rem;" onsubmit="return confirm('Delete this lesson?');">
              <button class="btn ghost" name="action" value="delete" type="submit">Delete lesson</button>
            </form>
          </details>
        </div>
      </div>
    `,
  });
}

export function adminMemberCrm(
  base: string,
  user: Person,
  data: {
    person: Person;
    notes: { id: string; actor: string; body: string; at: string }[];
    tags: { id: string; name: string }[];
    allTags: { id: string; name: string }[];
    progress: { lesson_id: string; title: string; week_index: number; watched_at: string | null; completed_at: string | null }[];
    practice: { id: string; lesson_title: string | null; bpm: number | null; notes: string; at: string }[];
    attempts: { title: string; notes: string; submitted_at: string; score: number | null }[];
    audit: { actor: string; action: string; at: string }[];
    patterns: {
      title: string;
      discipline: string;
      medal: string;
      best_bpm: number | null;
      bpm_goal: number;
      sessions: number;
      last_practiced_at: string | null;
    }[];
    streak: StreakState;
  },
  note = '',
): string {
  const p = data.person;
  const tags = data.tags.length
    ? data.tags
        .map(
          (t) => `<span class="tag">${escapeHtml(t.name)}
            <form method="post" action="${base}/members/${p.id}" style="display:inline;">
              <input type="hidden" name="action" value="untag" />
              <input type="hidden" name="tag_id" value="${escapeHtml(t.id)}" />
              <button type="submit" aria-label="Remove ${escapeHtml(t.name)}">×</button>
            </form>
          </span>`,
        )
        .join('')
    : `<span class="muted">No tags</span>`;
  const tagOptions = data.allTags.map((t) => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`).join('');
  const notes = data.notes.length
    ? data.notes
        .map(
          (n) => `<article style="padding:0.7rem 0;border-bottom:1px solid var(--line);">
            <p class="muted">${escapeHtml(n.actor)} · ${escapeHtml((n.at || '').replace('T', ' ').slice(0, 16))}</p>
            <p style="margin:0.35rem 0 0;white-space:pre-wrap;">${escapeHtml(n.body)}</p>
          </article>`,
        )
        .join('')
    : `<p class="empty">No notes yet.</p>`;
  const progress = data.progress.length
    ? data.progress
        .map(
          (row) => `<tr>
            <td data-label="Lesson"><a href="${base}/lessons/${row.lesson_id}">${escapeHtml(row.title)}</a></td>
            <td data-label="Watch">${row.watched_at ? 'watched' : '—'}</td>
            <td data-label="Done">${row.completed_at ? 'done' : '—'}</td>
          </tr>`,
        )
        .join('')
    : `<tr><td colspan="3" class="empty">No published lessons.</td></tr>`;
  const practice = data.practice.length
    ? data.practice
        .map(
          (row) => `<li class="list-link">
            <span>${escapeHtml(row.lesson_title || 'open practice')}${row.bpm ? ` · ${row.bpm} BPM` : ''}<br /><span class="muted">${escapeHtml(row.notes || '')}</span></span>
            <span class="muted">${escapeHtml((row.at || '').replace('T', ' ').slice(0, 16))}</span>
          </li>`,
        )
        .join('')
    : `<li class="empty">No practice logs.</li>`;
  const audit = data.audit.length
    ? data.audit.map((a) => `<li class="list-link"><span>${escapeHtml(a.action)}</span><span class="muted">${escapeHtml((a.at || '').replace('T', ' ').slice(0, 16))}</span></li>`).join('')
    : `<li class="empty">No CRM actions yet.</li>`;
  return shell({
    title: `${p.name || p.email} | CRM`,
    base,
    kind: 'admin',
    path: '/members',
    user,
    wide: true,
    body: `
      <p class="muted"><a href="${base}/members">Members</a></p>
      <h1 class="display" style="font-size:3rem;line-height:0.9;margin-top:0.35rem;">${escapeHtml(p.name || p.email)}</h1>
      <p class="muted">${escapeHtml(p.email)} · <span class="pill ${escapeHtml(p.status)}">${escapeHtml(p.status)}</span> · ${escapeHtml(p.plan || 'no plan')} · last seen ${escapeHtml((p.last_seen_at || 'never').replace('T', ' ').slice(0, 16))}</p>
      ${note ? `<p class="flash">${escapeHtml(note)}</p>` : ''}
      <div class="member-bar panel">
        <p class="muted" style="margin:0 0 0.7rem;">Founding and active unlock lessons. Waitlist stays gated.</p>
        ${memberQuick(base, p, 'crm')}
        <form method="post" action="${base}/members/${p.id}" class="row" style="margin-top:0.7rem;">
          <input type="hidden" name="action" value="status" />
          <input type="hidden" name="status" value="${escapeHtml(p.status)}" />
          <label class="sr" for="plan-bar">Plan</label>
          <select id="plan-bar" name="plan" style="max-width:14rem;">
            <option value="" ${!p.plan ? 'selected' : ''}>none</option>
            <option value="monthly" ${p.plan === 'monthly' ? 'selected' : ''}>monthly</option>
            <option value="annual" ${p.plan === 'annual' ? 'selected' : ''}>annual</option>
          </select>
          <button class="btn" type="submit">Change plan</button>
        </form>
      </div>
      <div class="dash" style="margin-top:1.1rem;">
        <section class="panel stack">
          <h2>Profile</h2>
          <form method="post" action="${base}/members/${p.id}" class="stack">
            <input type="hidden" name="action" value="profile" />
            <div><label for="name">Name</label><input id="name" name="name" value="${escapeHtml(p.name || '')}" /></div>
            <div><label for="kit">Kit</label><textarea id="kit" name="kit" placeholder="4-piece, hats, two crashes">${escapeHtml(p.kit || '')}</textarea></div>
            <div><label for="level">Playing level</label>${levelSelect('level', p.level || '', false)}</div>
            <div><label for="phone">Phone</label><input id="phone" name="phone" value="${escapeHtml(p.phone || '')}" /></div>
            <div><label for="source">Source</label><input id="source" name="source" value="${escapeHtml(p.source || '')}" placeholder="waitlist, admin, free-lesson" /></div>
            <button class="btn" type="submit">Save profile</button>
          </form>
        </section>
        <section class="panel stack">
          <h2>Membership</h2>
          <form method="post" action="${base}/members/${p.id}" class="stack">
            <input type="hidden" name="action" value="status" />
            <div>
              <label for="status">Status</label>
              <select id="status" name="status">
                ${['waitlist', 'founding', 'active', 'canceled'].map((s) => `<option value="${s}" ${p.status === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </div>
            <div>
              <label for="plan">Plan</label>
              <select id="plan" name="plan">
                <option value="" ${!p.plan ? 'selected' : ''}>none</option>
                <option value="monthly" ${p.plan === 'monthly' ? 'selected' : ''}>monthly $19.99</option>
                <option value="annual" ${p.plan === 'annual' ? 'selected' : ''}>annual $149</option>
              </select>
            </div>
            <button class="btn" type="submit">Save and sync Resend</button>
          </form>
          <form method="post" action="${base}/members/${p.id}"><input type="hidden" name="action" value="login" /><button class="btn ghost" type="submit">Send login link</button></form>
          <form method="post" action="${base}/members/${p.id}"><input type="hidden" name="action" value="resend" /><button class="btn ghost" type="submit">Sync to Resend lists</button></form>
        </section>
        <section class="panel stack">
          <h2>Tags</h2>
          <p class="row">${tags}</p>
          <form method="post" action="${base}/members/${p.id}" class="stack">
            <input type="hidden" name="action" value="tag" />
            <div><label for="tag">Add tag</label><input id="tag" name="tag" list="tag-list" placeholder="founding, student" /></div>
            <datalist id="tag-list">${tagOptions}</datalist>
            <button class="btn ghost" type="submit">Add tag</button>
          </form>
        </section>
        <section class="panel stack">
          <h2>Notes</h2>
          <form method="post" action="${base}/members/${p.id}" class="stack">
            <input type="hidden" name="action" value="note" />
            <textarea name="body" placeholder="Call notes, kit, goals"></textarea>
            <button class="btn" type="submit">Add note</button>
          </form>
          ${notes}
        </section>
        <section class="panel" style="overflow:auto;">
          <h2>Lesson progress</h2>
            <table class="stack-sm">
            <thead><tr><th>Lesson</th><th>Watch</th><th>Done</th></tr></thead>
            <tbody>${progress}</tbody>
          </table>
        </section>
        <section class="panel">
          <h2>Practice</h2>
          <ul>${practice}</ul>
        </section>
        <section class="panel stack">
          <h2>Rudiments and patterns</h2>
          <p class="muted" style="margin:0;">Streak ${data.streak.current_days} day${
            data.streak.current_days === 1 ? '' : 's'
          } · longest ${data.streak.longest_days} · ${data.streak.total_days} total days${
            data.streak.last_day ? ` · last ${escapeHtml(data.streak.last_day)}` : ''
          }${(() => {
            const titles = MILESTONES.filter((m) => data.streak.rewards.earnedDays.includes(m.days)).map((m) => m.title);
            return titles.length ? ` · rewards ${escapeHtml(titles.join(', '))}` : '';
          })()}</p>
          ${
            data.patterns.length
              ? `<ul>${data.patterns
                  .map(
                    (row) => `<li class="list-link">
                      <span>${escapeHtml(row.title)}<br /><span class="muted">${escapeHtml(row.discipline)} · ${
                        row.sessions
                      } session${row.sessions === 1 ? '' : 's'}</span></span>
                      <span>${medalChip(row.medal)} <span class="muted">${Math.round(row.best_bpm || 0)}/${
                        row.bpm_goal
                      }</span></span>
                    </li>`,
                  )
                  .join('')}</ul>`
              : '<p class="empty">No pattern sessions yet.</p>'
          }
        </section>
        <section class="panel">
          <h2>Challenges</h2>
          ${
            data.attempts.length
              ? `<ul>${data.attempts
                  .map(
                    (a) => `<li class="list-link"><span>${escapeHtml(a.title)}<br /><span class="muted">${escapeHtml(a.notes || '')}</span></span><span class="gel">${a.score == null ? 'pending' : a.score}</span></li>`,
                  )
                  .join('')}</ul>`
              : '<p class="empty">No challenge attempts.</p>'
          }
        </section>
        <section class="panel dash-full">
          <h2>CRM activity</h2>
          <ul>${audit}</ul>
        </section>
      </div>
    `,
  });
}

export function adminChallenges(
  base: string,
  user: Person,
  items: (Challenge & { attempts: Attempt[]; board: BoardRow[] })[],
  note = '',
): string {
  const list = items.length
    ? items
        .map((c) => {
          const pending = c.attempts.filter((a) => a.score == null);
          const scored = c.attempts.filter((a) => a.score != null);
          const attemptRows = c.attempts.length
            ? c.attempts
                .map(
                  (a) => `<tr>
                    <td><a href="${base}/members/${a.person_id}">${escapeHtml(a.name)}</a></td>
                    <td>${escapeHtml((a.notes || '').slice(0, 120))}</td>
                    <td>
                      <form method="post" action="${base}/challenges/${c.id}" class="row">
                        <input type="hidden" name="action" value="score" />
                        <input type="hidden" name="person_id" value="${escapeHtml(a.person_id)}" />
                        <input name="score" type="number" min="0" max="100" step="1" value="${a.score == null ? '' : a.score}" required style="max-width:5.5rem;" />
                        <button class="btn" type="submit">${a.score == null ? 'Score' : 'Update'}</button>
                      </form>
                    </td>
                  </tr>`,
                )
                .join('')
            : `<tr><td colspan="3" class="empty">No attempts yet.</td></tr>`;
          return `<article class="panel stack">
            <h2>${escapeHtml(c.title)}</h2>
            <p class="muted">${c.published_at ? 'published' : 'draft'} · ${pending.length} pending · ${scored.length} scored</p>
            <form method="post" action="${base}/challenges/${c.id}" class="stack">
              <input name="title" value="${escapeHtml(c.title)}" />
              <textarea name="prompt">${escapeHtml(c.prompt)}</textarea>
              <div class="row">
                <button class="btn" name="action" value="save" type="submit">Save</button>
                <button class="btn ghost" name="action" value="toggle" type="submit">${c.published_at ? 'Unpublish' : 'Publish'}</button>
                <button class="btn ghost" name="action" value="delete" type="submit">Delete</button>
              </div>
            </form>
            <h3>Attempts</h3>
            <div style="overflow:auto;">
              <table class="stack-sm">
                <thead><tr><th>Member</th><th>Notes</th><th>Score 0–100</th></tr></thead>
                <tbody>${attemptRows}</tbody>
              </table>
            </div>
            <h3>Board</h3>
            ${
              c.board.length
                ? `<ol class="board">${c.board
                    .map(
                      (row, i) => `<li class="board-row"><span class="rank">${i + 1}</span><span>${escapeHtml(row.name)}</span><span class="score">${row.score}</span></li>`,
                    )
                    .join('')}</ol>`
                : '<p class="empty">No scores yet.</p>'
            }
          </article>`;
        })
        .join('')
    : `<p class="empty">No challenges yet.</p>`;
  return shell({
    title: 'Challenges | SIO Admin',
    base,
    kind: 'admin',
    path: '/challenges',
    user,
    wide: true,
    body: `
      <h1 class="display" style="font-size:3rem;line-height:0.9;">Challenges</h1>
      ${note ? `<p class="flash">${escapeHtml(note)}</p>` : ''}
      <form class="panel stack" method="post" action="${base}/challenges" style="margin:1.2rem 0;">
        <div><label for="title">Title</label><input id="title" name="title" required /></div>
        <div><label for="prompt">Prompt</label><textarea id="prompt" name="prompt"></textarea></div>
        <button class="btn" type="submit">Create challenge</button>
      </form>
      <div class="stack">${list}</div>
    `,
  });
}

export function adminFinancials(
  base: string,
  user: Person,
  counts: { waitlist: number; founding: number; active: number; canceled: number },
): string {
  return shell({
    title: 'Financials | SIO Admin',
    base,
    kind: 'admin',
    path: '/financials',
    user,
    body: `
      <h1 class="display" style="font-size:3rem;line-height:0.9;">Financials</h1>
      <p class="muted" style="margin:0.8rem 0 1.2rem;">Stripe not connected.</p>
      <div class="grid two">
        <section class="panel"><h2>Waitlist</h2><p style="font-size:2rem;margin:0.4rem 0 0;">${counts.waitlist}</p></section>
        <section class="panel"><h2>Founding</h2><p style="font-size:2rem;margin:0.4rem 0 0;">${counts.founding}</p></section>
        <section class="panel"><h2>Active</h2><p style="font-size:2rem;margin:0.4rem 0 0;">${counts.active}</p></section>
        <section class="panel"><h2>Canceled</h2><p style="font-size:2rem;margin:0.4rem 0 0;">${counts.canceled}</p></section>
      </div>
    `,
  });
}

export function adminPatterns(
  base: string,
  user: Person,
  data: {
    patterns: Pattern[];
    discipline: string;
    day: string;
    overrideId: string;
    note?: string;
  },
): string {
  const segs = [{ id: '', label: 'All' }, ...DISCIPLINES]
    .map((d) => {
      const on = data.discipline === d.id;
      return `<a class="seg ${on ? 'is-on' : ''}" href="${base}/rudiments${d.id ? `?d=${d.id}` : ''}">${d.label}</a>`;
    })
    .join('');

  const rows = data.patterns.length
    ? data.patterns
        .map(
          (p) => `<tr>
            <td data-label="Pattern">${escapeHtml(p.title)}<br /><span class="muted">${escapeHtml(p.discipline)} · ${escapeHtml(
              p.family,
            )}</span></td>
            <td data-label="Sticking"><span class="muted">${escapeHtml(p.sticking)}</span></td>
            <td data-label="Edit">
              <form method="post" action="${base}/rudiments" class="stack">
                <input type="hidden" name="action" value="save" />
                <input type="hidden" name="id" value="${escapeHtml(p.id)}" />
                <div class="grid two">
                  <div><label for="start-${p.id}">Start BPM</label><input id="start-${p.id}" name="bpm_start" type="number" min="30" max="300" step="10" value="${p.bpm_start}" /></div>
                  <div><label for="goal-${p.id}">Diamond BPM</label><input id="goal-${p.id}" name="bpm_goal" type="number" min="40" max="400" step="10" value="${p.bpm_goal}" /></div>
                </div>
                <p class="muted tier-preview">${MEDALS.filter((m) => m.at > 0)
                  .map((m) => `${escapeHtml(m.label)} ${medalTarget(p.bpm_goal, m.id)}`)
                  .join(' &middot; ')}</p>
                <div class="grid two">
                  <div>
                    <label for="tier-${p.id}">Tier</label>
                    <select id="tier-${p.id}" name="tier">
                      ${['free', 'member', 'pro']
                        .map((t) => `<option value="${t}" ${p.tier === t ? 'selected' : ''}>${t}</option>`)
                        .join('')}
                    </select>
                  </div>
                  <div>
                    <label for="level-${p.id}">Level</label>
                    <select id="level-${p.id}" name="level">
                      ${LEVELS.map((l) => `<option value="${l}" ${p.level === l ? 'selected' : ''}>${l}</option>`).join('')}
                    </select>
                  </div>
                </div>
                <div><label for="stick-${p.id}">Sticking</label><input id="stick-${p.id}" name="sticking" value="${escapeHtml(
                  p.sticking,
                )}" /></div>
                <div><label for="vex-${p.id}">Notation (hands)</label><input id="vex-${p.id}" name="vex_notes" value="${escapeHtml(
                  p.vex_notes || '',
                )}" placeholder="c5/8, c5, c5, c5" /></div>
                <div><label for="feet-${p.id}">Notation (feet)</label><input id="feet-${p.id}" name="vex_feet" value="${escapeHtml(
                  p.vex_feet || '',
                )}" placeholder="f4/8, f4, f4, f4" /></div>
                <div><label for="note-${p.id}">Coaching note</label><input id="note-${p.id}" name="notes" value="${escapeHtml(
                  p.notes || '',
                )}" /></div>
                <div class="row">
                  <button class="btn" type="submit">Save</button>
                  <button class="btn ghost" name="action" value="override" type="submit">Make today's pick</button>
                </div>
              </form>
            </td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="3" class="empty">No patterns seeded.</td></tr>';

  const override = data.overrideId
    ? data.patterns.find((p) => p.id === data.overrideId)?.title || data.overrideId
    : '';

  return shell({
    title: 'Rudiments | SIO Admin',
    base,
    kind: 'admin',
    path: '/rudiments',
    user,
    wide: true,
    body: `
      <h1 class="display" style="font-size:3rem;line-height:0.9;">Rudiments</h1>
      <p class="muted" style="margin:0.6rem 0 0;">Catalog for hands, feet, and four-limb. Tier controls paid access, level only groups the list.</p>
      ${data.note ? `<p class="flash">${escapeHtml(data.note)}</p>` : ''}
      <section class="panel" style="margin:1rem 0;">
        <div class="label">Today (${escapeHtml(data.day)})</div>
        <p style="margin:0.35rem 0 0;">${
          override
            ? `Override set: <strong>${escapeHtml(override)}</strong>`
            : 'No override. Each member gets the weakest pattern in their tier, alternating hands and feet by day.'
        }</p>
      </section>
      <nav class="segs" aria-label="Discipline">${segs}</nav>
      <div class="panel" style="overflow:auto;">
        <table class="stack-sm">
          <thead><tr><th>Pattern</th><th>Sticking</th><th>Settings</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `,
  });
}

function marketingTabs(base: string, path: string): string {
  const tabs = [
    ['/marketing', 'Overview'],
    ['/marketing/campaigns', 'Campaigns'],
    ['/marketing/lists', 'Lists'],
    ['/marketing/templates', 'Templates'],
    ['/marketing/topics', 'Topics'],
    ['/marketing/suppressions', 'Suppressions'],
    ['/marketing/test', 'Test send'],
  ];
  return `<nav class="tabs">${tabs
    .map(([href, label]) => {
      const on = href === '/marketing' ? path === '/marketing' : path.startsWith(href);
      return `<a href="${base}${href}" class="${on ? 'is-on' : ''}">${label}</a>`;
    })
    .join('')}</nav>`;
}

function noteBlock(note: string, error: string): string {
  return `${error ? `<p class="err">${escapeHtml(error)}</p>` : ''}${note ? `<p class="flash">${escapeHtml(note)}</p>` : ''}`;
}

function metricGrid(totals: MetricsTotals | null): string {
  const keys = ['sent', 'delivered', 'unique_opened', 'unique_clicked', 'bounced', 'complained', 'unsubscribed'];
  const cells = keys
    .map((k) => {
      const v = totals?.[k];
      return `<section class="panel"><h2>${escapeHtml(k.replaceAll('_', ' '))}</h2><p class="kpi">${v == null ? '—' : escapeHtml(String(v))}</p></section>`;
    })
    .join('');
  return `<div class="grid two">${cells}</div>`;
}

export function adminMarketingOverview(
  base: string,
  user: Person,
  data: {
    domains: Domain[];
    totals: MetricsTotals | null;
    d1: { waitlist: number; founding: number; active: number };
    segments: Segment[];
    broadcasts: Broadcast[];
    apiError: string;
    note: string;
    error: string;
  },
): string {
  const domains = data.domains.length
    ? data.domains.map((d) => `<li>${escapeHtml(d.name)} · ${escapeHtml(d.status)}</li>`).join('')
    : '<li class="muted">No sending domains yet.</li>';
  const segs = data.segments.length
    ? data.segments.map((s) => `<li>${escapeHtml(s.name)}</li>`).join('')
    : '<li class="muted">No lists yet. Sync to create SIO Waitlist / Founding / Active / All.</li>';
  const recent = data.broadcasts.slice(0, 6);
  const rows = recent.length
    ? recent
        .map(
          (b) => `<tr>
            <td><a href="${base}/marketing/campaigns/${escapeHtml(b.id)}">${escapeHtml(b.name || b.subject || b.id)}</a></td>
            <td>${escapeHtml(b.status || '-')}</td>
            <td>${escapeHtml((b.sent_at || b.scheduled_at || b.created_at || '-').slice(0, 16))}</td>
          </tr>`,
        )
        .join('')
    : `<tr><td colspan="3" class="empty">No campaigns yet.</td></tr>`;
  return shell({
    title: 'Marketing | SIO Admin',
    base,
    kind: 'admin',
    path: '/marketing',
    user,
    wide: true,
    body: `
      <h1 class="display" style="font-size:3rem;line-height:0.9;">Marketing</h1>
      <p class="muted" style="margin:0.6rem 0 0;">Resend campaigns for waitlist and founding members. Sync lists before you send.</p>
      ${marketingTabs(base, '/marketing')}
      ${noteBlock(data.note, data.error || data.apiError)}
      <div class="grid two" style="margin-bottom:1rem;">
        <section class="panel">
          <h2>D1 members</h2>
          <p class="muted">Waitlist ${data.d1.waitlist} · Founding ${data.d1.founding} · Active ${data.d1.active}</p>
          <form method="post" action="${base}/marketing/sync" style="margin-top:1rem;">
            <button class="btn" type="submit">Sync D1 into Resend lists</button>
          </form>
        </section>
        <section class="panel">
          <h2>Sending domain</h2>
          <ul>${domains}</ul>
          <h2 style="margin-top:1rem;">Lists</h2>
          <ul>${segs}</ul>
        </section>
      </div>
      <h2>Last 7 days</h2>
      <div style="margin:0.8rem 0 1.2rem;">${metricGrid(data.totals)}</div>
      <section class="panel" style="overflow:auto;">
        <h2>Recent campaigns</h2>
        <table>
          <thead><tr><th>Campaign</th><th>Status</th><th>When</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
    `,
  });
}

export function adminMarketingCampaigns(
  base: string,
  user: Person,
  data: {
    segments: Segment[];
    topics: Topic[];
    templates: Template[];
    broadcasts: Broadcast[];
    from: string;
    note: string;
    error: string;
  },
): string {
  const segOpts = data.segments.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
  const topicOpts = `<option value="">All subscribed in list</option>${data.topics
    .map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name || t.id)}</option>`)
    .join('')}`;
  const tplOpts = `<option value="">Write from scratch</option>${data.templates
    .map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name || t.id)}${t.published === false ? ' (draft)' : ''}</option>`)
    .join('')}`;
  const rows = data.broadcasts.length
    ? data.broadcasts
        .map(
          (b) => `<tr>
            <td><a href="${base}/marketing/campaigns/${escapeHtml(b.id)}">${escapeHtml(b.name || b.subject || 'Untitled')}</a></td>
            <td>${escapeHtml(b.subject || '-')}</td>
            <td>${escapeHtml(b.status || '-')}</td>
            <td>${escapeHtml((b.sent_at || b.scheduled_at || b.created_at || '-').slice(0, 16))}</td>
            <td>
              <form method="post" action="${base}/marketing/campaigns/${escapeHtml(b.id)}" class="row">
                ${b.status === 'draft' ? '<button class="btn" name="action" value="send" type="submit" onclick="return confirm(\'Send this campaign to the whole list?\')">Send</button>' : ''}
                ${b.status === 'scheduled' || b.status === 'queued' ? '<button class="btn ghost" name="action" value="cancel" type="submit">Cancel</button>' : ''}
                <button class="btn ghost" name="action" value="duplicate" type="submit">Duplicate</button>
                ${b.status === 'draft' ? '<button class="btn ghost" name="action" value="delete" type="submit">Delete</button>' : ''}
              </form>
            </td>
          </tr>`,
        )
        .join('')
    : `<tr><td colspan="5" class="empty">No campaigns yet.</td></tr>`;
  return shell({
    title: 'Campaigns | SIO Admin',
    base,
    kind: 'admin',
    path: '/marketing/campaigns',
    user,
    wide: true,
    body: `
      <h1 class="display" style="font-size:3rem;line-height:0.9;">Campaigns</h1>
      ${marketingTabs(base, '/marketing/campaigns')}
      ${noteBlock(data.note, data.error)}
      <form class="panel stack" method="post" action="${base}/marketing/campaigns" style="margin-bottom:1.2rem;">
        <div class="grid two">
          <div><label for="name">Internal name</label><input id="name" name="name" placeholder="Founding week 1" /></div>
          <div><label for="segment_id">List</label><select id="segment_id" name="segment_id" required>${segOpts}</select></div>
        </div>
        <div class="grid two">
          <div><label for="from">From</label><input id="from" name="from" value="${escapeHtml(data.from)}" required /></div>
          <div><label for="reply_to">Reply-to</label><input id="reply_to" name="reply_to" placeholder="mike@stickitoutdrums.com" /></div>
        </div>
        <div class="grid two">
          <div><label for="topic_id">Topic</label><select id="topic_id" name="topic_id">${topicOpts}</select></div>
          <div><label for="template_id">Template</label><select id="template_id" name="template_id">${tplOpts}</select></div>
        </div>
        <div><label for="subject">Subject</label><input id="subject" name="subject" required placeholder="Hey {{{contact.first_name|there}}}" /></div>
        <div>
          <label for="html">HTML</label>
          <textarea id="html" name="html" class="tall" placeholder="<p>Hey {{{contact.first_name|there}}},</p>"></textarea>
        </div>
        <div>
          <label for="text">Plain text (used if HTML is empty)</label>
          <textarea id="text" name="text" placeholder="Hey {{{contact.first_name|there}}},"></textarea>
        </div>
        <div><label for="scheduled_at">Schedule (optional, local time)</label><input id="scheduled_at" name="scheduled_at" type="datetime-local" /></div>
        <label class="check">
          <input type="checkbox" name="confirm" value="SEND" />
          <span>I understand this emails the whole list. Required for Send now / Schedule.</span>
        </label>
        <div class="row">
          <button class="btn ghost" name="intent" value="draft" type="submit">Save draft</button>
          <button class="btn ghost" name="intent" value="schedule" type="submit">Schedule</button>
          <button class="btn" name="intent" value="send" type="submit">Send now</button>
        </div>
        <p class="muted">Always includes {{{RESEND_UNSUBSCRIBE_URL}}} if you leave it out. Personalize with {{{contact.first_name|there}}}.</p>
      </form>
      <section class="panel" style="overflow:auto;">
        <table>
          <thead><tr><th>Name</th><th>Subject</th><th>Status</th><th>When</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
    `,
  });
}

export function adminMarketingCampaignDetail(
  base: string,
  user: Person,
  data: {
    broadcast: Broadcast;
    totals: MetricsTotals | null;
    note: string;
    error: string;
  },
): string {
  const b = data.broadcast;
  return shell({
    title: `${b.name || b.subject || 'Campaign'} | SIO Admin`,
    base,
    kind: 'admin',
    path: '/marketing/campaigns',
    user,
    wide: true,
    body: `
      <h1 class="display" style="font-size:3rem;line-height:0.9;">${escapeHtml(b.name || b.subject || 'Campaign')}</h1>
      ${marketingTabs(base, '/marketing/campaigns')}
      ${noteBlock(data.note, data.error)}
      <p class="muted">${escapeHtml(b.status || 'unknown')} · ${escapeHtml(b.from || '')}</p>
      <p><strong>${escapeHtml(b.subject || '')}</strong></p>
      <div style="margin:1rem 0;">${metricGrid(data.totals)}</div>
      <form method="post" action="${base}/marketing/campaigns/${escapeHtml(b.id)}" class="row" style="margin:1rem 0;">
        ${b.status === 'draft' ? '<button class="btn" name="action" value="send" type="submit" onclick="return confirm(\'Send this campaign to the whole list?\')">Send now</button>' : ''}
        ${b.status === 'scheduled' || b.status === 'queued' ? '<button class="btn ghost" name="action" value="cancel" type="submit">Cancel</button>' : ''}
        <button class="btn ghost" name="action" value="duplicate" type="submit">Duplicate</button>
        ${b.status === 'draft' ? '<button class="btn ghost" name="action" value="delete" type="submit">Delete</button>' : ''}
      </form>
      <section class="panel"><h2>HTML</h2><div class="pre">${escapeHtml(b.html || b.text || '')}</div></section>
    `,
  });
}

export function adminMarketingLists(
  base: string,
  user: Person,
  data: {
    segments: Segment[];
    contacts: Contact[];
    selected?: string;
    note: string;
    error: string;
  },
): string {
  const segs = data.segments.length
    ? data.segments
        .map(
          (s) => `<li><a href="${base}/marketing/lists?segment=${escapeHtml(s.id)}">${escapeHtml(s.name)}</a></li>`,
        )
        .join('')
    : '<li class="muted">No lists yet.</li>';
  const rows = data.contacts.length
    ? data.contacts
        .map(
          (c) => `<tr>
            <td>${escapeHtml(c.first_name || '')} ${escapeHtml(c.last_name || '')}</td>
            <td>${escapeHtml(c.email)}</td>
            <td>${c.unsubscribed ? 'unsubscribed' : 'subscribed'}</td>
          </tr>`,
        )
        .join('')
    : `<tr><td colspan="3" class="empty">No contacts loaded. Sync from Overview or add one below.</td></tr>`;
  return shell({
    title: 'Lists | SIO Admin',
    base,
    kind: 'admin',
    path: '/marketing/lists',
    user,
    wide: true,
    body: `
      <h1 class="display" style="font-size:3rem;line-height:0.9;">Lists</h1>
      ${marketingTabs(base, '/marketing/lists')}
      ${noteBlock(data.note, data.error)}
      <div class="grid two">
        <section class="panel stack">
          <h2>Segments</h2>
          <ul>${segs}</ul>
          <form method="post" action="${base}/marketing/lists" class="stack">
            <input type="hidden" name="action" value="create_segment" />
            <div><label for="name">New list</label><input id="name" name="name" required placeholder="SIO Nashville" /></div>
            <button class="btn" type="submit">Create list</button>
          </form>
        </section>
        <section class="panel stack">
          <h2>Add contact</h2>
          <form method="post" action="${base}/marketing/lists" class="stack">
            <input type="hidden" name="action" value="create_contact" />
            <div><label for="email">Email</label><input id="email" name="email" type="email" required /></div>
            <div><label for="first_name">First name</label><input id="first_name" name="first_name" /></div>
            <div><label for="last_name">Last name</label><input id="last_name" name="last_name" /></div>
            <div><label for="segment_id">List</label>
              <select id="segment_id" name="segment_id">
                <option value="">None</option>
                ${data.segments.map((s) => `<option value="${escapeHtml(s.id)}" ${data.selected === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
              </select>
            </div>
            <button class="btn" type="submit">Add contact</button>
          </form>
        </section>
      </div>
      <section class="panel" style="overflow:auto;margin-top:1rem;">
        <h2>Contacts</h2>
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
    `,
  });
}

export function adminMarketingTemplates(
  base: string,
  user: Person,
  data: { templates: Template[]; from: string; note: string; error: string },
): string {
  const list = data.templates.length
    ? data.templates
        .map(
          (t) => `<article class="panel stack">
            <h2>${escapeHtml(t.name || t.id)}</h2>
            <p class="muted">${escapeHtml(t.alias || '')} · ${t.published === false ? 'draft' : t.status || 'published'}</p>
            <form method="post" action="${base}/marketing/templates/${escapeHtml(t.id)}" class="row">
              ${t.published === false ? '<button class="btn" name="action" value="publish" type="submit">Publish</button>' : ''}
              <button class="btn ghost" name="action" value="duplicate" type="submit">Duplicate</button>
              <button class="btn ghost" name="action" value="delete" type="submit">Delete</button>
            </form>
          </article>`,
        )
        .join('')
    : '<p class="empty">No templates yet.</p>';
  return shell({
    title: 'Templates | SIO Admin',
    base,
    kind: 'admin',
    path: '/marketing/templates',
    user,
    wide: true,
    body: `
      <h1 class="display" style="font-size:3rem;line-height:0.9;">Templates</h1>
      ${marketingTabs(base, '/marketing/templates')}
      ${noteBlock(data.note, data.error)}
      <form class="panel stack" method="post" action="${base}/marketing/templates">
        <div class="grid two">
          <div><label for="name">Name</label><input id="name" name="name" required /></div>
          <div><label for="alias">Alias</label><input id="alias" name="alias" placeholder="waitlist-welcome" /></div>
        </div>
        <div><label for="subject">Default subject</label><input id="subject" name="subject" /></div>
        <div><label for="from">From</label><input id="from" name="from" value="${escapeHtml(data.from)}" /></div>
        <div><label for="html">HTML</label><textarea id="html" name="html" class="tall" required></textarea></div>
        <button class="btn" type="submit">Create template</button>
      </form>
      <div class="stack" style="margin-top:1rem;">${list}</div>
    `,
  });
}

export function adminMarketingTopics(
  base: string,
  user: Person,
  data: { topics: Topic[]; note: string; error: string },
): string {
  const list = data.topics.length
    ? data.topics
        .map(
          (t) => `<article class="panel stack">
            <h2>${escapeHtml(t.name || t.id)}</h2>
            <p class="muted">${escapeHtml(t.description || '')} · ${escapeHtml(t.default_subscription || '')} · ${escapeHtml(t.visibility || '')}</p>
            <form method="post" action="${base}/marketing/topics/${escapeHtml(t.id)}">
              <button class="btn ghost" name="action" value="delete" type="submit">Delete</button>
            </form>
          </article>`,
        )
        .join('')
    : '<p class="empty">No topics yet. Create Waitlist, Founding, Practice notes.</p>';
  return shell({
    title: 'Topics | SIO Admin',
    base,
    kind: 'admin',
    path: '/marketing/topics',
    user,
    wide: true,
    body: `
      <h1 class="display" style="font-size:3rem;line-height:0.9;">Topics</h1>
      ${marketingTabs(base, '/marketing/topics')}
      ${noteBlock(data.note, data.error)}
      <form class="panel stack" method="post" action="${base}/marketing/topics">
        <div><label for="name">Name</label><input id="name" name="name" required maxlength="50" placeholder="Waitlist updates" /></div>
        <div><label for="description">Description</label><input id="description" name="description" maxlength="200" /></div>
        <div class="grid two">
          <div>
            <label for="default_subscription">Default</label>
            <select id="default_subscription" name="default_subscription">
              <option value="opt_in">opt in</option>
              <option value="opt_out">opt out</option>
            </select>
          </div>
          <div>
            <label for="visibility">Unsubscribe page</label>
            <select id="visibility" name="visibility">
              <option value="public">public</option>
              <option value="private">private</option>
            </select>
          </div>
        </div>
        <button class="btn" type="submit">Create topic</button>
      </form>
      <div class="stack" style="margin-top:1rem;">${list}</div>
    `,
  });
}

export function adminMarketingSuppressions(
  base: string,
  user: Person,
  data: { items: Suppression[]; note: string; error: string },
): string {
  const rows = data.items.length
    ? data.items
        .map(
          (s) => `<tr>
            <td>${escapeHtml(s.email || '')}</td>
            <td>${escapeHtml(s.reason || s.origin || '-')}</td>
            <td>${escapeHtml((s.created_at || '').slice(0, 16))}</td>
            <td>
              <form method="post" action="${base}/marketing/suppressions/${encodeURIComponent(s.id || s.email || '')}">
                <button class="btn ghost" type="submit">Remove</button>
              </form>
            </td>
          </tr>`,
        )
        .join('')
    : `<tr><td colspan="4" class="empty">No suppressions.</td></tr>`;
  return shell({
    title: 'Suppressions | SIO Admin',
    base,
    kind: 'admin',
    path: '/marketing/suppressions',
    user,
    wide: true,
    body: `
      <h1 class="display" style="font-size:3rem;line-height:0.9;">Suppressions</h1>
      ${marketingTabs(base, '/marketing/suppressions')}
      ${noteBlock(data.note, data.error)}
      <form class="panel stack" method="post" action="${base}/marketing/suppressions">
        <div><label for="email">Email</label><input id="email" name="email" type="email" required /></div>
        <button class="btn" type="submit">Add suppression</button>
      </form>
      <section class="panel" style="overflow:auto;margin-top:1rem;">
        <table>
          <thead><tr><th>Email</th><th>Reason</th><th>When</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
    `,
  });
}

export function adminMarketingTest(
  base: string,
  user: Person,
  data: { from: string; note: string; error: string },
): string {
  return shell({
    title: 'Test send | SIO Admin',
    base,
    kind: 'admin',
    path: '/marketing/test',
    user,
    wide: true,
    body: `
      <h1 class="display" style="font-size:3rem;line-height:0.9;">Test send</h1>
      ${marketingTabs(base, '/marketing/test')}
      ${noteBlock(data.note, data.error)}
      <form class="panel stack" method="post" action="${base}/marketing/test">
        <div><label for="to">To</label><input id="to" name="to" type="email" required value="${escapeHtml(user.email)}" /></div>
        <div><label for="from">From</label><input id="from" name="from" value="${escapeHtml(data.from)}" required /></div>
        <div><label for="subject">Subject</label><input id="subject" name="subject" required value="SIO test" /></div>
        <div><label for="html">HTML</label><textarea id="html" name="html" class="tall"><p>Hey {{{contact.first_name|there}}}, this is a Stick It Out test.</p></textarea></div>
        <button class="btn" type="submit">Send one email</button>
      </form>
      <p class="muted">This uses Resend emails, not a broadcast. Safe for checking DNS and the from-address.</p>
    `,
  });
}

export function forbidden(base: string): string {
  return shell({
    title: 'No access | SIO Admin',
    base,
    kind: 'admin',
    path: '/login',
    body: `<h1 class="display" style="font-size:3rem;">No access</h1><p class="muted" style="margin-top:1rem;">This admin is locked to an allowlist.</p><p style="margin-top:1.2rem;"><a class="btn" href="${base}/login">Log in</a></p>`,
  });
}
