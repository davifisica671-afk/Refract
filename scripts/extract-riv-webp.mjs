// Extract embedded WebP assets from a Rive .riv file.
// Usage: node scripts/extract-riv-webp.mjs <file.riv> <outdir>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [file, outdir] = process.argv.slice(2);
const buf = readFileSync(file);
mkdirSync(outdir, { recursive: true });

let idx = 0;
let n = 0;
while ((idx = buf.indexOf('RIFF', idx)) !== -1) {
  if (buf.subarray(idx + 8, idx + 12).toString() === 'WEBP') {
    const size = buf.readUInt32LE(idx + 4);
    const img = buf.subarray(idx, idx + 8 + size);
    const name = join(outdir, `asset_${String(n).padStart(2, '0')}_off${idx}.webp`);
    writeFileSync(name, img);
    console.log(`@${idx}: ${size + 8} bytes -> ${name}`);
    idx += 8 + size;
    n++;
  } else {
    idx += 4;
  }
}
console.log(`total: ${n}`);
