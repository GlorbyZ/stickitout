import type { APIRoute } from 'astro';
import { Resend } from 'resend';
import { cloudflareEnv, readEnv, siteUrl } from '../../lib/env';
import { createServiceClient } from '../../lib/supabase';
import { allowRequest, clientIp } from '../../lib/rate-limit';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function token(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function parseBody(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = (await request.json()) as Record<string, unknown>;
    return {
      email: String(data.email ?? ''),
      company: String(data.company ?? ''),
      source: String(data.source ?? 'free-lesson'),
      name: String(data.name ?? ''),
    };
  }
  const form = await request.formData();
  return {
    email: String(form.get('email') ?? ''),
    company: String(form.get('company') ?? ''),
    source: String(form.get('source') ?? 'free-lesson'),
    name: String(form.get('name') ?? ''),
  };
}

export const POST: APIRoute = async ({ request }) => {
  const ip = clientIp(request);
  if (!allowRequest(`subscribe:${ip}`)) {
    return json({ ok: false, message: 'Too many tries. Wait a bit.' }, 429);
  }

  let fields: Record<string, string>;
  try {
    fields = await parseBody(request);
  } catch {
    return json({ ok: false, message: 'Could not read that request.' }, 400);
  }

  if (fields.company.trim()) {
    return json({ ok: true, message: 'Check your inbox to confirm.' });
  }

  const email = fields.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return json({ ok: false, message: 'Need a real email.' }, 400);
  }

  const source = fields.source.trim() || 'free-lesson';
  const name = fields.name.trim() || null;
  const confirmToken = token();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const cfEnv = await cloudflareEnv();
  const supabase = createServiceClient(cfEnv);
  if (!supabase) {
    return json(
      { ok: false, message: 'Subscribe is not wired yet. Set SUPABASE_* on Cloudflare Pages.' },
      503,
    );
  }

  const { data: existing, error: lookupError } = await supabase
    .from('subscribers')
    .select('id, confirmed_at')
    .eq('email_normalized', email)
    .maybeSingle();

  if (lookupError) {
    return json({ ok: false, message: 'Could not save that email.' }, 500);
  }

  let subscriberId = existing?.id as string | undefined;
  if (existing?.id) {
    const { error } = await supabase
      .from('subscribers')
      .update({
        confirm_token: confirmToken,
        confirm_expires_at: expires,
        source,
        name,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (error) return json({ ok: false, message: 'Could not save that email.' }, 500);
  } else {
    const { data, error } = await supabase
      .from('subscribers')
      .insert({
        email,
        name,
        source,
        confirm_token: confirmToken,
        confirm_expires_at: expires,
      })
      .select('id')
      .single();
    if (error || !data) return json({ ok: false, message: 'Could not save that email.' }, 500);
    subscriberId = data.id;
  }

  await supabase.from('email_events').insert({
    subscriber_id: subscriberId,
    event_type: existing?.confirmed_at ? 'confirm_resent' : 'confirm_sent',
    payload: { source },
  });

  const resendKey = readEnv('RESEND_API_KEY', cfEnv);
  const from = readEnv('RESEND_FROM', cfEnv);
  if (!resendKey || !from) {
    return json(
      { ok: false, message: 'Email sending is not wired yet. Set RESEND_* on Cloudflare Pages.' },
      503,
    );
  }

  const confirmUrl = `${siteUrl(cfEnv)}/api/confirm?token=${encodeURIComponent(confirmToken)}`;
  const resend = new Resend(resendKey);
  const already = Boolean(existing?.confirmed_at);
  const { error: sendError } = await resend.emails.send({
    from,
    to: email,
    subject: already
      ? 'Your Stick It Out lesson link'
      : 'Confirm your free lesson — Stick It Out',
    text: already
      ? `Watch lesson 01: ${siteUrl(cfEnv)}/free-lesson/watch?t=${confirmToken}`
      : `Confirm your email to watch lesson 01 (Anthem Part Two):\n${confirmUrl}\n\nDon’t flinch on the one.`,
    html: already
      ? `<p>Watch lesson 01: <a href="${siteUrl(cfEnv)}/free-lesson/watch?t=${confirmToken}">Open the lesson</a></p>`
      : `<p>Confirm your email to watch lesson 01 — Anthem Part Two.</p><p><a href="${confirmUrl}">Claim your spot</a></p><p>Don’t flinch on the one.</p>`,
  });

  if (sendError) {
    return json({ ok: false, message: 'Could not send the confirm email.' }, 502);
  }

  return json({
    ok: true,
    message: already ? 'Check your inbox for the watch link.' : 'Check your inbox to confirm.',
  });
};
