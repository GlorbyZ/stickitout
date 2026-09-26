import {
  accessEmail,
  adminEmails,
  audit,
  clearCookie,
  consumeMagicLink,
  cookie,
  createMagicLink,
  createSession,
  ensurePerson,
  getSessionPerson,
  html,
  nowIso,
  readForm,
  redirect,
  requestCtx,
  sendMagicEmail,
  slugify,
  touchLastSeen,
  type Person,
} from './auth';
import {
  adminChallenges,
  adminDash,
  adminFinancials,
  adminLessonDetail,
  adminLessons,
  adminMembers,
  adminPatterns,
  forbidden,
  loginPage,
  memberChallenges,
  memberHome,
  memberLibrary,
  memberProfile,
  memberRudimentDetail,
  memberRudiments,
  memberWatch,
  type AdminLesson,
  type MemberLesson,
} from './html';
import { canPractice, tierLocked } from './access';
import {
  allPatterns,
  bandStartBpm,
  dailyPatternFor,
  disciplinesForTab,
  HOLD_SECONDS,
  isDiscipline,
  listPatterns,
  practiceTabFromQuery,
  logSession,
  medalLabel,
  medalTally,
  nextTargetBpm,
  patternBySlug,
  recentSessions,
  savePattern,
  setDailyOverride,
} from './patterns';
import { denverDay, markRewardsSeen, recentPracticeDays, streakState, touchStreak } from './streaks';
import { ingestLeadFetch } from './leads';
import { marketingFetch } from './marketing';
import { resend, resendList, type Broadcast, type Domain, type MetricsTotals, type Segment } from './resend';
import { crmFetch } from './crm';
import {
  attemptFor,
  leaderboard,
  liveChallenge,
  loadChallengeStudio,
  pendingCount,
  scoreAttempt,
  upsertAttempt,
} from './challenges';
import { parseProfile, profileComplete, saveProfile } from './profile';
import {
  canWatch,
  ingestFromUrl,
  lessonPoster,
  probeStream,
  putLessonPoster,
  readLessonPoster,
  signedIframeSrc,
  startDirectUpload,
  videoDetails,
} from './stream';

const MEMBER_COOKIE = 'sio_member';
const ADMIN_COOKIE = 'sio_admin';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const originHeader = request.headers.get('Origin');
    if (originHeader) {
      const allowed = new Set([
        env.MEMBER_ORIGIN,
        env.ADMIN_ORIGIN,
        'https://stickitoutdrums.com',
        'https://www.stickitoutdrums.com',
        'https://stickitoutbook.com',
        'https://www.stickitoutbook.com',
        'http://127.0.0.1:8787',
        'http://localhost:8787',
        'http://127.0.0.1:4325',
        'http://localhost:4325',
      ]);
      let ok = allowed.has(originHeader);
      try {
        if (new URL(originHeader).hostname.endsWith('.workers.dev')) ok = true;
      } catch {
        ok = false;
      }
      if (!ok) {
        return new Response('Origin not allowed', { status: 403 });
      }
    }
    const ctx = requestCtx(request, env);
    if (ctx.path === '/api/health' && (request.method === 'GET' || request.method === 'HEAD')) return healthFetch(env);
    const brand = await serveBrandAsset(request, env, ctx.path);
    if (brand) return brand;
    try {
      if (ctx.kind === 'admin') return await adminFetch(request, env, ctx);
      return await memberFetch(request, env, ctx);
    } catch (err) {
      console.log(JSON.stringify({ error: String(err) }));
      return html('<p>Something broke. Try again.</p>', 500);
    }
  },
};

