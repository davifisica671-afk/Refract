#!/usr/bin/env node
/**
 * create-premium-stubs.mjs — writes the canonical premium stubs as local,
 * gitignored files under /premium.
 *
 * NOTE: since the esbuild premium-stub plugin landed in scripts/build-electron.js,
 * `npm run build:electron` now self-heals from a clean checkout and this script
 * is OPTIONAL. It remains useful when you want the stub modules present on disk
 * (e.g. so your editor/IDE resolves the premium imports for local typecheck).
 *
 * The stub definitions themselves live in scripts/premium-stubs.cjs, shared
 * with the build-time fallback so the two can never drift apart.
 *
 * Usage:
 *     node scripts/create-premium-stubs.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { STUBS, STUB_PATHS } = require('./premium-stubs.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const premiumDir = path.join(root, 'premium', 'electron');

for (const [basename, rel] of Object.entries(STUB_PATHS)) {
  const full = path.join(premiumDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const header = `// LOCAL DEV STUB — lives in gitignored /premium. The real private premium
// module is not committed. Canonical stub content: scripts/premium-stubs.cjs.
`;
  const content = header + STUBS[basename];
  if (fs.existsSync(full)) {
    console.log(`skip   ${rel} (already exists — left untouched)`);
    continue;
  }
  fs.writeFileSync(full, content);
  console.log(`wrote  ${rel}`);
}

console.log('\nDone. /premium is gitignored, so these stubs will not be committed.');
