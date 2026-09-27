import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Client from 'ssh2-sftp-client';
import { getSftpConfig, loadEnv, resolveWebRoot } from './ship/lib.mjs';

loadEnv();

const ingestUrl = (process.env.LEAD_INGEST_URL || 'https://member.stickitoutdrums.com/api/leads').trim();
const secret = (process.env.LEAD_INGEST_SECRET || '').trim();
if (!secret) {
  console.error('Missing LEAD_INGEST_SECRET in .env');
  process.exit(1);
}

const client = new Client();
await client.connect(getSftpConfig());
let raw = '[]';
try {
  const webRoot = await resolveWebRoot(client);
  const remote = `${webRoot === '/' ? '' : webRoot}/data/leads.json`.replace(/\/+/g, '/');
  const dir = await mkdtemp(path.join(tmpdir(), 'sio-leads-'));
  const local = path.join(dir, 'leads.json');
  const kind = await client.exists(remote);
  if (kind !== '-') {
    console.log(`No ${remote} on IONOS`);
  } else {
    await client.fastGet(remote, local);
    raw = await readFile(local, 'utf8');
  }
} finally {
  await client.end();
}

const rows = JSON.parse(raw);
if (!Array.isArray(rows) || !rows.length) {
  console.log('No IONOS leads to import');
  process.exit(0);
}

const byEmail = new Map();
for (const row of rows) {
  const email = String(row.email || '')
    .trim()
    .toLowerCase();
  if (!email.includes('@')) continue;
  const prev = byEmail.get(email);
  const updated = row.updatedAt || row.createdAt || '';
  if (!prev || String(prev.updatedAt || prev.createdAt || '') <= updated) byEmail.set(email, row);
}

let ok = 0;
let fail = 0;
for (const row of byEmail.values()) {
  const res = await fetch(ingestUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      'User-Agent': 'SIO-Import/1.0',
    },
    body: JSON.stringify({
      name: row.name || '',
      email: row.email,
      source: row.source || 'waitlist',
      plan: row.plan || null,
    }),
  });
  const body = await res.text();
  if (res.ok) ok += 1;
  else {
    fail += 1;
    console.log(`fail ${row.email} ${res.status} ${body.slice(0, 180)}`);
  }
}
console.log(`Imported ${ok} unique emails. Failed ${fail}.`);
