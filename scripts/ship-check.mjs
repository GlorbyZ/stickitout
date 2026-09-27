#!/usr/bin/env node
/** Fail ship if secrets leak into dist/ */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
if (!existsSync(dist)) {
  console.error('dist/ missing. Run npm run build first');
  process.exit(1);
}

const bad = [
  /DISCORD_BOT_TOKEN/i,
  /MTU0OTExODYxOTAyMjAwODM3MA\./, // known bot token prefix if ever baked in
  /SFTP_PASSWORD\s*=\s*\S+/,
  /-----BEGIN (RSA |OPENSSH )?PRIVATE KEY-----/,
];

let failed = false;
function walk(dir) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name);
    if (name.isDirectory()) walk(p);
    else if (/\.(js|html|css|mjs|map|json|php)$/i.test(name.name)) {
      if (name.name === 'capture-config.php') continue;
      const text = readFileSync(p, 'utf8');
      for (const re of bad) {
        if (re.test(text)) {
          console.error('FAIL secret-like pattern in', path.relative(root, p));
          failed = true;
        }
      }
    }
  }
}
walk(dist);

if (!existsSync(path.join(dist, 'api', 'capture.php'))) {
  console.error('FAIL missing dist/api/capture.php. Email capture will not work');
  failed = true;
}

if (failed) process.exit(1);
console.log('ship-check OK (capture.php present, no secrets)');
