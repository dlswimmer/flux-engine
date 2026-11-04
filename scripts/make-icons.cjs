// Generates the app icons in public/ (no image tooling needed): a teal Flux ring
// around an amber Shard core on the game's background color.
//   node scripts/make-icons.cjs
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

const BG = [13, 16, 22];
const RING = [79, 209, 197];
const CORE = [246, 173, 85];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function icon(size) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  const c = size / 2;
  // Stays inside the maskable safe zone (inner 80%).
  const ringOuter = size * 0.34, ringInner = size * 0.26, core = size * 0.13;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      // 1px anti-aliasing on every edge
      const ring = Math.min(Math.max(ringOuter - d + 0.5, 0), 1) * Math.min(Math.max(d - ringInner + 0.5, 0), 1);
      const dot = Math.min(Math.max(core - d + 0.5, 0), 1);
      const px = BG.map((bg, i) => Math.round(bg + (RING[i] - bg) * ring + (CORE[i] - bg) * dot));
      raw.set(px, y * (size * 3 + 1) + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const out = path.join(__dirname, "..", "public");
for (const size of [180, 192, 512]) fs.writeFileSync(path.join(out, `icon-${size}.png`), icon(size));
console.log("icons written to public/");
