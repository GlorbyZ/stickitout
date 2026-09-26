export type ResendResult<T = unknown> = {
  ok: boolean;
  status: number;
  data: T;
  error: string;
};

const UA = 'StickItOut-Portals/1.0';

export async function resend<T = unknown>(
  env: { RESEND_API_KEY?: string },
  path: string,
  init: RequestInit = {},
): Promise<ResendResult<T>> {
  const key = env.RESEND_API_KEY?.trim();
  if (!key) return { ok: false, status: 0, data: {} as T, error: 'RESEND_API_KEY is not set' };
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${key}`);
  headers.set('User-Agent', UA);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(`https://api.resend.com${path}`, { ...init, headers });
  const raw = await res.text();
  let data: T = {} as T;
  try {
    data = raw ? (JSON.parse(raw) as T) : ({} as T);
  } catch {
    data = { raw } as T;
  }
  const rec = data as { message?: string; name?: string; error?: string | { message?: string } };
  const nested = typeof rec.error === 'object' && rec.error ? rec.error.message : '';
  const error = rec.message || nested || (typeof rec.error === 'string' ? rec.error : '') || rec.name || (res.ok ? '' : `http_${res.status}`);
  return { ok: res.ok, status: res.status, data, error };
}

export type ResendList<T> = { object?: string; has_more?: boolean; data?: T[] };

export async function resendList<T>(
  env: { RESEND_API_KEY?: string },
  path: string,
  limit = 100,
): Promise<T[]> {
  const out: T[] = [];
  let cursor = '';
  for (let i = 0; i < 10; i++) {
    const joiner = path.includes('?') ? '&' : '?';
    const url = `${path}${joiner}limit=${limit}${cursor ? `&after=${cursor}` : ''}`;
    const res = await resend<ResendList<T> & { id?: string }>(env, url);
    const rows = res.data?.data || [];
    out.push(...rows);
    if (!res.ok || !res.data?.has_more || !rows.length) break;
    const last = rows[rows.length - 1] as { id?: string };
    if (!last?.id) break;
    cursor = last.id;
  }
  return out;
}

export type Segment = { id: string; name: string };
export type Contact = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  unsubscribed?: boolean;
  created_at?: string;
};
export type Broadcast = {
  id: string;
  name?: string | null;
  segment_id?: string | null;
  audience_id?: string | null;
  status?: string;
  created_at?: string;
  scheduled_at?: string | null;
  sent_at?: string | null;
  subject?: string | null;
  from?: string | null;
  html?: string | null;
  text?: string | null;
};
export type Template = { id: string; name?: string; alias?: string | null; status?: string; published?: boolean };
export type Topic = { id: string; name?: string; description?: string | null; default_subscription?: string; visibility?: string };
export type Domain = { id: string; name: string; status: string };
export type Suppression = { id?: string; email?: string; reason?: string; origin?: string; created_at?: string };
export type MetricsTotals = Record<string, number>;

export async function ensureSegment(env: { RESEND_API_KEY?: string }, name: string): Promise<Segment | null> {
  const segs = await resendList<Segment>(env, '/segments');
  const found = segs.find((s) => s.name === name);
  if (found) return found;
  const created = await resend<Segment>(env, '/segments', { method: 'POST', body: JSON.stringify({ name }) });
  if (!created.ok) return null;
  return created.data;
}

export async function addContactToSegment(
  env: { RESEND_API_KEY?: string },
  contactId: string,
  segmentId: string,
): Promise<ResendResult> {
  const a = await resend(env, `/contacts/${contactId}/segments/${segmentId}`, { method: 'POST', body: '{}' });
  if (a.ok || a.status === 409) return a;
  const b = await resend(env, `/contacts/${contactId}/segments`, {
    method: 'POST',
    body: JSON.stringify({ id: segmentId }),
  });
  return b;
}

export function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: '', last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

