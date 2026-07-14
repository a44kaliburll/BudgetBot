// Generates renderer/assets/icon.png (256px) and build/icon.ico (multi-size)
// with zero dependencies: a tiny rasterizer + PNG encoder + ICO wrapper.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------------- PNG encoder ----------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---------------- vector-ish rasterizer ----------------
// All geometry in unit coords [0,1]; supersampled 4x4 per pixel.
function lerp(a, b, t) { return a + (b - a) * t; }

function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = x1 + t * dx, qy = y1 + t * dy;
  return Math.hypot(px - qx, py - qy);
}

// egg half-width profile: t in [-1 (top), 1 (bottom)]
function eggHalfWidth(t) {
  const base = Math.sqrt(Math.max(0, 1 - t * t));
  return base * (1 + 0.22 * t) * 0.72; // narrower top, fuller bottom
}

function renderIcon(size) {
  const SS = 4; // supersampling
  const px = Buffer.alloc(size * size * 4);
  const bgA = hexToRgb('#122036');   // deep navy
  const bgB = hexToRgb('#0c1626');
  const eggTop = hexToRgb('#3987e5'); // blue
  const eggBot = hexToRgb('#1baf7a'); // aqua
  const white = [255, 255, 255];

  const cornerR = 0.225;
  // egg geometry (unit coords)
  const eggCx = 0.5, eggCy = 0.54, eggRy = 0.335;
  // trend line points inside egg
  const line = [
    [0.335, 0.645],
    [0.46, 0.51],
    [0.545, 0.585],
    [0.685, 0.42]
  ];
  const lineW = 0.042;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;

          // rounded-square mask
          const qx = Math.max(Math.abs(u - 0.5) - (0.5 - cornerR), 0);
          const qy = Math.max(Math.abs(v - 0.5) - (0.5 - cornerR), 0);
          if (Math.hypot(qx, qy) > cornerR) continue; // transparent

          // background diagonal gradient
          let t = (u + v) / 2;
          let cr = lerp(bgA[0], bgB[0], t), cg = lerp(bgA[1], bgB[1], t), cb = lerp(bgA[2], bgB[2], t);

          // egg
          const et = (v - eggCy) / eggRy;
          if (et >= -1 && et <= 1) {
            const hw = eggHalfWidth(et) * eggRy;
            if (Math.abs(u - eggCx) <= hw) {
              const gt = (et + 1) / 2;
              cr = lerp(eggTop[0], eggBot[0], gt);
              cg = lerp(eggTop[1], eggBot[1], gt);
              cb = lerp(eggTop[2], eggBot[2], gt);
              // subtle top-left highlight
              const hl = Math.max(0, 1 - Math.hypot(u - 0.42, v - 0.38) / 0.16) * 0.18;
              cr = lerp(cr, 255, hl); cg = lerp(cg, 255, hl); cb = lerp(cb, 255, hl);
            }
          }

          // white trend line (rounded joints via segment distance)
          let onLine = false;
          for (let i = 0; i < line.length - 1; i++) {
            if (distToSegment(u, v, line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]) < lineW / 2) { onLine = true; break; }
          }
          // end dot
          if (Math.hypot(u - line[3][0], v - line[3][1]) < lineW * 0.72) onLine = true;
          if (onLine) { cr = white[0]; cg = white[1]; cb = white[2]; }

          r += cr; g += cg; b += cb; a += 255;
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      // premultiplied-look edges: average color over covered samples only
      const covered = a / 255;
      if (covered > 0) {
        px[i] = Math.round(r / covered);
        px[i + 1] = Math.round(g / covered);
        px[i + 2] = Math.round(b / covered);
        px[i + 3] = Math.round(a / n);
      }
    }
  }
  return px;
}

// ---------------- ICO wrapper ----------------
function makeIco(pngBySize) {
  const entries = Object.entries(pngBySize).map(([s, buf]) => ({ size: Number(s), buf }));
  entries.sort((a, b) => b.size - a.size);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + entries.length * 16;
  const dirs = [], blobs = [];
  for (const e of entries) {
    const d = Buffer.alloc(16);
    d[0] = e.size >= 256 ? 0 : e.size;
    d[1] = e.size >= 256 ? 0 : e.size;
    d[2] = 0; d[3] = 0;
    d.writeUInt16LE(1, 4);   // planes
    d.writeUInt16LE(32, 6);  // bpp
    d.writeUInt32LE(e.buf.length, 8);
    d.writeUInt32LE(offset, 12);
    offset += e.buf.length;
    dirs.push(d);
    blobs.push(e.buf);
  }
  return Buffer.concat([header, ...dirs, ...blobs]);
}

// ---------------- main ----------------
const root = path.join(__dirname, '..');
const sizes = [256, 128, 64, 48, 32, 16];
const pngs = {};
for (const s of sizes) {
  process.stdout.write(`rendering ${s}px... `);
  pngs[s] = encodePNG(s, renderIcon(s));
}
console.log('done');

fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.mkdirSync(path.join(root, 'renderer', 'assets'), { recursive: true });
fs.writeFileSync(path.join(root, 'renderer', 'assets', 'icon.png'), pngs[256]);
fs.writeFileSync(path.join(root, 'build', 'icon.ico'), makeIco(pngs));
console.log('wrote renderer/assets/icon.png and build/icon.ico');
