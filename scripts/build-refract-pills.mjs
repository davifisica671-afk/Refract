// Builds "Refract" replacement pills for the Cluely assets inside meeting-card.riv.
// Each replacement WebP is padded (custom RIFF chunk) to EXACTLY the original byte
// length, so the .riv can be patched byte-for-byte with zero stream impact.
// Usage: node scripts/build-refract-pills.mjs
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';

const DIR = 'artifacts/site-v3-brand/riv-extracted';
const TARGETS = [
  { file: 'asset_01_off9458.webp', w: 756, h: 124, alpha: 1.0, radius: 34 },
  { file: 'asset_03_off20079.webp', w: 756, h: 124, alpha: 0.55, radius: 34 },
  { file: 'asset_04_off32868.webp', w: 418, h: 102, alpha: 0.45, radius: 28 },
];

function pillSvg(w, h, r, alpha, fontSize) {
  // icon: circle + refracting diagonal line, muted gray
  const cx = fontSize * 1.9;
  const cy = h / 2;
  const ir = fontSize * 0.72;
  const textX = cx + ir + fontSize * 0.55;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <g opacity="${alpha}">
    <rect x="0" y="0" width="${w - 2}" height="${h - 2}" rx="${r}" ry="${r}" fill="#ECEEF6" stroke="#D8DBE8" stroke-width="1.5"/>
    <circle cx="${cx}" cy="${cy}" r="${ir}" fill="none" stroke="#9AA0B5" stroke-width="${(fontSize * 0.09).toFixed(1)}"/>
    <line x1="${cx - ir * 0.85}" y1="${cy + ir * 0.55}" x2="${cx + ir * 0.85}" y2="${cy - ir * 0.55}" stroke="#9AA0B5" stroke-width="${(fontSize * 0.09).toFixed(1)}"/>
    <text x="${textX}" y="${cy}" font-family="Segoe UI, Arial, sans-serif" font-size="${fontSize}" font-weight="600" fill="#7A8095" dominant-baseline="central">Refract</text>
  </g>
</svg>`;
}

async function encodeWebp(svg, w, h) {
  return sharp(Buffer.from(svg)).resize(w, h).webp({ quality: 90, alphaQuality: 90 }).toBuffer();
}

function padToExactRiff(webpBuf, targetLen) {
  // Build a RIFF container with the same chunks plus a custom 'padP' chunk so the
  // total length equals targetLen exactly. WebP decoders ignore unknown chunks.
  if (webpBuf.subarray(0, 4).toString() !== 'RIFF' || webpBuf.subarray(8, 12).toString() !== 'WEBP') {
    throw new Error('not a webp riff container');
  }
  const innerSize = webpBuf.readUInt32LE(4);
  const chunks = webpBuf.subarray(12, 12 + innerSize); // all real chunks
  let D = targetLen - (12 + chunks.length);
  if (D < 8) throw new Error(`need ${targetLen}, have ${12 + chunks.length}; re-encode smaller`);
  // chunk occupies 8 + L + (L&1) — must consume exactly D
  let L = D - 8;
  if (L % 2 !== 0) L -= 1; // occupied = 8+L+1
  const occupied = 8 + L + (L % 2);
  D -= occupied;
  if (D !== 0) throw new Error(`cannot pad exactly: leftover ${D} (parity) — re-encode with different quality`);
  const head = Buffer.from('RIFF');
  const riffSize = Buffer.alloc(4);
  riffSize.writeUInt32LE(4 + chunks.length + occupied, 0); // 'WEBP' + chunks + pad chunk
  const out = Buffer.concat([head, riffSize, Buffer.from('WEBP'), chunks, Buffer.from('padP'), (() => { const b = Buffer.alloc(4); b.writeUInt32LE(L, 0); return b; })(), Buffer.alloc(L + (L % 2))]);
  if (out.length !== targetLen) throw new Error(`pad mismatch ${out.length} != ${targetLen}`);
  return out;
}

for (const t of TARGETS) {
  const orig = readFileSync(`${DIR}/${t.file}`);
  const fontSize = Math.round(t.h * 0.42);
  let webp, attempt = 0;
  for (let q = 90; q >= 40 && attempt < 30; q -= 2, attempt++) {
    webp = await encodeWebp(pillSvg(t.w, t.h, t.radius, t.alpha, fontSize), t.w, t.h);
    const D = orig.length - webp.length;
    if (D >= 8 && D % 2 === 0) break;
    webp = null;
  }
  if (!webp) throw new Error(`could not encode ${t.file} small enough`);
  const padded = padToExactRiff(webp, orig.length);
  writeFileSync(`${DIR}/refract_${t.file}`, padded);
  console.log(`${t.file}: orig=${orig.length} new=${padded.length} OK`);
  // verify decodes with same dimensions
  const m = await sharp(padded).metadata();
  if (m.width !== t.w || m.height !== t.h) throw new Error(`dims mismatch ${m.width}x${m.height}`);
  console.log(`  dims ${m.width}x${m.height} verified`);
}
console.log('ALL DONE');
