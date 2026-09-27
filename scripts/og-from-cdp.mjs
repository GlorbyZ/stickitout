#!/usr/bin/env node
/**
 * Decode a CDP Page.captureScreenshot response into a JPG social image.
 * Usage: node scripts/og-from-cdp.mjs <cdp-response.json> <public/img/social/og-home.jpg>
 */
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: og-from-cdp.mjs <cdp.json> <out.jpg>');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(input, 'utf8'));
const b64 = raw?.data ?? raw?.result?.data;
if (!b64) {
  console.error('no screenshot data in', input, Object.keys(raw));
  process.exit(1);
}

mkdirSync(path.dirname(output), { recursive: true });
const buf = Buffer.from(b64, 'base64');
const meta = await sharp(buf).metadata();
await sharp(buf).jpeg({ quality: 86, progressive: true, mozjpeg: true }).toFile(output);
console.log(`${output} <- ${meta.width}x${meta.height}`);