export async function upsertContact(
  env: { RESEND_API_KEY?: string },
  person: { email: string; name: string; status: string; plan: string | null },
  segmentIds: string[],
  known: Map<string, Contact>,
): Promise<{ ok: boolean; error?: string }> {
  const { first, last } = splitName(person.name);
  const existing = known.get(person.email.toLowerCase());
  const payload = {
    email: person.email.toLowerCase(),
    first_name: first || undefined,
    last_name: last || undefined,
    unsubscribed: person.status === 'canceled',
    properties: {
      status: person.status,
      plan: person.plan || '',
    },
    segments: segmentIds.map((id) => ({ id })),
  };
  if (!existing) {
    let created = await resend<Contact>(env, '/contacts', { method: 'POST', body: JSON.stringify(payload) });
    if (!created.ok && created.status !== 409) {
      const plain = { ...payload, properties: undefined };
      created = await resend<Contact>(env, '/contacts', { method: 'POST', body: JSON.stringify(plain) });
    }
    if (created.ok && created.data.id) known.set(person.email.toLowerCase(), { ...created.data, email: person.email });
    if (created.ok) return { ok: true };
    if (created.status !== 409) return { ok: false, error: created.error };
  }
  const id = existing?.id || (await findContactId(env, person.email));
  if (!id) return { ok: false, error: 'contact_not_found' };
  const patched = await resend(env, `/contacts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      first_name: first || undefined,
      last_name: last || undefined,
      unsubscribed: person.status === 'canceled',
      properties: payload.properties,
    }),
  });
  for (const seg of segmentIds) await addContactToSegment(env, id, seg);
  return { ok: patched.ok || patched.status === 404, error: patched.ok ? undefined : patched.error };
}

async function findContactId(env: { RESEND_API_KEY?: string }, email: string): Promise<string | null> {
  const byEmail = await resend<Contact>(env, `/contacts/${encodeURIComponent(email)}`);
  if (byEmail.ok && byEmail.data.id) return byEmail.data.id;
  return null;
}

export const SEGMENT_NAMES = {
  all: 'SIO All',
  waitlist: 'SIO Waitlist',
  founding: 'SIO Founding',
  active: 'SIO Active',
} as const;

export async function ensureSioSegments(env: { RESEND_API_KEY?: string }): Promise<Record<string, Segment | null>> {
  const all = await ensureSegment(env, SEGMENT_NAMES.all);
  const waitlist = await ensureSegment(env, SEGMENT_NAMES.waitlist);
  const founding = await ensureSegment(env, SEGMENT_NAMES.founding);
  const active = await ensureSegment(env, SEGMENT_NAMES.active);
  return { all, waitlist, founding, active };
}

export async function syncOnePersonToResend(
  env: { RESEND_API_KEY?: string },
  person: { email: string; name: string; status: string; plan: string | null },
): Promise<{ ok: boolean; error?: string }> {
  await ensureContactProperties(env);
  const segs = await ensureSioSegments(env);
  if (!segs.all) return { ok: false, error: 'Could not create SIO All' };
  const ids: string[] = [];
  if (person.status !== 'canceled' && segs.all) ids.push(segs.all.id);
  if (person.status === 'waitlist' && segs.waitlist) ids.push(segs.waitlist.id);
  if (person.status === 'founding' && segs.founding) ids.push(segs.founding.id);
  if (person.status === 'active' && segs.active) ids.push(segs.active.id);
  return upsertContact(env, person, ids, new Map());
}

export async function ensureContactProperties(env: { RESEND_API_KEY?: string }): Promise<void> {
  for (const key of ['status', 'plan']) {
    await resend(env, '/contact-properties', {
      method: 'POST',
      body: JSON.stringify({ key, type: 'string' }),
    });
  }
}

export function withUnsubscribe(html: string): string {
  if (html.includes('RESEND_UNSUBSCRIBE_URL')) return html;
  return `${html}\n<p style="margin-top:2rem;font-size:12px;color:#9AA3AD;"><a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Unsubscribe</a></p>`;
}

export function textToHtml(text: string): string {
  const body = text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeText(p).replace(/\n/g, '<br />')}</p>`)
    .join('');
  return withUnsubscribe(body || '<p></p>');
}

function escapeText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
