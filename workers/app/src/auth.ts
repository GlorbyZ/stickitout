export function nowIso(): string {
  return new Date().toISOString();
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function plusMinutes(mins: number): string {
  return new Date(Date.now() + mins * 60_000).toISOString();
}

export function plusDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

export function cookie(name: string, value: string, maxAgeSec: number, secure: boolean): string {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(name: string, secure: boolean): string {
  const parts = [`${name}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function readCookie(request: Request, name: string): string {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return '';
}

export type PortalKind = 'member' | 'admin';

export type RequestCtx = {
  url: URL;
  kind: PortalKind;
  base: string;
  path: string;
  origin: string;
};

export function requestCtx(request: Request, env: { MEMBER_ORIGIN: string; ADMIN_ORIGIN: string; DEV_LOG_LINKS?: string }): RequestCtx {
  const url = new URL(request.url);
  const hostHeader = (request.headers.get('Host') || url.host).toLowerCase();
  const host = hostHeader.split(':')[0];
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.workers.dev');
  const localDev = env.DEV_LOG_LINKS === '1';
  const adminPath = (loopback || localDev) && (url.pathname === '/_admin' || url.pathname.startsWith('/_admin/'));
  const kind: PortalKind = host.startsWith('admin.') || adminPath ? 'admin' : 'member';
  const base = adminPath ? '/_admin' : '';
  let path = adminPath ? url.pathname.slice('/_admin'.length) || '/' : url.pathname;
  if (!path.startsWith('/')) path = `/${path}`;
  const requestOrigin = localDev ? 'http://127.0.0.1:8787' : `${url.protocol}//${hostHeader}`;
  const origin =
    kind === 'admin'
      ? loopback || adminPath || localDev
        ? `${requestOrigin}${base}`
        : env.ADMIN_ORIGIN
      : loopback || localDev
        ? requestOrigin
        : env.MEMBER_ORIGIN;
  return { url, kind, base, path, origin };
}

export function adminEmails(env: { ADMIN_EMAILS: string }): string[] {
  return env.ADMIN_EMAILS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function accessEmail(request: Request): string {
  return (request.headers.get('Cf-Access-Authenticated-User-Email') || '').trim().toLowerCase();
}

export type Person = {
  id: string;
  email: string;
  name: string;
  created_at: string;
  plan: string | null;
  status: string;
  phone?: string;
  source?: string;
  last_seen_at?: string | null;
  kit?: string;
  level?: string;
};

const PERSON_COLS = `p.id, p.email, p.name, p.created_at, p.phone, p.source, p.last_seen_at, p.kit, p.level, m.plan, m.status`;

export async function getPersonByEmail(db: D1Database, email: string): Promise<Person | null> {
  const row = await db
    .prepare(
      `SELECT ${PERSON_COLS}
       FROM people p
       LEFT JOIN memberships m ON m.person_id = p.id
       WHERE p.email = ?`,
    )
    .bind(email.toLowerCase())
    .first<Person>();
  return row || null;
}

export async function getSessionPerson(db: D1Database, request: Request, cookieName: string): Promise<Person | null> {
  const raw = readCookie(request, cookieName);
  if (!raw) return null;
  const hash = await sha256Hex(raw);
  const row = await db
    .prepare(
      `SELECT ${PERSON_COLS}
       FROM sessions s
       JOIN people p ON p.id = s.person_id
       LEFT JOIN memberships m ON m.person_id = p.id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(hash, nowIso())
    .first<Person>();
  return row || null;
}

export async function touchLastSeen(db: D1Database, personId: string): Promise<void> {
  await db.prepare('UPDATE people SET last_seen_at = ? WHERE id = ?').bind(nowIso(), personId).run();
}

export async function ensurePerson(
  db: D1Database,
  email: string,
  name = '',
  status = 'waitlist',
): Promise<Person> {
  const existing = await getPersonByEmail(db, email);
  if (existing) {
    if (name && !existing.name) {
      await db.prepare('UPDATE people SET name = ? WHERE id = ?').bind(name, existing.id).run();
      existing.name = name;
    }
    return existing;
  }
  const id = crypto.randomUUID();
  const created = nowIso();
  const clean = email.trim().toLowerCase();
  await db.batch([
    db.prepare('INSERT INTO people (id, email, name, created_at) VALUES (?, ?, ?, ?)').bind(id, clean, name.trim(), created),
    db.prepare(
      'INSERT INTO memberships (person_id, plan, status, stripe_customer_id, stripe_sub_id) VALUES (?, NULL, ?, NULL, NULL)',
    ).bind(id, status),
  ]);
  return { id, email: clean, name: name.trim(), created_at: created, plan: null, status, phone: '', source: '', last_seen_at: null, kit: '', level: '' };
}

export async function ingestWaitlistPerson(
  db: D1Database,
  email: string,
  name: string,
  plan: string | null,
  source = '',
): Promise<Person> {
  const person = await ensurePerson(db, email, name, 'waitlist');
  const cleanPlan = plan === 'annual' || plan === 'monthly' ? plan : null;
  if (cleanPlan && person.status === 'waitlist') {
    await db.prepare('UPDATE memberships SET plan = COALESCE(plan, ?) WHERE person_id = ? AND status = ?')
      .bind(cleanPlan, person.id, 'waitlist')
      .run();
    person.plan = person.plan || cleanPlan;
  }
  const cleanSource = source.trim().slice(0, 80);
  if (cleanSource) {
    await db.prepare("UPDATE people SET source = CASE WHEN IFNULL(source, '') = '' THEN ? ELSE source END WHERE id = ?")
      .bind(cleanSource, person.id)
      .run();
    person.source = person.source || cleanSource;
  }
  return person;
}

export async function createSession(db: D1Database, personId: string): Promise<string> {
  const raw = randomToken();
  const hash = await sha256Hex(raw);
  await db
    .prepare('INSERT INTO sessions (id, person_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), personId, hash, plusDays(30))
    .run();
  return raw;
}

export async function createMagicLink(db: D1Database, email: string, purpose: string): Promise<string> {
  const raw = randomToken();
  const hash = await sha256Hex(raw);
  await db
    .prepare(
      'INSERT INTO magic_links (id, email, token_hash, purpose, expires_at, used_at) VALUES (?, ?, ?, ?, ?, NULL)',
    )
    .bind(crypto.randomUUID(), email.trim().toLowerCase(), hash, purpose, plusMinutes(20))
    .run();
  return raw;
}

export async function consumeMagicLink(db: D1Database, raw: string, purpose: string): Promise<string | null> {
  const hash = await sha256Hex(raw);
  const row = await db
    .prepare(
      'SELECT id, email, expires_at, used_at FROM magic_links WHERE token_hash = ? AND purpose = ?',
    )
    .bind(hash, purpose)
    .first<{ id: string; email: string; expires_at: string; used_at: string | null }>();
  if (!row || row.used_at || row.expires_at < nowIso()) return null;
  await db.prepare('UPDATE magic_links SET used_at = ? WHERE id = ?').bind(nowIso(), row.id).run();
  return row.email;
}

export async function sendMagicEmail(
  env: { RESEND_API_KEY?: string; MAIL_FROM: string; DEV_LOG_LINKS?: string },
  to: string,
  link: string,
): Promise<{ ok: boolean; error?: string }> {
  const key = env.RESEND_API_KEY?.trim();
  if (!key) {
    if (env.DEV_LOG_LINKS === '1') console.log(JSON.stringify({ magic_link: link, to }));
    return { ok: false, error: 'mail_unconfigured' };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'User-Agent': 'StickItOut-Portals/1.0',
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [to],
      subject: 'Your Stick It Out login link',
      text: `Open this link to sign in:\n\n${link}\n\nIt expires in 20 minutes. If you did not ask for this, ignore the email.`,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.log(JSON.stringify({ resend_error: res.status, body: body.slice(0, 400) }));
    return { ok: false, error: 'mail_failed' };
  }
  return { ok: true };
}

export async function audit(db: D1Database, actor: string, action: string): Promise<void> {
  await db
    .prepare('INSERT INTO admin_audit (id, actor, action, at) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), actor, action, nowIso())
    .run();
}

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return slug || `lesson-${crypto.randomUUID().slice(0, 8)}`;
}

/** Parse a JSON or form body. Empty or malformed bodies return {} so callers validate and answer 400. */
export async function readForm(request: Request): Promise<Record<string, string>> {
  const ct = request.headers.get('content-type') || '';
  const out: Record<string, string> = {};
  try {
    if (ct.includes('application/json')) {
      const json = (await request.json()) as unknown;
      if (json && typeof json === 'object' && !Array.isArray(json)) {
        for (const [k, v] of Object.entries(json)) out[k] = v == null ? '' : String(v);
      }
      return out;
    }
    const fd = await request.formData();
    for (const [k, v] of fd.entries()) out[k] = String(v);
  } catch {
    return {};
  }
  return out;
}

export function redirect(location: string, headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set('Location', location);
  return new Response(null, { status: 303, headers: h });
}

export function html(body: string, status = 200, headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set('Content-Type', 'text/html; charset=utf-8');
  h.set('Cache-Control', 'no-store');
  return new Response(body, { status, headers: h });
}
