// Generates the orb app icon (PNG + ICO) without image tools: a tiny PNG encoder over raw RGBA.
// Run: node scripts/make-icons.mjs  → resources/icon.png, resources/icon.ico, resources/tray.png
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// Design-system.md tokens: night-950 background, reactor-500 core, reactor-300 highlight.
const NIGHT = [6, 10, 18];
const REACTOR = [63, 216, 245];
const HIGHLIGHT = [147, 236, 255];
function orb(x, y, size) {
  const c = size / 2;
  const d = Math.hypot(x - c, y - c) / (size / 2);
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  if (d > 1) return [0, 0, 0, 0];
  const edge = Math.min(1, (1 - d) * size * 0.5); // anti-aliased outer edge
  let rgb = NIGHT;
  if (d < 0.92 && d > 0.8) rgb = mix(NIGHT, REACTOR, 0.55); // ring
  if (d <= 0.5) rgb = REACTOR; // core
  if (d <= 0.22) rgb = HIGHLIGHT;
  if (d > 0.5 && d < 0.8) rgb = mix(NIGHT, REACTOR, Math.max(0, 0.35 - (d - 0.5)));
  return [...rgb, Math.round(255 * edge)];
}
mkdirSync('resources', { recursive: true });
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map((s) => png(s, orb));
writeFileSync('resources/icon.png', pngs[pngs.length - 1]);
writeFileSync('resources/tray.png', png(32, orb));
// ICO container with embedded PNGs (supported since Windows Vista).
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e[0] = s >= 256 ? 0 : s; e[1] = s >= 256 ? 0 : s; e[2] = 0; e[3] = 0;
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  return e;
});
writeFileSync('resources/icon.ico', Buffer.concat([header, ...entries, ...pngs]));
console.log('icons written');