/** Public uptime check. No auth, no secrets. db is a boolean from a trivial D1 ping. */
async function healthFetch(env: Env): Promise<Response> {
  let db = false;
  try {
    db = (await env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>())?.ok === 1;
  } catch {
    db = false;
  }
  return new Response(JSON.stringify({ ok: true, db }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function memberFetch(request: Request, env: Env, ctx: ReturnType<typeof requestCtx>): Promise<Response> {
  const { base, path, origin } = ctx;

  if (path === '/api/leads') return ingestLeadFetch(request, env);

  const user = await getSessionPerson(env.DB, request, MEMBER_COOKIE);

  if (path === '/logout') {
    return redirect(`${base}/login`, { 'Set-Cookie': clearCookie(MEMBER_COOKIE, origin.startsWith('https')) });
  }

  if (path === '/auth/callback') {
    const token = ctx.url.searchParams.get('token') || '';
    const email = await consumeMagicLink(env.DB, token, 'member');
    if (!email) return html(loginPage(base, 'member', '', 'That link expired. Request a new one.'), 400);
    const person = await ensurePerson(env.DB, email);
    const raw = await createSession(env.DB, person.id);
    return redirect(`${base}/`, { 'Set-Cookie': cookie(MEMBER_COOKIE, raw, 30 * 86400, origin.startsWith('https')) });
  }

  if (path === '/login' && request.method === 'POST') {
    const body = await readForm(request);
    const email = (body.email || '').trim().toLowerCase();
    if (!email.includes('@')) return html(loginPage(base, 'member', '', 'Enter a real email address.'), 400);
    const token = await createMagicLink(env.DB, email, 'member');
    const link = `${origin}/auth/callback?token=${token}`;
    const mail = await sendMagicEmail(env, email, link);
    const note = mail.ok
      ? 'Check your email for the login link.'
      : env.DEV_LOG_LINKS === '1'
        ? `Mail is not live yet. Local link: ${link}`
        : 'We could not send mail yet. Try again in a bit.';
    return html(loginPage(base, 'member', note));
  }

  if (path === '/login') {
    if (user) return redirect(`${base}/`);
    return html(loginPage(base, 'member'));
  }

  if (!user) return redirect(`${base}/login`);
  await touchLastSeen(env.DB, user.id);

  const media = await serveLessonPoster(request, env, ctx.path, user);
  if (media) return media;

  if (path === '/profile' && request.method === 'POST') {
    const body = await readForm(request);
    const parsed = parseProfile(body);
    const setup = !profileComplete(user);
    if (parsed.error) {
      return html(memberProfile(base, { ...user, name: parsed.name, kit: parsed.kit, level: parsed.level, phone: parsed.phone }, env.STRIPE_PORTAL_URL.trim(), { setup, error: parsed.error }));
    }
    await saveProfile(env.DB, user.id, parsed);
    if (setup) return redirect(`${base}/`);
    return redirect(`${base}/profile?n=${encodeURIComponent('Profile saved.')}`);
  }

  if (path === '/streak-rewards/seen' && request.method === 'POST') {
    await markRewardsSeen(env.DB, user.id);
    return new Response(null, { status: 204 });
  }

  if (path === '/profile') {
    const [streak, medals, patterns] = await Promise.all([
      streakState(env.DB, user.id),
      medalTally(env.DB, user.id),
      listPatterns(env.DB, user.id, ['hands', 'four-limb']),
    ]);
    return html(
      memberProfile(base, user, env.STRIPE_PORTAL_URL.trim(), {
        setup: !profileComplete(user),
        note: ctx.url.searchParams.get('n') || '',
        streak,
        medals,
        patterns,
      }),
    );
  }

  if (!profileComplete(user)) {
    return redirect(`${base}/profile?setup=1`);
  }

  if (path === '/' || path === '') {
    const [lessonRows, challenge, streak, daily, medals, practiceDays] = await Promise.all([
      env.DB.prepare(
        `SELECT l.id, l.title, l.week_index, l.video_url, l.stream_uid, l.poster_key, l.summary, lp.watched_at, lp.completed_at
         FROM lessons l
         LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.person_id = ?
         WHERE l.published_at IS NOT NULL
         ORDER BY l.week_index ASC, l.published_at DESC`,
      )
        .bind(user.id)
        .all<MemberLesson>(),
      liveChallenge(env.DB),
      streakState(env.DB, user.id),
      dailyPatternFor(env.DB, user),
      medalTally(env.DB, user.id),
      recentPracticeDays(env.DB, user.id),
    ]);
    const lessons = await Promise.all(
      (lessonRows.results || []).map(async (l) => ({ ...l, thumbnail: await lessonPoster(env, l, base) })),
    );
    const board = challenge ? await leaderboard(env.DB, challenge.id, 5) : [];
    const mine = challenge ? await attemptFor(env.DB, challenge.id, user.id) : null;
    return html(
      memberHome(base, user, { lessons, challenge, board, attempt: mine, streak, daily, medals, practiceDays }),
    );
  }

  const rudSlug = path.match(/^\/rudiments\/([a-z0-9-]+)$/i);
  if (rudSlug && request.method === 'POST') {
    const slug = rudSlug[1];
    if (!canPractice(user)) return redirect(`${base}/rudiments/${slug}`);
    const pattern = await patternBySlug(env.DB, user.id, slug);
    if (!pattern) return redirect(`${base}/rudiments`);
    if (tierLocked(user, pattern.tier)) return redirect(`${base}/rudiments/${slug}`);
    const body = await readForm(request);
    if (body.action !== 'session') return redirect(`${base}/rudiments/${slug}`);
    const bpm = Number(body.bpm);
    if (!Number.isFinite(bpm) || bpm <= 0) {
      return redirect(`${base}/rudiments/${slug}?n=${encodeURIComponent('Enter the tempo you held.')}`);
    }
    const result = await logSession(env, user, pattern, {
      bpm,
      seconds: Number(body.seconds) || 0,
      clean: body.clean === '1',
    });
    const note = result.medalChanged
      ? `Session logged. New medal: ${medalLabel(result.medal)}.`
      : result.counted || body.clean !== '1'
        ? 'Session logged. Streak is safe today.'
        : `Session logged. Medals need a clean run of ${HOLD_SECONDS} seconds or more with the click going.`;
    return redirect(`${base}/rudiments/${slug}?n=${encodeURIComponent(note)}`);
  }

  if (rudSlug) {
    const pattern = await patternBySlug(env.DB, user.id, rudSlug[1]);
    if (!pattern) {
      return html(
        memberRudiments(base, user, {
          patterns: [],
          tab: 'rudiments',
          daily: null,
          streak: await streakState(env.DB, user.id),
          practiceDays: [],
          note: 'That pattern is gone.',
        }),
        404,
      );
    }
    const locked = tierLocked(user, pattern.tier);
    return html(
      memberRudimentDetail(base, user, {
        pattern,
        sessions: await recentSessions(env.DB, user.id, pattern.id),
        startBpm: bandStartBpm(pattern.medal, pattern),
        nextTarget: nextTargetBpm(pattern.medal, pattern),
        locked,
        canLog: canPractice(user) && !locked,
        streak: await streakState(env.DB, user.id),
        note: ctx.url.searchParams.get('n') || '',
      }),
    );
  }

  if (path === '/rudiments') {
    const tab = practiceTabFromQuery(ctx.url.searchParams);
    const [patterns, daily, streak, practiceDays] = await Promise.all([
      listPatterns(env.DB, user.id, disciplinesForTab(tab)),
      dailyPatternFor(env.DB, user),
      streakState(env.DB, user.id),
      recentPracticeDays(env.DB, user.id),
    ]);
    return html(
      memberRudiments(base, user, {
        patterns,
        tab,
        daily,
        streak,
        practiceDays,
        note: ctx.url.searchParams.get('n') || '',
      }),
    );
  }

  if (path === '/library') {
    const { results } = await env.DB.prepare(
      `SELECT l.id, l.title, l.week_index, l.video_url, l.stream_uid, l.poster_key, l.summary, lp.watched_at, lp.completed_at
       FROM lessons l
       LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.person_id = ?
       WHERE l.published_at IS NOT NULL
       ORDER BY l.week_index ASC`,
    )
      .bind(user.id)
      .all<MemberLesson>();
    const lessons = await Promise.all(
      (results || []).map(async (l) => ({ ...l, thumbnail: await lessonPoster(env, l, base) })),
    );
    return html(memberLibrary(base, user, lessons));
  }

  const watch = path.match(/^\/library\/([0-9a-f-]+)$/i);
  if (watch && request.method === 'POST') {
    if (!canWatch(user.status)) return redirect(`${base}/library`);
    const body = await readForm(request);
    const lessonId = watch[1];
    if (body.action === 'complete') {
      await env.DB.prepare(
        `INSERT INTO lesson_progress (person_id, lesson_id, watched_at, completed_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(person_id, lesson_id) DO UPDATE SET completed_at = excluded.completed_at, watched_at = COALESCE(lesson_progress.watched_at, excluded.watched_at)`,
      )
        .bind(user.id, lessonId, nowIso(), nowIso())
        .run();
      return redirect(`${base}/library/${lessonId}?n=${encodeURIComponent('Marked complete.')}`);
    }
    if (body.action === 'practice') {
      const bpm = Number(body.bpm);
      await env.DB.prepare('INSERT INTO practice_logs (id, person_id, lesson_id, bpm, notes, at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), user.id, lessonId, Number.isFinite(bpm) && bpm > 0 ? bpm : null, (body.notes || '').trim().slice(0, 2000), nowIso())
        .run();
      await touchStreak(env.DB, user.id);
      return redirect(`${base}/library/${lessonId}?n=${encodeURIComponent('Practice saved.')}`);
    }
    return redirect(`${base}/library/${lessonId}`);
  }

  if (watch) {
    const lesson = await env.DB.prepare(
      `SELECT l.id, l.title, l.week_index, l.video_url, l.stream_uid, l.poster_key, l.summary, lp.watched_at, lp.completed_at
       FROM lessons l
       LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.person_id = ?
       WHERE l.id = ? AND l.published_at IS NOT NULL`,
    )
      .bind(user.id, watch[1])
      .first<{
        id: string;
        title: string;
        week_index: number;
        video_url: string | null;
        stream_uid: string | null;
        poster_key: string | null;
        summary: string;
        watched_at: string | null;
        completed_at: string | null;
      }>();
    if (!lesson) return html(memberLibrary(base, user, []), 404);
    let player: { src: string; ready: boolean; error?: string } = { src: '', ready: false, error: '' };
    if (canWatch(user.status) && lesson.stream_uid) {
      player = await signedIframeSrc(env, lesson.stream_uid);
      if (player.src) {
        await env.DB.prepare(
          `INSERT INTO lesson_progress (person_id, lesson_id, watched_at, completed_at)
           VALUES (?, ?, ?, NULL)
           ON CONFLICT(person_id, lesson_id) DO UPDATE SET watched_at = COALESCE(lesson_progress.watched_at, excluded.watched_at)`,
        )
          .bind(user.id, lesson.id, nowIso())
          .run();
      }
    } else if (!canWatch(user.status)) {
      player = { src: '', ready: false, error: 'Membership required.' };
    }
    return html(memberWatch(base, user, lesson, player, ctx.url.searchParams.get('n') || ''));
  }

  if (path === '/challenges' && request.method === 'POST') {
    if (!canWatch(user.status)) return redirect(`${base}/challenges`);
    const body = await readForm(request);
    const challenge = await liveChallenge(env.DB);
    const id = (body.challenge_id || challenge?.id || '').trim();
    if (!challenge || challenge.id !== id) {
      return redirect(`${base}/challenges?n=${encodeURIComponent('No live challenge.')}`);
    }
    const notes = (body.notes || '').trim();
    if (!notes) return redirect(`${base}/challenges?e=${encodeURIComponent('Tell Mike how you played it.')}`);
    await upsertAttempt(env.DB, id, user.id, notes);
    await touchStreak(env.DB, user.id);
    return redirect(`${base}/challenges?n=${encodeURIComponent('Attempt in. Mike scores from admin.')}`);
  }

  if (path === '/challenges') {
    const challenge = await liveChallenge(env.DB);
    const board = challenge ? await leaderboard(env.DB, challenge.id) : [];
    const mine = challenge ? await attemptFor(env.DB, challenge.id, user.id) : null;
    return html(
      memberChallenges(base, user, {
        challenge,
        board,
        attempt: mine,
        note: ctx.url.searchParams.get('n') || '',
        error: ctx.url.searchParams.get('e') || '',
      }),
    );
  }

  return html(memberHome(base, user, { lessons: [], challenge: null, board: [], attempt: null }), 404);
}

async function requireAdmin(request: Request, env: Env, ctx: ReturnType<typeof requestCtx>): Promise<Person | Response> {
  const allow = adminEmails(env);
  const access = accessEmail(request);
  if (access) {
    if (!allow.includes(access)) return html(forbidden(ctx.base), 403);
    return ensurePerson(env.DB, access, '', 'active');
  }
  const session = await getSessionPerson(env.DB, request, ADMIN_COOKIE);
  if (session && allow.includes(session.email.toLowerCase())) return session;
  return redirect(`${ctx.base}/login`);
}

async function adminFetch(request: Request, env: Env, ctx: ReturnType<typeof requestCtx>): Promise<Response> {
  const { base, path, origin } = ctx;

  if (path === '/logout') {
    return redirect(`${base}/login`, { 'Set-Cookie': clearCookie(ADMIN_COOKIE, origin.startsWith('https')) });
  }

  if (path === '/auth/callback') {
    const token = ctx.url.searchParams.get('token') || '';
    const email = await consumeMagicLink(env.DB, token, 'admin');
    if (!email || !adminEmails(env).includes(email)) {
      return html(forbidden(base), 403);
    }
    const person = await ensurePerson(env.DB, email, '', 'active');
    const raw = await createSession(env.DB, person.id);
    await audit(env.DB, email, 'admin.login');
    return redirect(`${base}/`, { 'Set-Cookie': cookie(ADMIN_COOKIE, raw, 30 * 86400, origin.startsWith('https')) });
  }

  if (path === '/login' && request.method === 'POST') {
    const body = await readForm(request);
    const email = (body.email || '').trim().toLowerCase();
    if (!email.includes('@')) return html(loginPage(base, 'admin', '', 'Enter a real email address.'), 400);
    if (!adminEmails(env).includes(email)) {
      return html(loginPage(base, 'admin', '', 'That email is not on the admin allowlist.'), 403);
    }
    const token = await createMagicLink(env.DB, email, 'admin');
    const link = `${origin}/auth/callback?token=${token}`;
    const mail = await sendMagicEmail(env, email, link);
    const note = mail.ok
      ? 'Check your email for the login link.'
      : env.DEV_LOG_LINKS === '1'
        ? `Mail is not live yet. Local link: ${link}`
        : 'We could not send mail yet. Try again in a bit.';
    return html(loginPage(base, 'admin', note));
  }

  if (path === '/login') {
    return html(loginPage(base, 'admin'));
  }

  const gate = await requireAdmin(request, env, ctx);
  if (gate instanceof Response) return gate;
  const admin = gate;

  const media = await serveLessonPoster(request, env, path, admin);
  if (media) return media;

  if (path === '/' || path === '') {
    return html(await renderAdminDash(env, base, admin, ctx.url.searchParams.get('n') || ''));
  }

  if (path === '/members' && request.method === 'POST') {
    const body = await readForm(request);
    const email = (body.email || '').trim().toLowerCase();
    if (!email.includes('@')) return redirect(`${base}/members?n=${encodeURIComponent('Enter a real email.')}`);
    const person = await ensurePerson(env.DB, email, body.name || '', 'waitlist');
    await env.DB.prepare("UPDATE people SET source = CASE WHEN IFNULL(source, '') = '' THEN 'admin' ELSE source END WHERE id = ?")
      .bind(person.id)
      .run();
    await audit(env.DB, admin.email, `members.add ${email}`);
    return redirect(`${base}/members/${person.id}?n=${encodeURIComponent('Added to waitlist.')}`);
  }

  const memberUpdate = path.match(/^\/members\/([0-9a-f-]+)$/i);
  if (memberUpdate) {
    return crmFetch(request, env, base, admin, memberUpdate[1]);
  }

  if (path === '/members') {
    const q = (ctx.url.searchParams.get('q') || '').trim();
    const statusRaw = (ctx.url.searchParams.get('status') || '').trim();
    const planRaw = (ctx.url.searchParams.get('plan') || '').trim();
    const subscribed = statusRaw === 'subscribed';
    const status = ['waitlist', 'founding', 'active', 'canceled'].includes(statusRaw) ? statusRaw : '';
    const plan = planRaw === 'monthly' || planRaw === 'annual' ? planRaw : '';
    const where: string[] = [];
    const binds: string[] = [];
    if (q) {
      where.push('(p.email LIKE ? OR p.name LIKE ?)');
      binds.push(`%${q}%`, `%${q}%`);
    }
    if (subscribed) {
      where.push("m.status IN ('founding', 'active')");
    } else if (status) {
      where.push('m.status = ?');
      binds.push(status);
    }
    if (plan) {
      where.push('m.plan = ?');
      binds.push(plan);
    }
    const sql = `SELECT p.id, p.email, p.name, p.created_at, p.phone, p.source, p.last_seen_at, p.kit, p.level, m.plan, m.status
       FROM people p LEFT JOIN memberships m ON m.person_id = p.id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY p.created_at DESC`;
    const stmt = env.DB.prepare(sql);
    const { results } = binds.length ? await stmt.bind(...binds).all<Person>() : await stmt.all<Person>();
    const counts = {
      waitlist: await countStatus(env.DB, 'waitlist'),
      founding: await countStatus(env.DB, 'founding'),
      active: await countStatus(env.DB, 'active'),
      canceled: await countStatus(env.DB, 'canceled'),
    };
    return html(
      adminMembers(
        base,
        admin,
        results || [],
        ctx.url.searchParams.get('n') || '',
        q,
        subscribed ? 'subscribed' : status,
        plan,
        counts,
      ),
    );
  }

  if (path === '/rudiments' && request.method === 'POST') {
    const body = await readForm(request);
    const id = (body.id || '').trim();
    if (!id) return redirect(`${base}/rudiments`);
    if (body.action === 'override') {
      await setDailyOverride(env.DB, denverDay(), id, admin.email);
      await audit(env.DB, admin.email, `patterns.override ${id}`);
      return redirect(`${base}/rudiments?n=${encodeURIComponent("Today's pick set.")}`);
    }
    await savePattern(env.DB, id, {
      bpm_start: Number(body.bpm_start) || 60,
      bpm_goal: Number(body.bpm_goal) || 120,
      tier: (body.tier || 'free').trim(),
      level: (body.level || 'beginner').trim(),
      vex_notes: body.vex_notes || '',
      vex_feet: body.vex_feet || '',
      sticking: body.sticking || '',
      notes: body.notes || '',
    });
    await audit(env.DB, admin.email, `patterns.save ${id}`);
    return redirect(`${base}/rudiments?n=${encodeURIComponent('Pattern saved.')}`);
  }

  if (path === '/rudiments') {
    const wanted = (ctx.url.searchParams.get('d') || '').trim();
    const discipline = isDiscipline(wanted) ? wanted : '';
    const day = denverDay();
    const override = await env.DB.prepare('SELECT pattern_id FROM daily_pattern_override WHERE day = ?')
      .bind(day)
      .first<{ pattern_id: string }>();
    return html(
      adminPatterns(base, admin, {
        patterns: await allPatterns(env.DB, discipline || undefined),
        discipline,
        day,
        overrideId: override?.pattern_id || '',
        note: ctx.url.searchParams.get('n') || '',
      }),
    );
  }

  if (path === '/lessons' && request.method === 'POST') {
    const body = await readForm(request);
    const title = (body.title || '').trim();
    if (!title) return redirect(`${base}/lessons?n=${encodeURIComponent('Title required.')}`);
    const id = crypto.randomUUID();
    let slug = slugify(title);
    const clash = await env.DB.prepare('SELECT id FROM lessons WHERE slug = ?').bind(slug).first();
    if (clash) slug = `${slug}-${id.slice(0, 6)}`;
    await env.DB.prepare(
      'INSERT INTO lessons (id, slug, title, week_index, published_at, video_url, stream_uid, summary) VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?)',
    )
      .bind(id, slug, title, Number(body.week_index || 0), (body.summary || '').trim())
      .run();
    await audit(env.DB, admin.email, `lessons.create ${slug}`);
    return redirect(`${base}/lessons/${id}?n=${encodeURIComponent('Lesson created.')}`);
  }

  const lessonId = path.match(/^\/lessons\/([0-9a-f-]+)$/i);
  if (lessonId && request.method === 'POST') {
    const ct = request.headers.get('content-type') || '';
    if (ct.includes('multipart/form-data')) {
      const fd = await request.formData();
      const id = lessonId[1];
      if (String(fd.get('action') || '') === 'poster') {
        const file = fd.get('poster');
        if (!(file instanceof File) || !file.size) {
          return redirect(`${base}/lessons/${id}?n=${encodeURIComponent('Pick a still image.')}`);
        }
        const stored = await putLessonPoster(env, id, file);
        if ('error' in stored) return redirect(`${base}/lessons/${id}?n=${encodeURIComponent(stored.error)}`);
        await env.DB.prepare('UPDATE lessons SET poster_key = ? WHERE id = ?').bind(stored.key, id).run();
        await audit(env.DB, admin.email, `lessons.poster ${id}`);
        return redirect(`${base}/lessons/${id}?n=${encodeURIComponent('Thumbnail saved.')}`);
      }
      return redirect(`${base}/lessons/${id}`);
    }
    const body = await readForm(request);
    const id = lessonId[1];
    if (body.action === 'delete') {
      await env.DB.prepare('DELETE FROM lessons WHERE id = ?').bind(id).run();
      await audit(env.DB, admin.email, `lessons.delete ${id}`);
      return redirect(`${base}/lessons?n=${encodeURIComponent('Deleted.')}`);
    }
    if (body.action === 'toggle') {
      const row = await env.DB.prepare('SELECT published_at FROM lessons WHERE id = ?').bind(id).first<{ published_at: string | null }>();
      const next = row?.published_at ? null : nowIso();
      await env.DB.prepare('UPDATE lessons SET published_at = ? WHERE id = ?').bind(next, id).run();
      await audit(env.DB, admin.email, `lessons.toggle ${id} ${next ? 'publish' : 'unpublish'}`);
      return redirect(`${base}/lessons/${id}?n=${encodeURIComponent(next ? 'Published.' : 'Unpublished.')}`);
    }
    if (body.action === 'stream-upload') {
      const lesson = await env.DB.prepare('SELECT title FROM lessons WHERE id = ?').bind(id).first<{ title: string }>();
      const slot = await startDirectUpload(env, { lesson_id: id, name: lesson?.title || id });
      const wantsJson = (request.headers.get('Accept') || '').includes('application/json');
      if ('error' in slot) {
        if (wantsJson) {
          return new Response(JSON.stringify({ error: slot.error }), {
            status: 400,
            headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
          });
        }
        return redirect(`${base}/lessons/${id}?n=${encodeURIComponent(slot.error)}`);
      }
      await env.DB.prepare('UPDATE lessons SET stream_uid = ? WHERE id = ?').bind(slot.id, id).run();
      await audit(env.DB, admin.email, `lessons.stream-upload ${id} ${slot.id}`);
      if (wantsJson) {
        return new Response(JSON.stringify(slot), {
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      }
      return renderLessonDetail(env, base, admin, id, 'Slot ready. Drop the file on the stage.', slot);
    }
    if (body.action === 'stream-ingest') {
      const url = (body.ingest_url || '').trim();
      if (!url.startsWith('http')) return redirect(`${base}/lessons/${id}?n=${encodeURIComponent('Paste a public https video URL.')}`);
      const lesson = await env.DB.prepare('SELECT title FROM lessons WHERE id = ?').bind(id).first<{ title: string }>();
      const ingested = await ingestFromUrl(env, url, { lesson_id: id, name: lesson?.title || id });
      if ('error' in ingested) return redirect(`${base}/lessons/${id}?n=${encodeURIComponent(ingested.error)}`);
      await env.DB.prepare('UPDATE lessons SET stream_uid = ? WHERE id = ?').bind(ingested.id, id).run();
      await audit(env.DB, admin.email, `lessons.stream-ingest ${id} ${ingested.id}`);
      return redirect(`${base}/lessons/${id}?n=${encodeURIComponent('Ingest started. Refresh when Stream is ready.')}`);
    }
    const current = await env.DB.prepare('SELECT stream_uid, video_url, title, week_index, summary FROM lessons WHERE id = ?')
      .bind(id)
      .first<{ stream_uid: string | null; video_url: string | null; title: string; week_index: number; summary: string }>();
    if (!current) return redirect(`${base}/lessons?n=${encodeURIComponent('Lesson not found.')}`);
    const keepIds = !('stream_uid' in body) && !('video_url' in body);
    await env.DB.prepare(
      'UPDATE lessons SET title = ?, week_index = ?, video_url = ?, stream_uid = ?, summary = ? WHERE id = ?',
    )
      .bind(
        (body.title || current.title).trim(),
        Number(body.week_index || current.week_index || 0),
        keepIds ? current.video_url : (body.video_url || '').trim() || null,
        keepIds ? current.stream_uid : (body.stream_uid || '').trim() || null,
        'summary' in body ? (body.summary || '').trim() : current.summary,
        id,
      )
      .run();
    await audit(env.DB, admin.email, `lessons.save ${id}`);
    return redirect(`${base}/lessons/${id}?n=${encodeURIComponent('Saved.')}`);
  }

  if (lessonId) {
    return renderLessonDetail(env, base, admin, lessonId[1], ctx.url.searchParams.get('n') || '');
  }

  if (path === '/lessons') {
    const view = (ctx.url.searchParams.get('view') || '').trim();
    const { results } = await env.DB.prepare(
      'SELECT id, slug, title, week_index, published_at, video_url, stream_uid, poster_key, summary FROM lessons ORDER BY week_index ASC, title ASC',
    ).all<AdminLesson>();
    const [lessons, stream, watchCounts] = await Promise.all([
      withStreamReady(env, base, results || []),
      probeStream(env),
      env.DB.prepare('SELECT lesson_id, COUNT(*) AS n FROM lesson_progress GROUP BY lesson_id').all<{ lesson_id: string; n: number }>(),
    ]);
    const counts = new Map((watchCounts.results || []).map((row) => [row.lesson_id, row.n]));
    const withWatchers = lessons.map((l) => ({ ...l, watchers: counts.get(l.id) || 0 }));
    return html(adminLessons(base, admin, withWatchers, ctx.url.searchParams.get('n') || '', stream, view));
  }

  if (path === '/challenges' && request.method === 'POST') {
    const body = await readForm(request);
    const title = (body.title || '').trim();
    if (!title) return redirect(`${base}/challenges?n=${encodeURIComponent('Title required.')}`);
    await env.DB.prepare('INSERT INTO challenges (id, title, prompt, published_at) VALUES (?, ?, ?, NULL)')
      .bind(crypto.randomUUID(), title, (body.prompt || '').trim())
      .run();
    await audit(env.DB, admin.email, `challenges.create ${title}`);
    return redirect(`${base}/challenges?n=${encodeURIComponent('Challenge created.')}`);
  }

  const challengeId = path.match(/^\/challenges\/([0-9a-f-]+)$/i);
  if (challengeId && request.method === 'POST') {
    const body = await readForm(request);
    const id = challengeId[1];
    if (body.action === 'score') {
      const raw = Number(body.score);
      if (!Number.isInteger(raw) || raw < 0 || raw > 100) {
        return redirect(`${base}/challenges?n=${encodeURIComponent('Score must be 0 to 100.')}`);
      }
      const personId = (body.person_id || '').trim();
      if (!personId) return redirect(`${base}/challenges?n=${encodeURIComponent('Missing member.')}`);
      await scoreAttempt(env.DB, id, personId, raw, admin.email);
      await audit(env.DB, admin.email, `challenges.score ${id} ${personId} ${raw}`);
      return redirect(`${base}/challenges?n=${encodeURIComponent('Score saved. Board updated.')}`);
    }
    if (body.action === 'delete') {
      await env.DB.prepare('DELETE FROM challenges WHERE id = ?').bind(id).run();
      await audit(env.DB, admin.email, `challenges.delete ${id}`);
      return redirect(`${base}/challenges?n=${encodeURIComponent('Deleted.')}`);
    }
    if (body.action === 'toggle') {
      const row = await env.DB.prepare('SELECT published_at FROM challenges WHERE id = ?').bind(id).first<{ published_at: string | null }>();
      const next = row?.published_at ? null : nowIso();
      await env.DB.prepare('UPDATE challenges SET published_at = ? WHERE id = ?').bind(next, id).run();
      await audit(env.DB, admin.email, `challenges.toggle ${id}`);
      return redirect(`${base}/challenges?n=${encodeURIComponent(next ? 'Published.' : 'Unpublished.')}`);
    }
    await env.DB.prepare('UPDATE challenges SET title = ?, prompt = ? WHERE id = ?')
      .bind((body.title || '').trim(), (body.prompt || '').trim(), id)
      .run();
    await audit(env.DB, admin.email, `challenges.save ${id}`);
    return redirect(`${base}/challenges?n=${encodeURIComponent('Saved.')}`);
  }

  if (path === '/challenges') {
    const items = await loadChallengeStudio(env.DB);
    return html(adminChallenges(base, admin, items, ctx.url.searchParams.get('n') || ''));
  }

  if (path === '/marketing' || path.startsWith('/marketing/')) {
    return marketingFetch(request, env, ctx, admin);
  }

  if (path === '/api/leads') return ingestLeadFetch(request, env);

  if (path === '/financials') {
    return html(
      adminFinancials(base, admin, {
        waitlist: await countStatus(env.DB, 'waitlist'),
        founding: await countStatus(env.DB, 'founding'),
        active: await countStatus(env.DB, 'active'),
        canceled: await countStatus(env.DB, 'canceled'),
      }),
    );
  }

  return html(forbidden(base), 404);
}

async function renderAdminDash(env: Env, base: string, admin: Person, note: string): Promise<string> {
  const [
    waitlist,
    founding,
    active,
    canceled,
    peopleRow,
    lessonPub,
    lessonDraft,
    chalPub,
    chalDraft,
    pendingScores,
    recent,
    audit,
    domainsRes,
    metricsRes,
    segments,
    broadcasts,
  ] = await Promise.all([
    countStatus(env.DB, 'waitlist'),
    countStatus(env.DB, 'founding'),
    countStatus(env.DB, 'active'),
    countStatus(env.DB, 'canceled'),
    env.DB.prepare('SELECT COUNT(*) AS n FROM people').first<{ n: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM lessons WHERE published_at IS NOT NULL').first<{ n: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM lessons WHERE published_at IS NULL').first<{ n: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM challenges WHERE published_at IS NOT NULL').first<{ n: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM challenges WHERE published_at IS NULL').first<{ n: number }>(),
    pendingCount(env.DB),
    env.DB.prepare(
      `SELECT p.id, p.email, p.name, p.created_at, p.phone, p.source, p.last_seen_at, p.kit, p.level, m.plan, m.status
       FROM people p LEFT JOIN memberships m ON m.person_id = p.id
       ORDER BY p.created_at DESC LIMIT 8`,
    ).all<Person>(),
    env.DB.prepare('SELECT actor, action, at FROM admin_audit ORDER BY at DESC LIMIT 12').all<{
      actor: string;
      action: string;
      at: string;
    }>(),
    resend<{ data?: Domain[] }>(env, '/domains'),
    resend<{ totals?: MetricsTotals }>(env, '/emails/metrics'),
    resendList<Segment>(env, '/segments'),
    resendList<Broadcast>(env, '/broadcasts'),
  ]);
  const domains = domainsRes.data.data || [];
  const domain = domains.find((d) => d.name.includes('stickitoutdrums')) || domains[0];
  return adminDash(base, admin, {
    note,
    counts: { waitlist, founding, active, canceled },
    people: peopleRow?.n || 0,
    lessons: { published: lessonPub?.n || 0, draft: lessonDraft?.n || 0 },
    challenges: { published: chalPub?.n || 0, draft: chalDraft?.n || 0 },
    pendingScores,
    recentPeople: recent.results || [],
    audit: audit.results || [],
    stripe: Boolean(env.STRIPE_PORTAL_URL.trim()),
    mail: {
      domain: domain?.name || 'stickitoutdrums.com',
      status: domain?.status || (domainsRes.ok ? '' : 'unknown'),
      totals: metricsRes.data.totals || null,
      error: domainsRes.ok ? '' : domainsRes.error,
    },
    broadcasts,
    segments,
  });
}

async function countStatus(db: D1Database, status: string): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM memberships WHERE status = ?').bind(status).first<{ n: number }>();
  return row?.n || 0;
}

async function withStreamReady(env: Env, base: string, lessons: AdminLesson[]): Promise<AdminLesson[]> {
  return Promise.all(
    lessons.map(async (lesson) => {
      const poster = await lessonPoster(env, lesson, base);
      if (!lesson.stream_uid) return { ...lesson, thumbnail: poster };
      const details = await videoDetails(env, lesson.stream_uid);
      if (!details) return { ...lesson, ready: false, thumbnail: poster };
      return { ...lesson, ready: details.ready, thumbnail: poster || details.thumbnail, duration: details.duration };
    }),
  );
}

async function renderLessonDetail(
  env: Env,
  base: string,
  admin: Person,
  id: string,
  note = '',
  upload: { id: string; uploadURL: string } | null = null,
): Promise<Response> {
  const lesson = await env.DB.prepare(
    'SELECT id, slug, title, week_index, published_at, video_url, stream_uid, poster_key, summary FROM lessons WHERE id = ?',
  )
    .bind(id)
    .first<AdminLesson>();
  if (!lesson) return html(`<p>Lesson not found. <a href="${base}/lessons">Back</a></p>`, 404);
  const [player, stream, details, progress, poster] = await Promise.all([
    lesson.stream_uid ? signedIframeSrc(env, lesson.stream_uid) : Promise.resolve({ src: '', ready: false, error: '' }),
    probeStream(env),
    lesson.stream_uid ? videoDetails(env, lesson.stream_uid) : Promise.resolve(null),
    env.DB.prepare(
      `SELECT p.id AS person_id, p.email, p.name, lp.watched_at, lp.completed_at
       FROM lesson_progress lp
       JOIN people p ON p.id = lp.person_id
       WHERE lp.lesson_id = ?
       ORDER BY lp.watched_at DESC`,
    )
      .bind(id)
      .all<{ person_id: string; email: string; name: string; watched_at: string | null; completed_at: string | null }>(),
    lessonPoster(env, lesson, base),
  ]);
  const hydrated: AdminLesson = details
    ? { ...lesson, ready: details.ready, thumbnail: poster || details.thumbnail, duration: details.duration, watchers: (progress.results || []).length }
    : { ...lesson, thumbnail: poster, watchers: (progress.results || []).length };
  return html(adminLessonDetail(base, admin, hydrated, player, progress.results || [], upload, note, stream));
}

const STATIC_FILES = new Set(['/favicon.ico', '/favicon.svg', '/apple-touch-icon.png', '/site.webmanifest']);

function appManifest(admin: boolean) {
  return {
    id: '/',
    name: 'Stick It Out',
    short_name: 'Stick It Out',
    description: admin ? 'Stick It Out admin.' : 'Practice, lessons, and streaks.',
    lang: 'en',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'portrait',
    background_color: '#0C0B0A',
    theme_color: '#0C0B0A',
    categories: ['education', 'music'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

function staticType(path: string): string {
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.ico')) return 'image/x-icon';
  if (path.endsWith('.webmanifest')) return 'application/manifest+json';
  return 'application/octet-stream';
}

/** Brand images, favicons, and the manifest. Assets run behind the worker, so these paths route here. */
async function serveBrandAsset(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path === '/site.webmanifest') {
    const admin = new URL(request.url).hostname.startsWith('admin.');
    const body = JSON.stringify(appManifest(admin), null, 2);
    return new Response(body, {
      headers: {
        'Content-Type': 'application/manifest+json; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }
  const served = path.startsWith('/img/brand/') || path.startsWith('/img/badges/') || path.startsWith('/icons/') || STATIC_FILES.has(path);
  if (!served) return null;
  if (!env.ASSETS) return new Response('Not found', { status: 404 });
  const url = new URL(request.url);
  url.pathname = path;
  const res = await env.ASSETS.fetch(new Request(url.toString(), { method: 'GET' }));
  if (!res.ok) return new Response('Not found', { status: 404 });
  const headers = new Headers(res.headers);
  headers.set('Content-Type', staticType(path));
  headers.set('Cache-Control', 'public, max-age=86400');
  return new Response(res.body, { status: 200, headers });
}

async function serveLessonPoster(request: Request, env: Env, path: string, _user: Person): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  const match = path.match(/^\/media\/lessons\/([0-9a-f-]+)$/i);
  if (!match) return null;
  const row = await env.DB.prepare('SELECT poster_key FROM lessons WHERE id = ?').bind(match[1]).first<{ poster_key: string | null }>();
  if (!row?.poster_key) return new Response('Not found', { status: 404 });
  const obj = await readLessonPoster(env, row.poster_key);
  if (!obj) return new Response('Not found', { status: 404 });
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
