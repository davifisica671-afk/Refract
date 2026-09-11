// Builds FULLY TRANSPARENT replacement pills (the pill element is being removed
// entirely from the animation) padded to EXACTLY the original asset byte lengths.
// Usage: node scripts/build-transparent-pills.mjs
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';

const DIR = 'artifacts/site-v3-brand/riv-extracted';
const TARGETS = [
  { file: 'asset_01_off9458.webp', w: 756, h: 124 },
  { file: 'asset_03_off20079.webp', w: 756, h: 124 },
  { file: 'asset_04_off32868.webp', w: 418, h: 102 },
];

function padToExactRiff(webpBuf, targetLen) {
  if (webpBuf.subarray(0, 4).toString() !== 'RIFF' || webpBuf.subarray(8, 12).toString() !== 'WEBP') {
    throw new Error('not a webp riff container');
  }
  const innerSize = webpBuf.readUInt32LE(4);
  const chunks = webpBuf.subarray(12, 12 + innerSize);
  let D = targetLen - (12 + chunks.length);
  if (D < 8) throw new Error(`need ${targetLen}, have ${12 + chunks.length}`);
  let L = D - 8;
  if (L % 2 !== 0) L -= 1;
  const occupied = 8 + L + (L % 2);
  D -= occupied;
  if (D !== 0) throw new Error(`cannot pad exactly: leftover ${D} (parity)`);
  const riffSize = Buffer.alloc(4);
  riffSize.writeUInt32LE(4 + chunks.length + occupied, 0);
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(L, 0);
  return Buffer.concat([Buffer.from('RIFF'), riffSize, Buffer.from('WEBP'), chunks, Buffer.from('padP'), lenBuf, Buffer.alloc(L + (L % 2))]);
}

const emptySvg = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"></svg>`;

for (const t of TARGETS) {
  const orig = readFileSync(`${DIR}/${t.file}`);
  let done = false;
  for (const aq of [90, 80, 70, 60, 50, 100, 40]) {
    if (done) break;
    for (const q of [80, 70, 90, 60]) {
      const webp = await sharp(Buffer.from(emptySvg(t.w, t.h)))
        .resize(t.w, t.h)
        .webp({ quality: q, alphaQuality: aq, lossless: false })
        .toBuffer();
      const D = orig.length - webp.length;
      if (D >= 8 && D % 2 === 0) {
        const padded = padToExactRiff(webp, orig.length);
        // verify: fully transparent + same dims
        const { data, info } = await sharp(padded).raw().toBuffer({ resolveWithObject: true });
        if (info.width !== t.w || info.height !== t.h) throw new Error(`dims ${info.width}x${info.height}`);
        let nonTransparent = 0;
        for (let i = 3; i < data.length; i += info.channels) if (data[i] !== 0) nonTransparent++;
        if (nonTransparent > 0) throw new Error(`${nonTransparent} non-transparent pixels`);
        writeFileSync(`${DIR}/empty_${t.file}`, padded);
        console.log(`${t.file}: orig=${orig.length} new=${padded.length} transparent=${nonTransparent === 0} dims=${info.width}x${info.height}`);
        done = true;
        break;
      }
    }
  }
  if (!done) throw new Error(`could not pad ${t.file}`);
}
console.log('ALL DONE');
