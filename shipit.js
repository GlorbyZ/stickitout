#!/usr/bin/env node
/** @see scripts/ship/cli.mjs */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(__dirname, 'scripts/ship/cli.mjs');
const extra = process.argv.slice(2);
const result = spawnSync(process.execPath, [cli, 'production', ...extra], { stdio: 'inherit' });
process.exit(result.status ?? 1);
