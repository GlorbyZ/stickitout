#!/usr/bin/env node
/**
 * Build the favicon / app icon set from a single square source glyph.
 * Source: assets/brand/sio-glyph.png  ->  public/icons/* and public/favicon.*
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'assets/brand/sio-glyph.png');
const iconsDir = path.join(root, 'public/icons');
const publicDir = path.join(root, 'public');

if (!existsSync(src)) {
  console.error('missing source glyph:', src);
  process.exit(1);
}

mkdirSync(iconsDir, { recursive: true });

const BG = { r: 0x0c, g: 0x0b, b: 0x0a, alpha: 1 };

/** Square PNG at an exact size, flattened onto the brand background. */
async function png(size, { padRatio = 0 } = {}) {
  const inner = Math.round(size * (1 - padRatio * 2));
  const glyph = await sharp(src).resize(inner, inner, { fit: 'contain', background: BG }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: glyph, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Minimal ICO writer. ICO supports PNG-compressed entries, which every current browser reads. */
function buildIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  entries.forEach((entry, i) => {
    const at = i * 16;
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 0); // width
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1); // height
    dir.writeUInt8(0, at + 2); // palette
    dir.writeUInt8(0, at + 3); // reserved
    dir.writeUInt16LE(1, at + 4); // color planes
    dir.writeUInt16LE(32, at + 6); // bits per pixel
    dir.writeUInt32LE(entry.data.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += entry.data.length;
  });

  return Buffer.concat([header, dir, ...entries.map((e) => e.data)]);
}

const glyph64 = await png(64);
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Stick It Out">
  <image href="data:image/png;base64,${glyph64.toString('base64')}" width="64" height="64"/>
</svg>
`;

const pinnedPng = await sharp(src)
  .resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
let pathD = '';
const { data, info } = pinnedPng;
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    const a = data[(y * info.width + x) * 4 + 3];
    if (a > 80) pathD += `M${x} ${y}h1v1h-1z`;
  }
}
const pinnedSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path fill="black" d="${pathD}"/>
</svg>
`;

const targets = [
  ['icons/favicon-96.png', 96, {}],
  ['icons/apple-touch-icon.png', 180, { padRatio: 0.08 }],
  ['icons/icon-192.png', 192, {}],
  ['icons/icon-512.png', 512, {}],
  // Maskable: art must sit inside the 80% safe circle, so pad harder.
  ['icons/icon-maskable-512.png', 512, { padRatio: 0.14 }],
  ['icons/mstile-150.png', 150, {}],
];

for (const [rel, size, opts] of targets) {
  writeFileSync(path.join(root, 'public', rel), await png(size, opts));
  console.log('wrote', rel);
}

const ico = buildIco([
  { size: 16, data: await png(16) },
  { size: 32, data: await png(32) },
  { size: 48, data: await png(48) },
]);
writeFileSync(path.join(publicDir, 'favicon.ico'), ico);
console.log('wrote favicon.ico');

writeFileSync(path.join(publicDir, 'favicon.svg'), faviconSvg, 'utf8');
writeFileSync(path.join(iconsDir, 'favicon.svg'), faviconSvg, 'utf8');
writeFileSync(path.join(iconsDir, 'safari-pinned-tab.svg'), pinnedSvg, 'utf8');
console.log('wrote svg icons');

// Member and admin portals are a separate origin (Cloudflare Worker assets),
// so they need their own copy of the icon set.
const portalDir = path.join(root, 'workers/app/static');
const portalIcons = path.join(portalDir, 'icons');
mkdirSync(portalIcons, { recursive: true });

for (const [rel, size, opts] of [
  ['icons/icon-192.png', 192, {}],
  ['icons/icon-512.png', 512, {}],
  ['icons/icon-maskable-512.png', 512, { padRatio: 0.14 }],
  ['apple-touch-icon.png', 180, { padRatio: 0.08 }],
]) {
  writeFileSync(path.join(portalDir, rel), await png(size, opts));
  console.log('wrote portal', rel);
}

writeFileSync(path.join(portalDir, 'favicon.ico'), ico);
writeFileSync(path.join(portalDir, 'favicon.svg'), faviconSvg, 'utf8');

const portalManifest = {
  id: '/',
  name: 'Stick It Out',
  short_name: 'Stick It Out',
  description: 'Practice, lessons, and streaks.',
  lang: 'en',
  dir: 'ltr',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  display_override: ['standalone', 'minimal-ui'],
  orientation: 'portrait',
  background_color: '#0C0B0A',
  theme_color: '#0C0B0A',
  categories: ['education', 'music'],
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
writeFileSync(path.join(portalDir, 'site.webmanifest'), `${JSON.stringify(portalManifest, null, 2)}\n`, 'utf8');
console.log('wrote portal favicon.ico, favicon.svg, site.webmanifest');
