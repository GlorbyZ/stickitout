import { nowIso } from './auth';

const ZONE = 'America/Denver';
const DAY_MS = 86400000;

export type Streak = {
  current_days: number;
  longest_days: number;
  total_days: number;
  last_day: string | null;
};

export type StreakState = Streak & {
  todayCredited: boolean;
  hoursLeft: number;
  atRisk: boolean;
  rewards: RewardBoard;
};

export type Milestone = {
  days: number;
  title: string;
  line: string;
};

/** Consecutive Denver days. Rewards stay after a miss; the next one uses the live streak. */
export const MILESTONES: Milestone[] = [
  { days: 3, title: 'Spark', line: 'Three days in a row. The habit has a pulse.' },
  { days: 7, title: 'Week', line: 'Seven straight. That is a real week.' },
  { days: 14, title: 'Groove', line: 'Two weeks. You stopped skipping.' },
  { days: 30, title: 'Month', line: 'Thirty days. This is how the kit changes.' },
  { days: 60, title: 'Iron', line: 'Sixty days. The streak is the practice.' },
  { days: 100, title: 'Century', line: 'One hundred days of showing up.' },
  { days: 365, title: 'Year', line: 'A year of days. That is the whole point.' },
];

export type RewardBoard = {
  earnedDays: number[];
  unseen: number;
  latest: Milestone | null;
  next: (Milestone & { left: number }) | null;
};

export function rewardFlash(unlocked: Milestone[]): string {
  if (!unlocked.length) return '';
  const top = unlocked[unlocked.length - 1];
  return ` ${top.title} reward. ${top.line}`;
}

/** Stable YYYY-MM-DD in the studio timezone. en-CA gives ISO order. */
export function denverDay(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function shiftDay(day: string, deltaDays: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const base = Date.UTC(y, (m || 1) - 1, d || 1);
  return denverDayFromUtcNoon(base + deltaDays * DAY_MS);
}

/** Day math runs on the calendar label, never on raw timestamps. */
function denverDayFromUtcNoon(ms: number): string {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function yesterdayOf(day: string): string {
  return shiftDay(day, -1);
}

/** Hours until local midnight in the studio timezone. */
export function hoursLeftToday(date: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || '0');
  const mins = 24 * 60 - (hour * 60 + minute);
  return Math.max(0, Math.round((mins / 60) * 10) / 10);
}

export async function getStreak(db: D1Database, personId: string): Promise<Streak> {
  const row = await db
    .prepare('SELECT current_days, longest_days, total_days, last_day FROM practice_streaks WHERE person_id = ?')
    .bind(personId)
    .first<Streak>();
  return row || { current_days: 0, longest_days: 0, total_days: 0, last_day: null };
}

export async function streakState(db: D1Database, personId: string): Promise<StreakState> {
  const streak = await getStreak(db, personId);
  const today = denverDay();
  const todayCredited = streak.last_day === today;
  const hoursLeft = hoursLeftToday();
  await grantRewards(db, personId, streak.longest_days);
  const rewards = await rewardBoard(db, personId, streak.current_days);
  return {
    ...streak,
    todayCredited,
    hoursLeft,
    atRisk: !todayCredited && hoursLeft <= 4,
    rewards,
  };
}

/** Insert any milestones the longest streak has already cleared. Returns the new ones. */
export async function grantRewards(db: D1Database, personId: string, longestDays: number): Promise<Milestone[]> {
  const due = MILESTONES.filter((m) => longestDays >= m.days);
  if (!due.length) return [];
  const { results } = await db
    .prepare('SELECT days FROM streak_rewards WHERE person_id = ?')
    .bind(personId)
    .all<{ days: number }>();
  const have = new Set((results || []).map((r) => r.days));
  const fresh = due.filter((m) => !have.has(m.days));
  if (!fresh.length) return [];
  const at = nowIso();
  await db.batch(
    fresh.map((m) =>
      db.prepare('INSERT OR IGNORE INTO streak_rewards (person_id, days, earned_at) VALUES (?, ?, ?)').bind(personId, m.days, at),
    ),
  );
  return fresh;
}

export async function rewardBoard(db: D1Database, personId: string, currentDays: number): Promise<RewardBoard> {
  const { results } = await db
    .prepare('SELECT days, seen_at FROM streak_rewards WHERE person_id = ? ORDER BY days ASC')
    .bind(personId)
    .all<{ days: number; seen_at: string | null }>();
  const rows = results || [];
  const earnedDays = rows.map((r) => r.days);
  const earned = new Set(earnedDays);
  const latest = [...MILESTONES].reverse().find((m) => earned.has(m.days)) || null;
  const upcoming = MILESTONES.find((m) => !earned.has(m.days)) || null;
  return {
    earnedDays,
    unseen: rows.filter((r) => !r.seen_at).length,
    latest,
    next: upcoming ? { ...upcoming, left: Math.max(0, upcoming.days - currentDays) } : null,
  };
}

export async function markRewardsSeen(db: D1Database, personId: string): Promise<void> {
  await db
    .prepare('UPDATE streak_rewards SET seen_at = ? WHERE person_id = ? AND seen_at IS NULL')
    .bind(nowIso(), personId)
    .run();
}

/**
 * Credit one practice day. Same day is a no-op, yesterday extends,
 * anything older restarts at 1.
 */
export async function touchStreak(db: D1Database, personId: string): Promise<Streak & { unlocked: Milestone[] }> {
  const today = denverDay();
  const streak = await getStreak(db, personId);
  if (streak.last_day === today) {
    return { ...streak, unlocked: [] };
  }

  const extends_ = streak.last_day === yesterdayOf(today);
  const current = extends_ ? streak.current_days + 1 : 1;
  const longest = Math.max(streak.longest_days, current);
  const total = streak.total_days + 1;

  await db
    .prepare(
      `INSERT INTO practice_streaks (person_id, current_days, longest_days, total_days, last_day)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(person_id) DO UPDATE SET
         current_days = excluded.current_days,
         longest_days = excluded.longest_days,
         total_days = excluded.total_days,
         last_day = excluded.last_day`,
    )
    .bind(personId, current, longest, total, today)
    .run();

  const unlocked = await grantRewards(db, personId, longest);
  return { current_days: current, longest_days: longest, total_days: total, last_day: today, unlocked };
}

/** Practice days in the trailing window, for the week strip on the portal. */
export async function recentPracticeDays(db: D1Database, personId: string, days = 7): Promise<string[]> {
  const since = shiftDay(denverDay(), -(days - 1));
  const { results } = await db
    .prepare(
      `SELECT DISTINCT substr(at, 1, 10) AS day
       FROM pattern_sessions
       WHERE person_id = ? AND substr(at, 1, 10) >= ?
       UNION
       SELECT DISTINCT substr(at, 1, 10) AS day
       FROM practice_logs
       WHERE person_id = ? AND substr(at, 1, 10) >= ?`,
    )
    .bind(personId, since, personId, since)
    .all<{ day: string }>();
  return (results || []).map((r) => r.day);
}

export function isoNow(): string {
  return nowIso();
}
