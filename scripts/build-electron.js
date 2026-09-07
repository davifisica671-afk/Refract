#!/usr/bin/env node
/**
 * Fast electron build using esbuild (transpile-only, no type checking).
 * ~10-50x faster than `tsc` for dev builds.
 * Run `npm run typecheck:electron` separately for type safety.
 */

const { build } = require('esbuild');
const path = require('path');
const fs = require('fs');

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
  entryPoints.push(...findTs(electronDir).map(f => path.relative(rootDir, f)));
}

// Also include premium electron files if they exist
const premiumDir = path.resolve(rootDir, 'premium/electron');
const premiumPresent = fs.existsSync(premiumDir);
if (premiumPresent) {
  entryPoints.push(...findTs(premiumDir).map(f => path.relative(rootDir, f)));
}

/**
 * The `premium/` submodule holds the proprietary Edition and is absent in
 * public checkouts. Every call site already guards its require with a
 * try/catch and falls back to open-source behaviour, so a missing module is
 * handled at runtime — but esbuild would still fail the *build* by resolving
 * those paths statically.
 *
 * Marking them external keeps the require verbatim in the output: it resolves
 * normally when the submodule is present (its files still compile to
 * dist-electron/premium/... via the entryPoints above, so the relative paths
 * line up) and throws into the existing try/catch when it is not.
 *
 * The filter deliberately matches only the relative requires issued from
 * inside electron/ (`../premium/…`, `../../premium/…`). Root-level entry
 * points (`premium/electron/…`) must still be compiled, not externalised.
 */
const premiumExternal = {
  name: 'premium-external',
  setup(build) {
    build.onResolve({ filter: /^\.\.(\/\.\.)?\/premium\/electron\// }, (args) => ({
      path: args.path,
      external: true,
    }));
  },
};

if (!premiumPresent) {
  console.log(
    '[build-electron] premium/ submodule absent — building open-source core. ' +
    'Premium requires stay external and are guarded at runtime.'
  );
}

const start = Date.now();

build({
  entryPoints,
  bundle: true,           // resolve all static + dynamic imports so postProcessor
                         // is inlined and the path rewrite works (vs bundle:false
                         // which copies files as-is and leaves unresolved relative paths)
  outdir: outDir,
  outbase: rootDir,       // preserve directory structure (electron/main.ts → dist-electron/electron/main.js)
  platform: 'node',
  target: 'node20',
  format: 'cjs',          // Electron loads package.json main as CommonJS in this repo
                          // (package.json has no "type": "module").
  external: ['electron', 'better-sqlite3', 'keytar', 'sqlite-vec', '@vectorize-io/hindsight-client'],
  sourcemap: true,
  jsx: 'automatic',
  loader: {
    '.ts': 'ts',
    '.js': 'js',
  },
  logLevel: 'warning',
  plugins: [premiumExternal],
}).then(() => {
  console.log(`[build-electron] Done in ${Date.now() - start}ms`);
}).catch((err) => {
  console.error('[build-electron] Build failed:', err.message);
  process.exit(1);
});
