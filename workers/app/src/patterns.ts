import { nowIso, type Person } from './auth';
import { allowedTiers, type Tier } from './access';
import { denverDay, shiftDay, touchStreak, type Milestone } from './streaks';

export type Discipline = 'hands' | 'feet' | 'four-limb';
export type Level = 'beginner' | 'intermediate' | 'advanced';

export type Pattern = {
  id: string;
  slug: string;
  title: string;
  discipline: string;
  family: string;
  level: string;
  sticking: string;
  vex_notes: string | null;
  vex_feet: string | null;
  bpm_start: number;
  bpm_goal: number;
  tier: string;
  sort_index: number;
  notes: string;
};

export type PatternWithProgress = Pattern & {
  best_bpm: number | null;
  medal: string;
  legend_sessions: number;
  sessions: number;
  last_practiced_at: string | null;
};

export type Medal = {
  id: string;
  label: string;
  /** Share of bpm_goal needed to earn it. */
  at: number;
};

/** Every medal needs a clean run held at least this long at that tempo. */
export const HOLD_SECONDS = 30;

/**
 * Singles set the scale: Diamond 190, Legendary 200, Insanity 220 BPM, each held
 * clean for HOLD_SECONDS. Every pattern's bpm_goal is its Diamond tempo, so the
 * tiers above Diamond keep the same ratio to it as singles do.
 */
export const ANCHOR_DIAMOND_BPM = 190;

/** Dirt to Insanity, in order. */
export const MEDALS: Medal[] = [
  { id: 'dirt', label: 'Dirt', at: 0 },
  { id: 'bronze', label: 'Bronze', at: 0.5 },
  { id: 'silver', label: 'Silver', at: 0.65 },
  { id: 'gold', label: 'Gold', at: 0.8 },
  { id: 'platinum', label: 'Platinum', at: 0.92 },
  { id: 'diamond', label: 'Diamond', at: 1 },
  { id: 'legendary', label: 'Legendary', at: 200 / ANCHOR_DIAMOND_BPM },
  { id: 'insanity', label: 'Insanity', at: 220 / ANCHOR_DIAMOND_BPM },
];

/** Tiers that shine: Diamond and up. */
export const TOP_MEDALS = new Set(['diamond', 'legendary', 'insanity']);

export const DISCIPLINES: { id: Discipline; label: string }[] = [
  { id: 'hands', label: 'Hands' },
  { id: 'feet', label: 'Feet' },
  { id: 'four-limb', label: 'Four-limb' },
];

export const LEVELS: Level[] = ['beginner', 'intermediate', 'advanced'];

export function medalLabel(id: string): string {
  return MEDALS.find((m) => m.id === id)?.label || 'Dirt';
}

export function medalIndex(id: string): number {
  const i = MEDALS.findIndex((m) => m.id === id);
  return i < 0 ? 0 : i;
}

/** Every shown or required tempo sits on a 10. Rounds up; values already on a 10 stay. */
export function ceilTo10(bpm: number): number {
  if (!Number.isFinite(bpm) || bpm <= 0) return 0;
  return Math.ceil((bpm - 1e-6) / 10) * 10;
}

/** BPM needed for a medal on a pattern whose Diamond tempo is goalBpm, rounded up to a 10. */
export function medalTarget(goalBpm: number, id: string): number {
  const goal = goalBpm > 0 ? goalBpm : 120;
  return ceilTo10(goal * (MEDALS[medalIndex(id)]?.at || 0));
}

export function isDiscipline(value: string): value is Discipline {
  return value === 'hands' || value === 'feet' || value === 'four-limb';
}

export type PracticeTab = 'rudiments' | 'drills';

export const PRACTICE_TABS: { id: PracticeTab; label: string }[] = [
  { id: 'rudiments', label: 'Rudiments' },
  { id: 'drills', label: 'Hand fill drills' },
];

export function practiceTabFromQuery(params: URLSearchParams): PracticeTab {
  const tab = (params.get('tab') || '').trim();
  if (tab === 'drills' || tab === 'rudiments') return tab;
  const discipline = (params.get('d') || '').trim();
  if (discipline === 'four-limb') return 'drills';
  return 'rudiments';
}

export function disciplinesForTab(tab: PracticeTab): Discipline[] {
  return tab === 'drills' ? ['four-limb'] : ['hands'];
}

export function tabForDiscipline(discipline: string): PracticeTab {
  return discipline === 'four-limb' ? 'drills' : 'rudiments';
}

