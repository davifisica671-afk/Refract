# Building & verifying from a clean checkout (without the private /premium module)

Status: verified on Linux (Node 22) against commit `5ba3c67` and later.

## The gap

`/premium` is **gitignored** ("Local premium dev copy — never commit to public
repo"). It holds the private `LicenseManager`, `KnowledgeOrchestrator`,
`KnowledgeDatabaseManager`, `CompanyResearchEngine`, the search providers and
`types` (`DocType`). Several Electron files `require()` those modules at
runtime, each guarded by `try/catch` (see `electron/premium/featureGate.ts`,
which is explicitly meant to let the open-source version run without premium
code).

`scripts/build-electron.js` bundles with esbuild (`bundle: true`), which
resolves those `require()` calls **at build time**. From a clean checkout the
build therefore fails with:

```
✘ [ERROR] Could not resolve "../../premium/electron/services/LicenseManager"
    electron/services/PurchaseActivationService.ts:422:55
```

This means `npm run build:electron` (and the CI "Build electron" step, and
`npm test` which runs `build:electron` first) do **not** pass from a clean
checkout today.

## Fix (build now self-heals)

`scripts/build-electron.js` ships an esbuild `premium-module-stub` plugin that
intercepts `premium/electron/*` imports only when the file is absent and emits
the canonical no-op stubs from `scripts/premium-stubs.cjs`. Result: a clean
checkout builds with **no setup**, and the app degrades to open-source mode at
runtime (`LicenseManager.isPremium() === false`, no-op orchestrator,
`textHasCompEvidence() === false`). When the real premium copy is present, the
plugin passes through and the real modules are bundled as before.

Verified from a clean checkout (no `/premium`):

| Check | Result |
|---|---|
| `npm run typecheck:electron` | ✅ 0 errors |
| `npm run build:electron` | ✅ clean (plugin self-heal) |
| `npm run build:electron` with `/premium` present | ✅ clean (pass-through) |

## Optional workaround (not required)

For IDE/typecheck convenience you can still materialize the stubs as files:

```bash
node scripts/create-premium-stubs.mjs
```

The stubs live under `/premium`, which stays gitignored. The definitions are
shared with the build plugin via `scripts/premium-stubs.cjs`, so they cannot
drift apart.

## What was verified in this environment

| Check | Result |
|---|---|
| `npm install --ignore-scripts` (CI's approach) | ✅ 1305 packages in ~34s |
| `npm run typecheck:electron` | ✅ **0 errors** (green on Linux/Node 22; CI's "14 errors" note was validated on Windows/Node 24 — counts differ by OS) |
| `npm run build:electron` (with premium stubs) | ✅ clean |
| `npm run ipc:registry:check` | ✅ 18/18 |
| IPC source-scanning regression sweep (40 test files) | ✅ 353 pass / 23 fail — **identical to the `0c792d0` baseline**, so the 23 are pre-existing (LLM/telemetry/redaction/skill logic), not regressions |

## Why esbuild resolves the premium requires (background)

esbuild's `bundle: true` inlines every statically-analyzable `require()` it can
find, including the premium ones. Marking them `external` would keep the
`require()` in the output, but the output lives under `dist-electron/electron/`,
so the relative path `../../premium/...` would point at `dist-electron/premium/`
(which does not exist) — breaking the author's premium build, which currently
bundles premium code in. A correct long-term fix (stub-only-when-absent via an
esbuild `onResolve` plugin, or shipping a premium-stub that also keeps
`isPremiumAvailable()` false) needs care around `featureGate.ts` semantics and
is intentionally left out of the stubs above.
