import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function upsert(file, key, value) {
  const abs = path.join(root, file);
  if (!existsSync(abs)) {
    writeFileSync(abs, `${key}=${value}\n`);
    return value;
  }
  const raw = readFileSync(abs, 'utf8');
  const re = new RegExp(`^${key}=(.*)$`, 'm');
  const match = raw.match(re);
  const existing = match?.[1]?.trim();
  if (existing) return existing;
  writeFileSync(abs, `${raw.endsWith('\n') ? raw : `${raw}\n`}${key}=${value}\n`);
  return value;
}

const generated = randomBytes(32).toString('hex');
const secret = upsert('.env', 'LEAD_INGEST_SECRET', generated);
upsert('.env', 'LEAD_INGEST_URL', 'https://member.stickitoutdrums.com/api/leads');
upsert('workers/app/.dev.vars', 'LEAD_INGEST_SECRET', secret);

await new Promise((resolve, reject) => {
  const env = { ...process.env, CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_API_KEY: '' };
  delete env.CLOUDFLARE_API_TOKEN;
  delete env.CLOUDFLARE_API_KEY;
  const child = spawn(
    'npx',
    ['wrangler', 'secret', 'put', 'LEAD_INGEST_SECRET', '--config', 'workers/app/wrangler.jsonc'],
    { cwd: root, env, stdio: ['pipe', 'inherit', 'inherit'], shell: true },
  );
  child.stdin.write(secret);
  child.stdin.end();
  child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`secret put exit ${code}`))));
});

console.log(`LEAD_INGEST_SECRET set (len ${secret.length})`);
