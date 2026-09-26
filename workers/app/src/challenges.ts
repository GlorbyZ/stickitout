import { nowIso } from './auth';

export type Challenge = {
  id: string;
  title: string;
  prompt: string;
  published_at: string | null;
};

export type Attempt = {
  challenge_id: string;
  person_id: string;
  name: string;
  notes: string;
  submitted_at: string;
  score: number | null;
  scored_at: string | null;
  scored_by: string | null;
};

export type BoardRow = {
  person_id: string;
  name: string;
  score: number;
  scored_at: string | null;
};

export async function liveChallenge(db: D1Database): Promise<Challenge | null> {
  return db
    .prepare('SELECT id, title, prompt, published_at FROM challenges WHERE published_at IS NOT NULL ORDER BY published_at DESC LIMIT 1')
    .first<Challenge>();
}

export async function leaderboard(db: D1Database, challengeId: string, limit = 50): Promise<BoardRow[]> {
  const { results } = await db
    .prepare(
      `SELECT a.person_id, CASE WHEN IFNULL(p.name, '') = '' THEN 'Member' ELSE p.name END AS name, a.score, a.scored_at
       FROM challenge_attempts a
       JOIN people p ON p.id = a.person_id
       WHERE a.challenge_id = ? AND a.score IS NOT NULL
       ORDER BY a.score DESC, a.scored_at ASC, a.submitted_at ASC
       LIMIT ?`,
    )
    .bind(challengeId, limit)
    .all<BoardRow>();
  return results || [];
}

export async function attemptFor(db: D1Database, challengeId: string, personId: string): Promise<Attempt | null> {
  return db
    .prepare(
      `SELECT a.challenge_id, a.person_id, CASE WHEN IFNULL(p.name, '') = '' THEN 'Member' ELSE p.name END AS name,
              a.notes, a.submitted_at, a.score, a.scored_at, a.scored_by
       FROM challenge_attempts a
       JOIN people p ON p.id = a.person_id
       WHERE a.challenge_id = ? AND a.person_id = ?`,
    )
    .bind(challengeId, personId)
    .first<Attempt>();
}

export async function upsertAttempt(db: D1Database, challengeId: string, personId: string, notes: string): Promise<void> {
  const at = nowIso();
  await db
    .prepare(
      `INSERT INTO challenge_attempts (challenge_id, person_id, notes, submitted_at, score, scored_at, scored_by)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL)
       ON CONFLICT(challenge_id, person_id) DO UPDATE SET
         notes = excluded.notes,
         submitted_at = excluded.submitted_at,
         score = NULL,
         scored_at = NULL,
         scored_by = NULL`,
    )
    .bind(challengeId, personId, notes.slice(0, 2000), at)
    .run();
}

export async function scoreAttempt(
  db: D1Database,
  challengeId: string,
  personId: string,
  score: number,
  actor: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE challenge_attempts SET score = ?, scored_at = ?, scored_by = ? WHERE challenge_id = ? AND person_id = ?`,
    )
    .bind(score, nowIso(), actor, challengeId, personId)
    .run();
}

export async function pendingCount(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM challenge_attempts WHERE score IS NULL')
    .first<{ n: number }>();
  return row?.n || 0;
}

export async function attemptsForChallenge(db: D1Database, challengeId: string): Promise<Attempt[]> {
  const { results } = await db
    .prepare(
      `SELECT a.challenge_id, a.person_id, CASE WHEN IFNULL(p.name, '') = '' THEN p.email ELSE p.name END AS name,
              a.notes, a.submitted_at, a.score, a.scored_at, a.scored_by
       FROM challenge_attempts a
       JOIN people p ON p.id = a.person_id
       WHERE a.challenge_id = ?
       ORDER BY CASE WHEN a.score IS NULL THEN 0 ELSE 1 END, a.submitted_at DESC`,
    )
    .bind(challengeId)
    .all<Attempt>();
  return results || [];
}

export async function attemptsForPerson(db: D1Database, personId: string): Promise<(Attempt & { title: string })[]> {
  const { results } = await db
    .prepare(
      `SELECT a.challenge_id, a.person_id, CASE WHEN IFNULL(p.name, '') = '' THEN 'Member' ELSE p.name END AS name,
              a.notes, a.submitted_at, a.score, a.scored_at, a.scored_by, c.title
       FROM challenge_attempts a
       JOIN people p ON p.id = a.person_id
       JOIN challenges c ON c.id = a.challenge_id
       WHERE a.person_id = ?
       ORDER BY a.submitted_at DESC`,
    )
    .bind(personId)
    .all<Attempt & { title: string }>();
  return results || [];
}

export async function loadChallengeStudio(db: D1Database): Promise<
  (Challenge & { attempts: Attempt[]; board: BoardRow[] })[]
> {
  const { results } = await db
    .prepare('SELECT id, title, prompt, published_at FROM challenges ORDER BY title ASC')
    .all<Challenge>();
  const items = results || [];
  return Promise.all(
    items.map(async (c) => ({
      ...c,
      attempts: await attemptsForChallenge(db, c.id),
      board: await leaderboard(db, c.id, 20),
    })),
  );
}
