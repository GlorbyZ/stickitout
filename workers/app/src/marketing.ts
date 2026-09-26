import { audit, html, readForm, redirect, type Person, type RequestCtx } from './auth';
import {
  adminMarketingCampaignDetail,
  adminMarketingCampaigns,
  adminMarketingLists,
  adminMarketingOverview,
  adminMarketingSuppressions,
  adminMarketingTemplates,
  adminMarketingTest,
  adminMarketingTopics,
} from './html';
import {
  ensureContactProperties,
  ensureSioSegments,
  resend,
  resendList,
  textToHtml,
  upsertContact,
  withUnsubscribe,
  type Broadcast,
  type Contact,
  type Domain,
  type MetricsTotals,
  type Segment,
  type Suppression,
  type Template,
  type Topic,
} from './resend';

type Ctx = RequestCtx;

function q(ctx: Ctx): { note: string; error: string } {
  return {
    note: ctx.url.searchParams.get('n') || '',
    error: ctx.url.searchParams.get('e') || '',
  };
}

function go(base: string, path: string, note?: string, error?: string): Response {
  const u = new URL(path, 'https://admin.stickitoutdrums.com');
  if (note) u.searchParams.set('n', note);
  if (error) u.searchParams.set('e', error);
  return redirect(`${base}${u.pathname}${u.search}`);
}

function localToIso(value: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString();
}

async function peopleForSync(
  db: D1Database,
): Promise<{ email: string; name: string; status: string; plan: string | null }[]> {
  const { results } = await db
    .prepare(
      `SELECT p.email, p.name, m.status, m.plan
       FROM people p
       JOIN memberships m ON m.person_id = p.id
       ORDER BY p.created_at ASC`,
    )
    .all<{ email: string; name: string; status: string; plan: string | null }>();
  return results || [];
}

async function syncD1ToResend(env: Env): Promise<{ ok: number; failed: number; leftover: number; error?: string }> {
  await ensureContactProperties(env);
  const segs = await ensureSioSegments(env);
  if (!segs.all) return { ok: 0, failed: 0, leftover: 0, error: 'Could not create SIO All segment' };
  const people = await peopleForSync(env.DB);
  const knownRows = await resendList<Contact>(env, '/contacts');
  const known = new Map(knownRows.map((c) => [c.email.toLowerCase(), c]));
  const max = 180;
  let ok = 0;
  let failed = 0;
  for (const person of people) {
    if (ok + failed >= max) break;
    const ids: string[] = [];
    if (person.status !== 'canceled' && segs.all) ids.push(segs.all.id);
    if (person.status === 'waitlist' && segs.waitlist) ids.push(segs.waitlist.id);
    if (person.status === 'founding' && segs.founding) ids.push(segs.founding.id);
    if (person.status === 'active' && segs.active) ids.push(segs.active.id);
    const res = await upsertContact(env, person, ids, known);
    if (res.ok) ok += 1;
    else failed += 1;
  }
  return { ok, failed, leftover: Math.max(0, people.length - ok - failed) };
}

async function listSegmentContacts(env: Env, segmentId: string): Promise<Contact[]> {
  const byQuery = await resendList<Contact>(env, `/contacts?segment_id=${encodeURIComponent(segmentId)}`);
  if (byQuery.length) return byQuery;
  return resendList<Contact>(env, `/segments/${segmentId}/contacts`);
}

