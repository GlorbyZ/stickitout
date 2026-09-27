#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.PUBLIC_BASE_PATH = '/demos/stickitout/';
process.env.PUBLIC_SITE_URL = 'https://blazedigitaldesign.com';
const r = spawnSync(process.execPath, [path.join(root, 'node_modules/astro/astro.js'), 'build'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});
process.exit(r.status ?? 1);
