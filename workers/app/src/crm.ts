import {
  audit,
  createMagicLink,
  escapeHtml,
  html,
  nowIso,
  readForm,
  redirect,
  sendMagicEmail,
  type Person,
} from './auth';
import { attemptsForPerson } from './challenges';
import { adminMemberCrm } from './html';
import { isPlayingLevel } from './profile';
import { syncOnePersonToResend } from './resend';
import { streakState, type StreakState } from './streaks';

export type CrmNote = { id: string; actor: string; body: string; at: string };
export type CrmTag = { id: string; name: string };
export type CrmProgress = {
  lesson_id: string;
  title: string;
  week_index: number;
  watched_at: string | null;
  completed_at: string | null;
};
export type CrmPractice = {
  id: string;
  lesson_title: string | null;
  bpm: number | null;
  notes: string;
  at: string;
};
export type CrmAttempt = { title: string; notes: string; submitted_at: string; score: number | null };
export type CrmAudit = { actor: string; action: string; at: string };
export type CrmPattern = {
  title: string;
  discipline: string;
  medal: string;
  best_bpm: number | null;
  bpm_goal: number;
  sessions: number;
  last_practiced_at: string | null;
};

const PERSON_SQL = `SELECT p.id, p.email, p.name, p.created_at, p.phone, p.source, p.last_seen_at, p.kit, p.level, m.plan, m.status
  FROM people p LEFT JOIN memberships m ON m.person_id = p.id`;

export async function getPersonById(db: D1Database, id: string): Promise<Person | null> {
  const row = await db.prepare(`${PERSON_SQL} WHERE p.id = ?`).bind(id).first<Person>();
  return row || null;
}

export async function loadCrm(db: D1Database, id: string): Promise<{
  person: Person;
  notes: CrmNote[];
  tags: CrmTag[];
  allTags: CrmTag[];
  progress: CrmProgress[];
  practice: CrmPractice[];
  attempts: CrmAttempt[];
  audit: CrmAudit[];
  patterns: CrmPattern[];
  streak: StreakState;
} | null> {
  const person = await getPersonById(db, id);
  if (!person) return null;
  const [notes, tags, allTags, progress, practice, attempts, auditRows, patterns, streak] = await Promise.all([
    db.prepare('SELECT id, actor, body, at FROM crm_notes WHERE person_id = ? ORDER BY at DESC LIMIT 40').bind(id).all<CrmNote>(),
    db
      .prepare(
        `SELECT t.id, t.name FROM crm_tags t
         JOIN crm_person_tags pt ON pt.tag_id = t.id
         WHERE pt.person_id = ? ORDER BY t.name`,
      )
      .bind(id)
      .all<CrmTag>(),
    db.prepare('SELECT id, name FROM crm_tags ORDER BY name').all<CrmTag>(),
    db
      .prepare(
        `SELECT l.id AS lesson_id, l.title, l.week_index, lp.watched_at, lp.completed_at
         FROM lessons l
         LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.person_id = ?
         WHERE l.published_at IS NOT NULL
         ORDER BY l.week_index ASC`,
      )
      .bind(id)
      .all<CrmProgress>(),
    db
      .prepare(
        `SELECT pl.id, l.title AS lesson_title, pl.bpm, pl.notes, pl.at
         FROM practice_logs pl
         LEFT JOIN lessons l ON l.id = pl.lesson_id
         WHERE pl.person_id = ?
         ORDER BY pl.at DESC LIMIT 20`,
      )
      .bind(id)
      .all<CrmPractice>(),
    attemptsForPerson(db, id),
    db
      .prepare('SELECT actor, action, at FROM admin_audit WHERE action LIKE ? ORDER BY at DESC LIMIT 20')
      .bind(`%${id}%`)
      .all<CrmAudit>(),
    db
      .prepare(
        `SELECT pt.title, pt.discipline, pr.medal, pr.best_bpm, pt.bpm_goal, pr.sessions, pr.last_practiced_at
         FROM pattern_progress pr
         JOIN patterns pt ON pt.id = pr.pattern_id
         WHERE pr.person_id = ?
         ORDER BY pr.last_practiced_at DESC LIMIT 20`,
      )
      .bind(id)
      .all<CrmPattern>(),
    streakState(db, id),
  ]);
  return {
    person,
    notes: notes.results || [],
    tags: tags.results || [],
    allTags: allTags.results || [],
    progress: progress.results || [],
    practice: practice.results || [],
    attempts,
    audit: auditRows.results || [],
    patterns: patterns.results || [],
    streak,
  };
}

async function ensureTag(db: D1Database, name: string): Promise<string | null> {
  const clean = name.trim().toLowerCase().slice(0, 40);
  if (!clean) return null;
  const existing = await db.prepare('SELECT id FROM crm_tags WHERE name = ?').bind(clean).first<{ id: string }>();
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO crm_tags (id, name) VALUES (?, ?)').bind(id, clean).run();
  return id;
}

