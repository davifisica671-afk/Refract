#!/usr/bin/env node
/**
 * Fast electron build using esbuild (transpile-only, no type checking).
 * ~10-50x faster than `tsc` for dev builds.
 * Run `npm run typecheck:electron` separately for type safety.
 */

const { build } = require('esbuild');
const path = require('path');
const fs = require('fs');
const { premiumStubContents } = require('./premium-stubs.cjs');

const rootDir = path.resolve(__dirname, '..');
const outDir = path.resolve(rootDir, 'dist-electron');

const entryPoints = [];

// Function to recursively find all .ts files in a directory
const findTs = (dir) => {
  const results = [];
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) results.push(...findTs(full));
    else if (f.name.endsWith('.ts') && !f.name.endsWith('.d.ts')) results.push(full);
  }
  return results;
};

const electronDir = path.resolve(rootDir, 'electron');
if (fs.existsSync(electronDir)) {
  entryPoints.push(...findTs(electronDir).map((f) => path.relative(rootDir, f)));
}

// Also include premium electron files if they exist
const premiumDir = path.resolve(rootDir, 'premium/electron');
if (fs.existsSync(premiumDir)) {
  entryPoints.push(...findTs(premiumDir).map((f) => path.relative(rootDir, f)));
}

const start = Date.now();

// Resolves `require('../../premium/electron/...')` calls when the private,
// gitignored /premium module is absent, so a clean (open-source) checkout
// builds successfully. If the real premium files exist, they resolve normally
// (onResolve returns undefined and esbuild falls through). The fallback emits
// the canonical no-op stubs from premium-stubs.cjs so the built app degrades
// to open-source mode (LicenseManager.isPremium() === false, no-op
// orchestrator, textHasCompEvidence() === false).
const premiumStubPlugin = {
  name: 'premium-module-stub',
  setup(buildApi) {
    buildApi.onResolve({ filter: /premium\/electron\// }, (args) => {
      const abs = path.resolve(args.resolveDir, args.path);
      const candidates = [
        abs,
        `${abs}.ts`,
        `${abs}.tsx`,
        `${abs}.js`,
        `${abs}.cjs`,
        path.join(abs, 'index.ts'),
        path.join(abs, 'index.js'),
      ];
      if (candidates.some((c) => fs.existsSync(c))) {
        return undefined; // real premium module present — resolve normally
      }
      return { path: args.path, namespace: 'premium-stub' };
    });
    buildApi.onLoad({ filter: /premium\/electron\//, namespace: 'premium-stub' }, (args) => ({
      contents: premiumStubContents(path.basename(args.path)),
      loader: 'ts',
    }));
  },
};

build({
  entryPoints,
  bundle: true, // resolve all static + dynamic imports so postProcessor
  // is inlined and the path rewrite works (vs bundle:false
  // which copies files as-is and leaves unresolved relative paths)
  outdir: outDir,
  outbase: rootDir, // preserve directory structure (electron/main.ts → dist-electron/electron/main.js)
  platform: 'node',
  target: 'node20',
  format: 'cjs', // Electron loads package.json main as CommonJS in this repo
  // (package.json has no "type": "module").
  external: ['electron', 'better-sqlite3', 'keytar', 'sqlite-vec', '@vectorize-io/hindsight-client'],
  plugins: [premiumStubPlugin],
  sourcemap: true,
  jsx: 'automatic',
  loader: {
    '.ts': 'ts',
    '.js': 'js',
  },
  logLevel: 'warning',
})
  .then(() => {
    console.log(`[build-electron] Done in ${Date.now() - start}ms`);
  })
  .catch((err) => {
    console.error('[build-electron] Build failed:', err.message);
    process.exit(1);
  });