/** Highest medal whose tempo the best held BPM reaches. */
export function medalFor(bestBpm: number | null, goalBpm: number): string {
  const best = bestBpm || 0;
  if (best <= 0) return 'dirt';
  let earned = 'dirt';
  for (const medal of MEDALS) {
    if (medal.at > 0 && best >= medalTarget(goalBpm, medal.id)) earned = medal.id;
  }
  return earned;
}

/** Tempo the metronome opens at: the floor of the member's current band. */
export function bandStartBpm(medal: string, pattern: Pick<Pattern, 'bpm_start' | 'bpm_goal'>): number {
  const start = ceilTo10(pattern.bpm_start);
  const banded = medalTarget(pattern.bpm_goal, medal);
  return Math.max(start, banded || start);
}

export function nextTargetBpm(medal: string, pattern: Pick<Pattern, 'bpm_start' | 'bpm_goal'>): number {
  const next = MEDALS[Math.min(medalIndex(medal) + 1, MEDALS.length - 1)];
  return Math.max(ceilTo10(pattern.bpm_start), medalTarget(pattern.bpm_goal, next.id));
}

const PATTERN_COLS = `p.id, p.slug, p.title, p.discipline, p.family, p.level, p.sticking, p.vex_notes, p.vex_feet,
  p.bpm_start, p.bpm_goal, p.tier, p.sort_index, p.notes`;

const PROGRESS_COLS = `IFNULL(pr.best_bpm, NULL) AS best_bpm, IFNULL(pr.medal, 'dirt') AS medal,
  IFNULL(pr.legend_sessions, 0) AS legend_sessions, IFNULL(pr.sessions, 0) AS sessions, pr.last_practiced_at`;

export async function listPatterns(
  db: D1Database,
  personId: string,
  discipline?: string | Discipline[],
): Promise<PatternWithProgress[]> {
  const list = (Array.isArray(discipline) ? discipline : discipline ? [discipline] : []).filter(isDiscipline);
  const where = list.length ? `WHERE p.discipline IN (${list.map(() => '?').join(', ')})` : '';
  const sql = `SELECT ${PATTERN_COLS}, ${PROGRESS_COLS}
     FROM patterns p
     LEFT JOIN pattern_progress pr ON pr.pattern_id = p.id AND pr.person_id = ?
     ${where}
     ORDER BY p.sort_index ASC, p.title ASC`;
  const stmt = db.prepare(sql);
  const bound = list.length ? stmt.bind(personId, ...list) : stmt.bind(personId);
  const { results } = await bound.all<PatternWithProgress>();
  return results || [];
}

export async function patternBySlug(
  db: D1Database,
  personId: string,
  slug: string,
): Promise<PatternWithProgress | null> {
  const row = await db
    .prepare(
      `SELECT ${PATTERN_COLS}, ${PROGRESS_COLS}
       FROM patterns p
       LEFT JOIN pattern_progress pr ON pr.pattern_id = p.id AND pr.person_id = ?
       WHERE p.slug = ?`,
    )
    .bind(personId, slug)
    .first<PatternWithProgress>();
  return row || null;
}

export type SessionRow = { id: string; bpm: number | null; seconds: number; clean: number; at: string };

