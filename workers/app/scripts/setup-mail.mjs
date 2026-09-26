import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DOMAIN = 'stickitoutdrums.com';
const ZONE_ID = 'b25d2a1a127602d047a00108e0c956e5';

function loadDevVars() {
  const text = readFileSync(join(import.meta.dirname, '..', '.dev.vars'), 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

function loadCfToken() {
  const fromEnv = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
  const vars = loadDevVars();
  if ((vars.CLOUDFLARE_API_TOKEN || '').trim()) return vars.CLOUDFLARE_API_TOKEN.trim();
  const toml = readFileSync(join(homedir(), 'AppData/Roaming/xdg.config/.wrangler/config/default.toml'), 'utf8');
  const token = toml.match(/oauth_token = "([^"]+)"/)?.[1];
  if (!token) throw new Error('No Cloudflare token');
  return token;
}

function stripQuotes(value) {
  return String(value || '')
    .trim()
    .replace(/^"+|"+$/g, '')
    .replace(/\.$/, (m, _off, s) => (s.includes('amazonses') || s.includes('resend') || s.includes('dkim') ? m : ''));
}

function cfName(name) {
  let n = String(name || '')
    .trim()
    .replace(/\.$/, '');
  if (n.endsWith(`.${DOMAIN}`)) n = n.slice(0, -(DOMAIN.length + 1));
  if (n === DOMAIN || n === '@' || n === '') return '@';
  return n;
}

async function resend(path, key, opts = {}) {
  const res = await fetch(`https://api.resend.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

async function cf(path, token, opts = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

const vars = loadDevVars();
const key = (process.env.RESEND_API_KEY || vars.RESEND_API_KEY || '').trim();
if (!key) {
  console.error('Missing RESEND_API_KEY');
  process.exit(1);
}
const token = loadCfToken();

const listed = await resend('/domains', key);
if (!listed.ok) {
  console.log(JSON.stringify({ step: 'list_domains', status: listed.status, error: listed.json }, null, 2));
  process.exit(1);
}

let domain = (listed.json.data || []).find((d) => d.name === DOMAIN);
if (!domain) {
  const created = await resend('/domains', key, {
    method: 'POST',
    body: JSON.stringify({
      name: DOMAIN,
      region: 'us-east-1',
      open_tracking: false,
      click_tracking: false,
      capabilities: { sending: 'enabled', receiving: 'disabled' },
    }),
  });
  if (!created.ok) {
    console.log(JSON.stringify({ step: 'create_domain', status: created.status, error: created.json }, null, 2));
    process.exit(1);
  }
  domain = created.json;
}

const detail = await resend(`/domains/${domain.id}`, key);
if (detail.ok) domain = detail.json;

const records = domain.records || [];
console.log(
  JSON.stringify(
    {
      step: 'resend_domain',
      id: domain.id,
      name: domain.name,
      status: domain.status,
      records: records.map((r) => ({
        record: r.record,
        type: r.type,
        name: r.name,
        value: r.value,
        priority: r.priority,
        status: r.status,
        ttl: r.ttl,
      })),
    },
    null,
    2,
  ),
);

const existing = await cf(`/zones/${ZONE_ID}/dns_records?per_page=100`, token);
if (!existing.ok) {
  console.log(JSON.stringify({ step: 'list_dns', status: existing.status, errors: existing.json.errors }, null, 2));
  process.exit(1);
}

const have = existing.json.result || [];
const dnsLog = [];

async function upsert({ type, name, content, priority }) {
  const host = cfName(name);
  const value = stripQuotes(content);
  const match = have.find(
    (row) => row.type === type && row.name === (host === '@' ? DOMAIN : `${host}.${DOMAIN}`),
  );
  const body = { type, name: host, content: value, ttl: 1, proxied: false };
  if (type === 'MX' && priority != null) body.priority = Number(priority);
  if (match) {
    if (match.content.replace(/\.$/, '') === value.replace(/\.$/, '') && (type !== 'MX' || match.priority === body.priority)) {
      dnsLog.push({ action: 'exists', type, name: host });
      return;
    }
    const upd = await cf(`/zones/${ZONE_ID}/dns_records/${match.id}`, token, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    dnsLog.push({ action: 'update', type, name: host, ok: upd.ok, errors: upd.json.errors });
    return;
  }
  const created = await cf(`/zones/${ZONE_ID}/dns_records`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  dnsLog.push({ action: 'create', type, name: host, ok: created.ok, errors: created.json.errors });
}

for (const rec of records) {
  if (!rec.type || !rec.value) continue;
  if (String(rec.record).toLowerCase() === 'tracking') continue;
  await upsert({
    type: rec.type,
    name: rec.name,
    content: rec.value,
    priority: rec.priority ?? 10,
  });
}

const dmarc = have.find((row) => row.type === 'TXT' && row.name === `_dmarc.${DOMAIN}`);
if (!dmarc) {
  await upsert({ type: 'TXT', name: '_dmarc', content: 'v=DMARC1; p=none;' });
} else {
  dnsLog.push({ action: 'exists', type: 'TXT', name: '_dmarc' });
}

console.log(JSON.stringify({ step: 'dns', dnsLog }, null, 2));

const verified = await resend(`/domains/${domain.id}/verify`, key, { method: 'POST' });
console.log(
  JSON.stringify(
    {
      step: 'verify',
      status: verified.status,
      ok: verified.ok,
      domain_status: verified.json.status || verified.json.data?.status,
      error: verified.json.message || verified.json.error || verified.json.name,
    },
    null,
    2,
  ),
);
