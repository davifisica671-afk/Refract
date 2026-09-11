// Extract embedded images from a Rive .riv binary (and any binary file).
// Usage: node scripts/extract-riv-images.mjs <file.riv> <outdir>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [file, outdir] = process.argv.slice(2);
const buf = readFileSync(file);
mkdirSync(outdir, { recursive: true });

let count = 0;
// PNG: signature ... IEND chunk (8-byte length already past; IEND = 4 len + 4 tag + 4 crc)
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let idx = 0;
while ((idx = buf.indexOf(PNG_SIG, idx)) !== -1) {
  // find IEND after start
  const iend = buf.indexOf('IEND', idx + 8);
  if (iend === -1) break;
  const end = iend + 8; // 4 bytes length field before 'IEND' tag? IEND chunk: len(4)+'IEND'+crc(4) -> end = pos_of_IEND + 4 + 4
  const png = buf.subarray(idx, end);
  const name = join(outdir, `embedded_${count}_${idx}.png`);
  writeFileSync(name, png);
  console.log(`PNG @${idx}: ${png.length} bytes -> ${name}`);
  count++;
  idx = end;
}
// JPEG: FFD8FF ... FFD9
let j = 0;
const SOI = Buffer.from([0xff, 0xd8, 0xff]);
while ((j = buf.indexOf(SOI, j)) !== -1) {
  const eoi = buf.indexOf(Buffer.from([0xff, 0xd9]), j + 3);
  if (eoi === -1) break;
  const jpg = buf.subarray(j, eoi + 2);
  if (jpg.length > 1000) {
    const name = join(outdir, `embedded_jpg_${count}_${j}.jpg`);
    writeFileSync(name, jpg);
    console.log(`JPG @${j}: ${jpg.length} bytes -> ${name}`);
    count++;
  }
  j += 3;
}
console.log(`total: ${count}`);