export async function recentSessions(
  db: D1Database,
  personId: string,
  patternId: string,
  limit = 8,
): Promise<SessionRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, bpm, seconds, clean, at FROM pattern_sessions
       WHERE person_id = ? AND pattern_id = ?
       ORDER BY at DESC LIMIT ?`,
    )
    .bind(personId, patternId, limit)
    .all<SessionRow>();
  return results || [];
}

/** One practice day: total time on the kit and the best clean tempo held that day. */
export type PracticeDay = { day: string; seconds: number; bestClean: number | null };

/**
 * What Home shows under "Since you were here": the last session, this week
 * against last week, and the daily bars. All of it comes from pattern_sessions,
 * so nothing new is stored. Days are the same substr(at, 1, 10) buckets the
 * streak strip already uses.
 */
export type PracticeEvidence = {
  last: { title: string; slug: string; bpm: number | null; seconds: number; clean: boolean; day: string } | null;
  days: PracticeDay[];
  thisWeek: { seconds: number; bestClean: number | null };
  lastWeek: { seconds: number; bestClean: number | null };
};

type EvidenceDayRow = { day: string; seconds: number | null; best_clean: number | null };
type LastSessionRow = { title: string; slug: string; bpm: number | null; seconds: number; clean: number; at: string };

function emptyWeek(): { seconds: number; bestClean: number | null } {
  return { seconds: 0, bestClean: null };
}

export async function practiceEvidence(
  db: D1Database,
  personId: string,
  today = denverDay(),
): Promise<PracticeEvidence> {
  const since = shiftDay(today, -13);
  const [dayRows, lastRow] = await Promise.all([
    db
      .prepare(
        `SELECT substr(at, 1, 10) AS day,
                SUM(IFNULL(seconds, 0)) AS seconds,
                MAX(CASE WHEN clean = 1 THEN bpm END) AS best_clean
         FROM pattern_sessions
         WHERE person_id = ? AND substr(at, 1, 10) >= ?
         GROUP BY day
         ORDER BY day ASC`,
      )
      .bind(personId, since)
      .all<EvidenceDayRow>(),
    db
      .prepare(
        `SELECT p.title AS title, p.slug AS slug, s.bpm AS bpm, s.seconds AS seconds, s.clean AS clean, s.at AS at
         FROM pattern_sessions s
         JOIN patterns p ON p.id = s.pattern_id
         WHERE s.person_id = ?
         ORDER BY s.at DESC
         LIMIT 1`,
      )
      .bind(personId)
      .first<LastSessionRow>(),
  ]);

  const byDay = new Map<string, PracticeDay>();
  for (const row of dayRows.results || []) {
    byDay.set(row.day, { day: row.day, seconds: Number(row.seconds || 0), bestClean: row.best_clean ?? null });
  }
  const days: PracticeDay[] = [];
  for (let i = 13; i >= 0; i -= 1) {
    const day = shiftDay(today, -i);
    days.push(byDay.get(day) || { day, seconds: 0, bestClean: null });
  }

  const roll = (slice: PracticeDay[]) =>
    slice.reduce(
      (acc, d) => ({
        seconds: acc.seconds + d.seconds,
        bestClean: d.bestClean != null ? Math.max(acc.bestClean ?? 0, d.bestClean) : acc.bestClean,
      }),
      emptyWeek(),
    );

  return {
    last: lastRow
      ? {
          title: lastRow.title,
          slug: lastRow.slug,
          bpm: lastRow.bpm ?? null,
          seconds: Number(lastRow.seconds || 0),
          clean: lastRow.clean === 1,
          day: lastRow.at.slice(0, 10),
        }
      : null,
    days,
    thisWeek: roll(days.slice(7)),
    lastWeek: roll(days.slice(0, 7)),
  };
}

export type LoggedSession = {
  medal: string;
  medalChanged: boolean;
  /** Clean and held for HOLD_SECONDS, so it counted toward medals. */
  counted: boolean;
  bestBpm: number;
  unlocked: Milestone[];
};

/**
 * Record one practice session: store it, recompute the medal, mirror into
 * practice_logs for the admin CRM, close out the daily pick, credit the streak.
 */
export async function logSession(
  env: Env,
  person: Pick<Person, 'id'>,
  pattern: PatternWithProgress,
  input: { bpm: number; seconds: number; clean: boolean },
): Promise<LoggedSession> {
  const db = env.DB;
  const at = nowIso();
  const bpm = Number.isFinite(input.bpm) && input.bpm > 0 ? input.bpm : 0;
  const seconds = Number.isFinite(input.seconds) && input.seconds > 0 ? Math.min(input.seconds, 7200) : 0;
  const clean = input.clean ? 1 : 0;

  await db
    .prepare(
      'INSERT INTO pattern_sessions (id, person_id, pattern_id, bpm, seconds, clean, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(crypto.randomUUID(), person.id, pattern.id, bpm || null, seconds, clean, at)
    .run();

  const counted = clean === 1 && seconds >= HOLD_SECONDS;
  const prevBest = pattern.best_bpm || 0;
  const bestBpm = Math.max(prevBest, counted ? bpm : 0);
  const goal = pattern.bpm_goal > 0 ? pattern.bpm_goal : 120;
  const hitGoal = counted && bpm >= medalTarget(goal, 'diamond');
  const legendSessions = (pattern.legend_sessions || 0) + (hitGoal ? 1 : 0);
  const medal = medalFor(bestBpm, goal);

  await db
    .prepare(
      `INSERT INTO pattern_progress
         (person_id, pattern_id, best_bpm, medal, legend_sessions, sessions, last_practiced_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(person_id, pattern_id) DO UPDATE SET
         best_bpm = excluded.best_bpm,
         medal = excluded.medal,
         legend_sessions = excluded.legend_sessions,
         sessions = pattern_progress.sessions + 1,
         last_practiced_at = excluded.last_practiced_at`,
    )
    .bind(person.id, pattern.id, bestBpm || null, medal, legendSessions, at)
    .run();

  await db
    .prepare('INSERT INTO practice_logs (id, person_id, lesson_id, bpm, notes, at) VALUES (?, ?, NULL, ?, ?, ?)')
    .bind(crypto.randomUUID(), person.id, bpm || null, `${pattern.title} · ${clean ? 'clean' : 'rough'}`, at)
    .run();

  const today = denverDay();
  await db
    .prepare('UPDATE daily_pattern_picks SET completed_at = ? WHERE person_id = ? AND day = ? AND pattern_id = ?')
    .bind(at, person.id, today, pattern.id)
    .run();

  const touched = await touchStreak(db, person.id);

  return { medal, medalChanged: medal !== (pattern.medal || 'dirt'), counted, bestBpm, unlocked: touched.unlocked };
}

export type DailyPick = { pattern: PatternWithProgress; completed_at: string | null };

/** Pattern catalog levels a playing level is ready for. Pro uses the full hands set. */
export function levelsForPlayer(playing: string | undefined): Level[] {
  if (playing === 'intermediate') return ['beginner', 'intermediate'];
  if (playing === 'advanced' || playing === 'pro') return ['beginner', 'intermediate', 'advanced'];
  return ['beginner'];
}

/** Mean medal rank (dirt 0 … insanity 7) across the level window. Unplayed counts as dirt. */
export function badgeAverage(patterns: PatternWithProgress[]): { score: number; medal: string } {
  if (!patterns.length) return { score: 0, medal: 'dirt' };
  const score = patterns.reduce((sum, p) => sum + medalIndex(p.medal || 'dirt'), 0) / patterns.length;
  const nearest = MEDALS[Math.min(MEDALS.length - 1, Math.max(0, Math.round(score)))];
  return { score, medal: nearest.id };
}

export type PracticePlan = {
  primary: DailyPick | null;
  alternates: PatternWithProgress[];
  window: PatternWithProgress[];
  score: { score: number; medal: string };
};

/** Hands rudiments inside the member's playing level, with progress. */
export async function levelWindow(db: D1Database, person: Person): Promise<PatternWithProgress[]> {
  const allowed = new Set(levelsForPlayer(person.level));
  const hands = await listPatterns(db, person.id, ['hands']);
  return hands.filter((p) => allowed.has(p.level as Level));
}

/**
 * Today's pattern plus the next two weakest. The primary pick is stored for the
 * Denver day so it does not change mid-session. Alternates are not stored.
 */
export async function practicePlan(db: D1Database, person: Person, day = denverDay()): Promise<PracticePlan> {
  const window = await levelWindow(db, person);
  const primary = await dailyPatternFor(db, person, day);
  const ranked = window.slice().sort((a, b) => {
    const medal = medalIndex(a.medal) - medalIndex(b.medal);
    if (medal) return medal;
    const sessions = (a.sessions || 0) - (b.sessions || 0);
    if (sessions) return sessions;
    return (a.last_practiced_at || '').localeCompare(b.last_practiced_at || '');
  });
  const alternates = ranked.filter((p) => p.id !== primary?.pattern.id).slice(0, 2);
  return { primary, alternates, window, score: badgeAverage(window) };
}

/**
 * Today's pattern. Admin override wins, otherwise the weakest hands rudiment in
 * the member's level window. Persisted so it holds all day.
 */
export async function dailyPatternFor(
  db: D1Database,
  person: Person,
  day = denverDay(),
): Promise<DailyPick | null> {
  const existing = await db
    .prepare('SELECT pattern_id, completed_at FROM daily_pattern_picks WHERE person_id = ? AND day = ?')
    .bind(person.id, day)
    .first<{ pattern_id: string; completed_at: string | null }>();
  if (existing) {
    const pattern = await patternById(db, person.id, existing.pattern_id);
    if (pattern) return { pattern, completed_at: existing.completed_at };
  }

  const tiers = allowedTiers(person);
  const override = await db
    .prepare('SELECT pattern_id FROM daily_pattern_override WHERE day = ?')
    .bind(day)
    .first<{ pattern_id: string }>();

  let chosen: PatternWithProgress | null = null;
  if (override) {
    chosen = await patternById(db, person.id, override.pattern_id);
  }
  const levels = levelsForPlayer(person.level);
  if (!chosen) {
    chosen = await pickWeakest(db, person.id, tiers, ['hands'], levels);
  }
  if (!chosen) {
    chosen = await pickWeakest(db, person.id, tiers, ['hands'], LEVELS);
  }
  if (!chosen) return null;

  await db
    .prepare(
      `INSERT INTO daily_pattern_picks (person_id, day, pattern_id, completed_at)
       VALUES (?, ?, ?, NULL)
       ON CONFLICT(person_id, day) DO NOTHING`,
    )
    .bind(person.id, day, chosen.id)
    .run();

  return { pattern: chosen, completed_at: null };
}

async function pickWeakest(
  db: D1Database,
  personId: string,
  tiers: Tier[],
  disciplines: Discipline[],
  levels: Level[],
): Promise<PatternWithProgress | null> {
  const tierMarks = tiers.map(() => '?').join(', ');
  const discMarks = disciplines.map(() => '?').join(', ');
  const levelMarks = levels.map(() => '?').join(', ');
  const row = await db
    .prepare(
      `SELECT ${PATTERN_COLS}, ${PROGRESS_COLS}
       FROM patterns p
       LEFT JOIN pattern_progress pr ON pr.pattern_id = p.id AND pr.person_id = ?
       WHERE p.tier IN (${tierMarks}) AND p.discipline IN (${discMarks}) AND p.level IN (${levelMarks})
       ORDER BY
         CASE IFNULL(pr.medal, 'dirt')
           WHEN 'dirt' THEN 0 WHEN 'bronze' THEN 1 WHEN 'silver' THEN 2
           WHEN 'gold' THEN 3 WHEN 'platinum' THEN 4 WHEN 'diamond' THEN 5
           WHEN 'legendary' THEN 6 WHEN 'insanity' THEN 7 ELSE 8 END ASC,
         IFNULL(pr.sessions, 0) ASC,
         IFNULL(pr.last_practiced_at, '') ASC,
         p.sort_index ASC
       LIMIT 1`,
    )
    .bind(personId, ...tiers, ...disciplines, ...levels)
    .first<PatternWithProgress>();
  return row || null;
}

export async function patternById(
  db: D1Database,
  personId: string,
  patternId: string,
): Promise<PatternWithProgress | null> {
  const row = await db
    .prepare(
      `SELECT ${PATTERN_COLS}, ${PROGRESS_COLS}
       FROM patterns p
       LEFT JOIN pattern_progress pr ON pr.pattern_id = p.id AND pr.person_id = ?
       WHERE p.id = ?`,
    )
    .bind(personId, patternId)
    .first<PatternWithProgress>();
  return row || null;
}

export type MedalTally = { medal: string; n: number };

export async function medalTally(db: D1Database, personId: string): Promise<MedalTally[]> {
  const { results } = await db
    .prepare('SELECT medal, COUNT(*) AS n FROM pattern_progress WHERE person_id = ? GROUP BY medal')
    .bind(personId)
    .all<MedalTally>();
  return results || [];
}

/** Admin catalog view, no per-person progress. */
export async function allPatterns(db: D1Database, discipline?: string): Promise<Pattern[]> {
  const where = discipline && isDiscipline(discipline) ? 'WHERE p.discipline = ?' : '';
  const stmt = db.prepare(
    `SELECT ${PATTERN_COLS} FROM patterns p ${where} ORDER BY p.discipline ASC, p.sort_index ASC`,
  );
  const { results } = where ? await stmt.bind(discipline).all<Pattern>() : await stmt.all<Pattern>();
  return results || [];
}

export async function setDailyOverride(
  db: D1Database,
  day: string,
  patternId: string,
  actor: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO daily_pattern_override (day, pattern_id, set_by, at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET pattern_id = excluded.pattern_id, set_by = excluded.set_by, at = excluded.at`,
    )
    .bind(day, patternId, actor, nowIso())
    .run();
  await db.prepare('DELETE FROM daily_pattern_picks WHERE day = ? AND completed_at IS NULL').bind(day).run();
}

export async function savePattern(
  db: D1Database,
  id: string,
  fields: {
    bpm_start: number;
    bpm_goal: number;
    tier: string;
    level: string;
    vex_notes: string;
    vex_feet: string;
    sticking: string;
    notes: string;
  },
): Promise<void> {
  const tier = ['free', 'member', 'pro'].includes(fields.tier) ? fields.tier : 'free';
  const level = LEVELS.includes(fields.level as Level) ? fields.level : 'beginner';
  await db
    .prepare(
      `UPDATE patterns SET bpm_start = ?, bpm_goal = ?, tier = ?, level = ?,
         vex_notes = ?, vex_feet = ?, sticking = ?, notes = ?
       WHERE id = ?`,
    )
    .bind(
      Math.max(30, Math.min(300, ceilTo10(fields.bpm_start || 60))),
      Math.max(40, Math.min(400, ceilTo10(fields.bpm_goal || 120))),
      tier,
      level,
      fields.vex_notes.trim() || null,
      fields.vex_feet.trim() || null,
      fields.sticking.trim(),
      fields.notes.trim().slice(0, 500),
      id,
    )
    .run();
}
