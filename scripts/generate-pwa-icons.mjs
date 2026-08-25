#!/usr/bin/env node
/**
 * generate-pwa-icons.mjs — PWA icon generator (roadmap Phase 3 "PWA install").
 *
 * Renders the OpenClaw Desktop launcher icons (icons/icon-192.png, icons/icon-512.png)
 * as real PNGs using ONLY Node built-ins (zlib deflate + hand-rolled CRC32/chunks) —
 * zero new dependencies, per the work-order constraint ("programmatically ONLY if
 * trivially possible without new deps").
 *
 * Design: rounded-square tile in the base dark desktop background (#0f172a, the
 * terminal color of the .win11-desktop wallpaper gradient — same value as the
 * manifest theme_color/background_color) with a terminal-prompt glyph (accent
 * chevron + cursor underscore) in the dark-theme accent #60cdff.
 *
 * Run: node scripts/generate-pwa-icons.mjs   (idempotent; regenerates both sizes)
 */

import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'icons');

// ---- palette (kept in sync with manifest.webmanifest + sw.js docs) --------
const BG = [15, 23, 42]; // #0f172a — base dark desktop background
const FG = [96, 205, 255]; // #60cdff — dark-theme accent (--win11-accent)

// ---- geometry helpers ------------------------------------------------------
function distToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const lenSq = abx * abx + aby * aby;
  let t = lenSq === 0 ? 0 : (apx * abx + apy * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const dx = px - (ax + t * abx);
  const dy = py - (ay + t * aby);
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Render one RGBA raster of the launcher tile at size×size pixels.
 * Returns Uint8Array (RGBA, row-major).
 */
export function renderIcon(size) {
  const px = new Uint8Array(size * size * 4);
  const r = size * 0.18; // corner radius
  const stroke = size * 0.075; // glyph stroke half-width
  // Terminal prompt: chevron ">" apex + trailing cursor underscore,
  // kept inside the center ~80% so the tile doubles as a maskable icon.
  const segs = [
    [size * 0.30, size * 0.28, size * 0.50, size * 0.50],
    [size * 0.50, size * 0.50, size * 0.30, size * 0.72],
    [size * 0.58, size * 0.72, size * 0.76, size * 0.72],
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Rounded-rect coverage (supersample corners via center-inset test on
      // the pixel center — adequate at 192/512 for simple flat shapes).
      const cx = Math.min(Math.max(x + 0.5, r), size - r);
      const cy = Math.min(Math.max(y + 0.5, r), size - r);
      const inTile = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r || (x + 0.5 >= r && x + 0.5 <= size - r && y + 0.5 >= r && y + 0.5 <= size - r);
      if (!inTile) continue;
      let color = BG;
      for (const [ax, ay, bx, by] of segs) {
        if (distToSegment(x + 0.5, y + 0.5, ax, ay, bx, by) <= stroke) {
          color = FG;
          break;
        }
      }
      px[i] = color[0];
      px[i + 1] = color[1];
      px[i + 2] = color[2];
      px[i + 3] = 255;
    }
  }
  return px;
}

// ---- minimal PNG encoder (color type 6, 8-bit, filter 0) -------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function encodePNG(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- entry -----------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const size of [192, 512]) {
    const png = encodePNG(size, renderIcon(size));
    const file = path.join(OUT_DIR, `icon-${size}.png`);
    fs.writeFileSync(file, png);
    console.log(`wrote ${file} (${png.length} bytes)`);
  }
}
