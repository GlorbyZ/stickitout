#!/usr/bin/env node
/**
 * Crop + resize the Downloads logos into assets/brand and public/img/brand.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const downloads = 'C:/Users/epicn/Downloads/stickitout';
const glyphIn = path.join(downloads, 'Transparent PNG Edge Smoothing.png');
const wordIn = path.join(downloads, 'Transparent PNG Edge Smoothing (1).png');
const brandDir = path.join(root, 'assets/brand');
const publicBrand = path.join(root, 'public/img/brand');
mkdirSync(brandDir, { recursive: true });
mkdirSync(publicBrand, { recursive: true });

async function litBBox(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      if (data[i + 3] > 12 && data[i] + data[i + 1] + data[i + 2] > 60) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function cropTransparent(file, padPx) {
  const box = await litBBox(file);
  const meta = await sharp(file).metadata();
  const left = Math.max(0, box.left - padPx);
  const top = Math.max(0, box.top - padPx);
  const width = Math.min(meta.width - left, box.width + padPx * 2);
  const height = Math.min(meta.height - top, box.height + padPx * 2);
  return sharp(file).extract({ left, top, width, height }).ensureAlpha().png();
}

const glyph = await cropTransparent(glyphIn, 12);
const glyphBuf = await glyph.png().toBuffer();
const gMeta = await sharp(glyphBuf).metadata();
const side = Math.max(gMeta.width, gMeta.height);
const squareGlyph = await sharp({
  create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite([{ input: glyphBuf, gravity: 'center' }])
  .png()
  .toBuffer();

const glyph1024 = await sharp(squareGlyph).resize(1024, 1024, { fit: 'contain' }).png().toBuffer();
writeFileSync(path.join(brandDir, 'sio-glyph.png'), glyph1024);

const word = await cropTransparent(wordIn, 8);
const wordBuf = await word.png().toBuffer();
const wMeta = await sharp(wordBuf).metadata();
const wordH = 160;
const wordW = Math.round((wMeta.width / wMeta.height) * wordH);
const wordNav = await sharp(wordBuf).resize(wordW * 2, wordH * 2).png().toBuffer();
writeFileSync(path.join(brandDir, 'sio-wordmark.png'), wordNav);
writeFileSync(path.join(publicBrand, 'wordmark.png'), wordNav);
writeFileSync(path.join(publicBrand, 'glyph.png'), glyph1024);
writeFileSync(path.join(root, 'public/img/logo.png'), glyph1024);
console.log('glyph', (await sharp(glyph1024).metadata()).width, 'wordmark', wordW * 2, 'x', wordH * 2);
