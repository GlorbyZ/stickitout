#!/usr/bin/env node
/**
 * Copy production or demo dist into Blaze/demos/stickitout for portfolio ship.
 * Prefer: npm run build:demo && npm run sync:blaze-demo
 */
import { cpSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const dest = path.resolve(root, '../Blaze/demos/stickitout');

if (!existsSync(dist)) {
  console.error('dist/ missing. Run npm run build:demo first');
  process.exit(1);
}
if (!existsSync(path.dirname(dest))) {
  console.error('Blaze repo not found at ../Blaze');
  process.exit(1);
}

mkdirSync(dest, { recursive: true });
for (const name of [
  'index.html',
  'account',
  'assets',
  'api',
  'brand',
  'brand-lab.html',
  'challenges',
  'credits.md',
  'data',
  'free-lesson',
  'humans.txt',
  'img',
  'lessons',
  'llms.txt',
  'membership',
  'payment',
  'portal',
  'robots.txt',
  'sitemap.xml',
  'unlock',
  '.htaccess',
]) {
  const from = path.join(dist, name);
  if (!existsSync(from)) continue;
  const to = path.join(dest, name);
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}

writeFileSync(
  path.join(dest, 'shipit.js'),
  `/** @see scripts/ship/manifest.mjs for demos:stickitout */\nimport { runShip } from '../../scripts/ship/run.mjs';\nconst extra = process.argv.slice(2).filter((a) => a === '--only' || a === '--clean');\nrunShip('demos:stickitout', extra);\n`,
  'utf8',
);

console.log('Synced dist → Blaze/demos/stickitout');
console.log('From Blaze root: npm run ship -- demos:stickitout');