export async function marketingFetch(request: Request, env: Env, ctx: Ctx, admin: Person): Promise<Response> {
  const { base, path } = ctx;
  const flash = q(ctx);

  if (path === '/marketing/sync' && request.method === 'POST') {
    const result = await syncD1ToResend(env);
    await audit(env.DB, admin.email, `marketing.sync ok=${result.ok} fail=${result.failed}`);
    if (result.error) return go(base, '/marketing', undefined, result.error);
    const leftover = result.leftover ? ` ${result.leftover} left. Run sync again.` : '';
    return go(base, '/marketing', `Synced ${result.ok}. Failed ${result.failed}.${leftover}`);
  }

  if (path === '/marketing/campaigns' && request.method === 'POST') {
    const body = await readForm(request);
    const intent = body.intent || 'draft';
    if ((intent === 'send' || intent === 'schedule') && body.confirm !== 'SEND') {
      return go(base, '/marketing/campaigns', undefined, 'Check the confirmation box before sending or scheduling.');
    }
    if (intent === 'schedule' && !body.scheduled_at) {
      return go(base, '/marketing/campaigns', undefined, 'Pick a schedule time.');
    }
    let htmlBody = (body.html || '').trim();
    const text = (body.text || '').trim();
    if (!htmlBody && text) htmlBody = textToHtml(text);
    if (!htmlBody) return go(base, '/marketing/campaigns', undefined, 'Add HTML or plain text.');
    htmlBody = withUnsubscribe(htmlBody);
    const payload: Record<string, unknown> = {
      name: (body.name || body.subject || 'Untitled').trim(),
      segment_id: body.segment_id,
      from: (body.from || env.MAIL_FROM).trim(),
      subject: (body.subject || '').trim(),
      html: htmlBody,
    };
    if (body.reply_to.trim()) payload.reply_to = body.reply_to.trim();
    if (body.topic_id.trim()) payload.topic_id = body.topic_id.trim();
    if (body.template_id.trim()) payload.template_id = body.template_id.trim();
    if (intent === 'send') payload.send = true;
    if (intent === 'schedule') {
      payload.send = true;
      payload.scheduled_at = localToIso(body.scheduled_at);
    }
    const created = await resend<Broadcast>(env, '/broadcasts', { method: 'POST', body: JSON.stringify(payload) });
    await audit(env.DB, admin.email, `marketing.campaign.${intent} ${created.data.id || created.error}`);
    if (!created.ok) return go(base, '/marketing/campaigns', undefined, created.error);
    const msg = intent === 'send' ? 'Campaign is sending.' : intent === 'schedule' ? 'Campaign scheduled.' : 'Draft saved.';
    return go(base, `/marketing/campaigns/${created.data.id}`, msg);
  }

  const campaignId = path.match(/^\/marketing\/campaigns\/([0-9a-f-]+)$/i);
  if (campaignId && request.method === 'POST') {
    const id = campaignId[1];
    const body = await readForm(request);
    const action = body.action || 'send';
    if (action === 'delete') {
      const res = await resend(env, `/broadcasts/${id}`, { method: 'DELETE' });
      return res.ok ? go(base, '/marketing/campaigns', 'Draft deleted.') : go(base, '/marketing/campaigns', undefined, res.error);
    }
    if (action === 'duplicate') {
      const res = await resend<Broadcast>(env, `/broadcasts/${id}/duplicate`, { method: 'POST', body: '{}' });
      return res.ok
        ? go(base, `/marketing/campaigns/${res.data.id || id}`, 'Duplicated as a draft.')
        : go(base, `/marketing/campaigns/${id}`, undefined, res.error);
    }
    if (action === 'cancel') {
      const res = await resend(env, `/broadcasts/${id}/cancel`, { method: 'POST', body: '{}' });
      return res.ok ? go(base, `/marketing/campaigns/${id}`, 'Canceled.') : go(base, `/marketing/campaigns/${id}`, undefined, res.error);
    }
    const res = await resend(env, `/broadcasts/${id}/send`, { method: 'POST', body: '{}' });
    await audit(env.DB, admin.email, `marketing.campaign.send ${id}`);
    return res.ok ? go(base, `/marketing/campaigns/${id}`, 'Campaign is sending.') : go(base, `/marketing/campaigns/${id}`, undefined, res.error);
  }

  if (path === '/marketing/lists' && request.method === 'POST') {
    const body = await readForm(request);
    if (body.action === 'create_segment') {
      const res = await resend<Segment>(env, '/segments', { method: 'POST', body: JSON.stringify({ name: body.name.trim() }) });
      return res.ok ? go(base, '/marketing/lists', 'List created.') : go(base, '/marketing/lists', undefined, res.error);
    }
    const payload: Record<string, unknown> = {
      email: body.email.trim().toLowerCase(),
      first_name: body.first_name.trim() || undefined,
      last_name: body.last_name.trim() || undefined,
    };
    if (body.segment_id) payload.segments = [{ id: body.segment_id }];
    const res = await resend(env, '/contacts', { method: 'POST', body: JSON.stringify(payload) });
    return res.ok
      ? go(base, `/marketing/lists${body.segment_id ? `?segment=${encodeURIComponent(body.segment_id)}` : ''}`, 'Contact added.')
      : go(base, '/marketing/lists', undefined, res.error);
  }

  if (path === '/marketing/templates' && request.method === 'POST') {
    const body = await readForm(request);
    const payload: Record<string, unknown> = {
      name: body.name.trim(),
      html: withUnsubscribe(body.html.trim()),
      from: (body.from || env.MAIL_FROM).trim(),
    };
    if (body.alias.trim()) payload.alias = body.alias.trim();
    if (body.subject.trim()) payload.subject = body.subject.trim();
    const res = await resend(env, '/templates', { method: 'POST', body: JSON.stringify(payload) });
    return res.ok ? go(base, '/marketing/templates', 'Template created. Publish it before using.') : go(base, '/marketing/templates', undefined, res.error);
  }

  const templateId = path.match(/^\/marketing\/templates\/([0-9a-f-]+)$/i);
  if (templateId && request.method === 'POST') {
    const id = templateId[1];
    const body = await readForm(request);
    if (body.action === 'delete') {
      const res = await resend(env, `/templates/${id}`, { method: 'DELETE' });
      return res.ok ? go(base, '/marketing/templates', 'Template deleted.') : go(base, '/marketing/templates', undefined, res.error);
    }
    if (body.action === 'duplicate') {
      const res = await resend(env, `/templates/${id}/duplicate`, { method: 'POST', body: '{}' });
      return res.ok ? go(base, '/marketing/templates', 'Template duplicated.') : go(base, '/marketing/templates', undefined, res.error);
    }
    const res = await resend(env, `/templates/${id}/publish`, { method: 'POST', body: '{}' });
    return res.ok ? go(base, '/marketing/templates', 'Template published.') : go(base, '/marketing/templates', undefined, res.error);
  }

  if (path === '/marketing/topics' && request.method === 'POST') {
    const body = await readForm(request);
    const res = await resend(env, '/topics', {
      method: 'POST',
      body: JSON.stringify({
        name: body.name.trim(),
        description: body.description.trim() || undefined,
        default_subscription: body.default_subscription || 'opt_in',
        visibility: body.visibility || 'public',
      }),
    });
    return res.ok ? go(base, '/marketing/topics', 'Topic created.') : go(base, '/marketing/topics', undefined, res.error);
  }

  const topicId = path.match(/^\/marketing\/topics\/([0-9a-f-]+)$/i);
  if (topicId && request.method === 'POST') {
    const res = await resend(env, `/topics/${topicId[1]}`, { method: 'DELETE' });
    return res.ok ? go(base, '/marketing/topics', 'Topic deleted.') : go(base, '/marketing/topics', undefined, res.error);
  }

  if (path === '/marketing/suppressions' && request.method === 'POST') {
    const body = await readForm(request);
    const res = await resend(env, '/suppressions', { method: 'POST', body: JSON.stringify({ email: body.email.trim().toLowerCase() }) });
    return res.ok ? go(base, '/marketing/suppressions', 'Suppressed.') : go(base, '/marketing/suppressions', undefined, res.error);
  }

  const suppressionId = path.match(/^\/marketing\/suppressions\/(.+)$/);
  if (suppressionId && request.method === 'POST') {
    const id = decodeURIComponent(suppressionId[1]);
    const res = await resend(env, `/suppressions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return res.ok ? go(base, '/marketing/suppressions', 'Removed from suppressions.') : go(base, '/marketing/suppressions', undefined, res.error);
  }

  if (path === '/marketing/test' && request.method === 'POST') {
    const body = await readForm(request);
    const res = await resend(env, '/emails', {
      method: 'POST',
      body: JSON.stringify({
        from: (body.from || env.MAIL_FROM).trim(),
        to: [body.to.trim().toLowerCase()],
        subject: body.subject.trim(),
        html: withUnsubscribe(body.html.trim() || '<p>SIO test</p>'),
      }),
    });
    await audit(env.DB, admin.email, `marketing.test ${body.to}`);
    return res.ok ? go(base, '/marketing/test', 'Test email sent.') : go(base, '/marketing/test', undefined, res.error);
  }

  if (path === '/marketing/campaigns') {
    const [segments, topics, templates, broadcasts] = await Promise.all([
      resendList<Segment>(env, '/segments'),
      resendList<Topic>(env, '/topics'),
      resendList<Template>(env, '/templates'),
      resendList<Broadcast>(env, '/broadcasts'),
    ]);
    return html(
      adminMarketingCampaigns(base, admin, {
        segments,
        topics,
        templates,
        broadcasts,
        from: env.MAIL_FROM,
        ...flash,
      }),
    );
  }

  if (campaignId) {
    const id = campaignId[1];
    const [broadcast, metrics] = await Promise.all([
      resend<Broadcast>(env, `/broadcasts/${id}`),
      resend<{ totals?: MetricsTotals }>(env, `/emails/metrics?broadcast_id=${id}`),
    ]);
    if (!broadcast.ok) return go(base, '/marketing/campaigns', undefined, broadcast.error);
    return html(
      adminMarketingCampaignDetail(base, admin, {
        broadcast: broadcast.data,
        totals: metrics.data.totals || null,
        ...flash,
      }),
    );
  }

  if (path === '/marketing/lists') {
    const segments = await resendList<Segment>(env, '/segments');
    const selected = ctx.url.searchParams.get('segment') || segments[0]?.id || '';
    const contacts = selected
      ? await listSegmentContacts(env, selected)
      : await resendList<Contact>(env, '/contacts');
    return html(adminMarketingLists(base, admin, { segments, contacts, selected, ...flash }));
  }

  if (path === '/marketing/templates') {
    const templates = await resendList<Template>(env, '/templates');
    return html(adminMarketingTemplates(base, admin, { templates, from: env.MAIL_FROM, ...flash }));
  }

  if (path === '/marketing/topics') {
    const topics = await resendList<Topic>(env, '/topics');
    return html(adminMarketingTopics(base, admin, { topics, ...flash }));
  }

  if (path === '/marketing/suppressions') {
    const items = await resendList<Suppression>(env, '/suppressions');
    return html(adminMarketingSuppressions(base, admin, { items, ...flash }));
  }

  if (path === '/marketing/test') {
    return html(adminMarketingTest(base, admin, { from: env.MAIL_FROM, ...flash }));
  }

  if (path === '/marketing' || path === '/marketing/') {
    const [domainsRes, metricsRes, segs, broadcasts] = await Promise.all([
      resend<{ data?: Domain[] }>(env, '/domains'),
      resend<{ totals?: MetricsTotals }>(env, '/emails/metrics'),
      resendList<Segment>(env, '/segments'),
      resendList<Broadcast>(env, '/broadcasts'),
    ]);
    const waitlist = await countStatus(env.DB, 'waitlist');
    const founding = await countStatus(env.DB, 'founding');
    const active = await countStatus(env.DB, 'active');
    return html(
      adminMarketingOverview(base, admin, {
        domains: domainsRes.data.data || [],
        totals: metricsRes.data.totals || null,
        d1: { waitlist, founding, active },
        segments: segs,
        broadcasts,
        apiError: domainsRes.ok ? '' : domainsRes.error,
        ...flash,
      }),
    );
  }

  return html('<p>Not found</p>', 404);
}

async function countStatus(db: D1Database, status: string): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM memberships WHERE status = ?').bind(status).first<{ n: number }>();
  return row?.n || 0;
}
