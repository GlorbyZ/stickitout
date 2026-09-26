import { ingestWaitlistPerson } from './auth';
import { syncOnePersonToResend } from './resend';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function ingestSecret(env: Env): string {
  return (env.LEAD_INGEST_SECRET || '').trim();
}

function bearer(request: Request): string {
  const header = request.headers.get('Authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

export async function ingestLeadFetch(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const secret = ingestSecret(env);
  if (!secret) return json({ ok: false, error: 'ingest_unconfigured' }, 503);
  if (bearer(request) !== secret) return json({ ok: false, error: 'unauthorized' }, 401);

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const email = String(body.email || '')
    .trim()
    .toLowerCase();
  const name = String(body.name || '').trim() || (email.includes('@') ? email.split('@')[0] : '');
  const planRaw = String(body.plan || '').trim().toLowerCase();
  const plan = planRaw === 'annual' || planRaw === 'monthly' ? planRaw : null;
  if (!email.includes('@') || email.length > 190) return json({ ok: false, error: 'invalid_email' }, 400);

  const person = await ingestWaitlistPerson(env.DB, email, name, plan, String(body.source || '').trim() || 'waitlist');
  const resend = await syncOnePersonToResend(env, {
    email: person.email,
    name: person.name,
    status: person.status,
    plan: person.plan,
  });
  if (!resend.ok) console.log(JSON.stringify({ lead_resend_error: resend.error, email: person.email }));
  return json({ ok: true, d1: true, resend: resend.ok, status: person.status });
}