export async function setMembership(
  env: Env,
  personId: string,
  status: string,
  plan: string | null,
  actor: string,
): Promise<Person | null> {
  const nextStatus = ['waitlist', 'founding', 'active', 'canceled'].includes(status) ? status : 'waitlist';
  const nextPlan = plan === 'monthly' || plan === 'annual' ? plan : null;
  await env.DB.prepare('UPDATE memberships SET status = ?, plan = ? WHERE person_id = ?')
    .bind(nextStatus, nextPlan, personId)
    .run();
  await audit(env.DB, actor, `members.status ${personId} ${nextStatus} ${nextPlan || 'none'}`);
  const person = await getPersonById(env.DB, personId);
  if (person) {
    const mail = await syncOnePersonToResend(env, {
      email: person.email,
      name: person.name,
      status: person.status,
      plan: person.plan,
    });
    if (!mail.ok) console.log(JSON.stringify({ crm_resend_error: mail.error, email: person.email }));
    if (nextStatus === 'founding' || nextStatus === 'active') {
      const tagId = await ensureTag(env.DB, nextStatus);
      if (tagId) {
        await env.DB.prepare('INSERT OR IGNORE INTO crm_person_tags (person_id, tag_id) VALUES (?, ?)').bind(personId, tagId).run();
      }
    }
  }
  return person;
}

export async function crmFetch(
  request: Request,
  env: Env,
  base: string,
  admin: Person,
  personId: string,
): Promise<Response> {
  if (request.method === 'POST') {
    const body = await readForm(request);
    const action = body.action || 'status';
    const back = `${base}/members/${personId}`;

    if (action === 'status') {
      const person = await setMembership(env, personId, body.status, body.plan || null, admin.email);
      if (!person) return redirect(`${base}/members?n=${encodeURIComponent('Person not found.')}`);
      const dest = body.next === 'list' ? `${base}/members?n=${encodeURIComponent('Saved.')}` : `${back}?n=${encodeURIComponent('Status saved and synced to Resend.')}`;
      return redirect(dest);
    }

    if (action === 'profile') {
      const level = (body.level || '').trim();
      await env.DB.prepare('UPDATE people SET name = ?, phone = ?, source = ?, kit = ?, level = ? WHERE id = ?')
        .bind(
          (body.name || '').trim(),
          (body.phone || '').trim(),
          (body.source || '').trim(),
          (body.kit || '').trim(),
          isPlayingLevel(level) ? level : (body.level || '').trim(),
          personId,
        )
        .run();
      await audit(env.DB, admin.email, `members.profile ${personId}`);
      const person = await getPersonById(env.DB, personId);
      if (person) await syncOnePersonToResend(env, person);
      return redirect(`${back}?n=${encodeURIComponent('Profile saved.')}`);
    }

    if (action === 'note') {
      const text = (body.body || '').trim();
      if (!text) return redirect(`${back}?n=${encodeURIComponent('Note was empty.')}`);
      await env.DB.prepare('INSERT INTO crm_notes (id, person_id, actor, body, at) VALUES (?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), personId, admin.email, text.slice(0, 4000), nowIso())
        .run();
      await audit(env.DB, admin.email, `members.note ${personId}`);
      return redirect(`${back}?n=${encodeURIComponent('Note added.')}`);
    }

    if (action === 'tag') {
      const tagId = (await ensureTag(env.DB, body.tag || body.tag_id || '')) || body.tag_id;
      if (!tagId) return redirect(`${back}?n=${encodeURIComponent('Enter a tag.')}`);
      await env.DB.prepare('INSERT OR IGNORE INTO crm_person_tags (person_id, tag_id) VALUES (?, ?)').bind(personId, tagId).run();
      await audit(env.DB, admin.email, `members.tag ${personId}`);
      return redirect(`${back}?n=${encodeURIComponent('Tag added.')}`);
    }

    if (action === 'untag') {
      await env.DB.prepare('DELETE FROM crm_person_tags WHERE person_id = ? AND tag_id = ?').bind(personId, body.tag_id).run();
      return redirect(`${back}?n=${encodeURIComponent('Tag removed.')}`);
    }

    if (action === 'login') {
      const person = await getPersonById(env.DB, personId);
      if (!person) return redirect(`${base}/members?n=${encodeURIComponent('Person not found.')}`);
      const token = await createMagicLink(env.DB, person.email, 'member');
      const memberOrigin = env.MEMBER_ORIGIN.replace(/\/$/, '');
      const link = `${memberOrigin}/auth/callback?token=${token}`;
      const mail = await sendMagicEmail(env, person.email, link);
      await audit(env.DB, admin.email, `members.login ${person.email}`);
      const note = mail.ok
        ? `Login link sent to ${person.email}.`
        : env.DEV_LOG_LINKS === '1'
          ? `Mail not live. Link: ${link}`
          : 'Could not send mail yet.';
      return redirect(`${back}?n=${encodeURIComponent(note)}`);
    }

    if (action === 'resend') {
      const person = await getPersonById(env.DB, personId);
      if (!person) return redirect(`${base}/members?n=${encodeURIComponent('Person not found.')}`);
      const mail = await syncOnePersonToResend(env, person);
      await audit(env.DB, admin.email, `members.resend ${person.email}`);
      return redirect(`${back}?n=${encodeURIComponent(mail.ok ? 'Synced to Resend lists.' : `Resend: ${mail.error || 'failed'}`)}`);
    }

    return redirect(back);
  }

  const data = await loadCrm(env.DB, personId);
  if (!data) return html(`<p>Person not found. <a href="${escapeHtml(base)}/members">Back</a></p>`, 404);
  return html(adminMemberCrm(base, admin, data, new URL(request.url).searchParams.get('n') || ''));
}
