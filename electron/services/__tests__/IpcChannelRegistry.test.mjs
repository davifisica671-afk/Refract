// Drift detector for the canonical IPC channel registry.
//
// electron/ipc/ipcChannels.mjs is the committed, human-readable inventory of
// every IPC channel (name, kind, category, wiring). This test re-scans the
// live Electron sources with the same shared scanner (electron/ipc/ipcScan.mjs)
// and asserts the committed registry matches reality EXACTLY, in both
// directions:
//
//   missing — a channel exists in code but is absent from the registry
//             (someone added a channel and forgot to regenerate the registry).
//   stale   — a channel is in the registry but no longer exists in code
//             (someone removed/renamed a channel and forgot to regenerate).
//   changed — a channel's wiring moved (handler registered in a different
//             file, handler dropped, etc.).
//
// Fix all three by running:  node scripts/gen-ipc-registry.mjs
//
// This is the same class of bug that the fixed repo-indexer channels
// (get-setting / set-setting / dialog:selectFolder) had: channels exposed in
// preload with no matching handler. The registry + this test make that drift
// impossible to reintroduce silently.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { IPC_CHANNELS } from '../../ipc/ipcChannels.mjs';
import { scanIpcSurface, buildRegistryRecords } from '../../ipc/ipcScan.mjs';

const REGEN_HINT = '\nRun `node scripts/gen-ipc-registry.mjs` to regenerate the registry.';

function core(r) {
  const rec = { name: r.name, kind: r.kind, handlers: r.handlers, senders: r.senders };
  if (r.orphan) rec.orphan = true;
  return rec;
}

function diffRegistry(actual, expected) {
  const a = new Map(actual.map(r => [`${r.kind}:${r.name}`, r]));
  const e = new Map(expected.map(r => [`${r.kind}:${r.name}`, r]));
  const missing = [...e.keys()].filter(k => !a.has(k)).sort();
  const stale = [...a.keys()].filter(k => !e.has(k)).sort();
  const changed = [...e.keys()]
    .filter(k => a.has(k) && !isDeepStrictEqual(a.get(k), e.get(k)))
    .sort();
  return { missing, stale, changed, a, e };
}

const surface = scanIpcSurface();
const expected = buildRegistryRecords(surface);
const actual = IPC_CHANNELS.map(core);

test('registry has no duplicate (kind, name) entries', () => {
  const keys = actual.map(r => `${r.kind}:${r.name}`);
  assert.strictEqual(new Set(keys).size, keys.length, 'duplicate channel entries found');
});

test('registry is a substantial inventory (guards against an empty/degenerate scan)', () => {
  assert.ok(actual.length >= 300, `expected 300+ channels, got ${actual.length}`);
  for (const probe of ['get-setting', 'dialog:selectFolder', 'repo-index:scan', 'gemini-chat-stream']) {
    assert.ok(actual.some(r => r.name === probe), `registry must contain '${probe}'`);
  }
});

test('registry exactly matches the live IPC surface (no drift)', () => {
  const { missing, stale, changed } = diffRegistry(actual, expected);
  assert.deepStrictEqual(missing, [], `channels in code but missing from registry: ${missing.join(', ')}${REGEN_HINT}`);
  assert.deepStrictEqual(stale, [], `channels in registry but no longer in code: ${stale.join(', ')}${REGEN_HINT}`);
  assert.deepStrictEqual(changed, [], `channels whose wiring changed: ${changed.join(', ')}${REGEN_HINT}`);
});

test('every non-orphan invoke channel has a registered handler', () => {
  const missingHandlers = actual
    .filter(r => r.kind === 'invoke' && !r.orphan && r.handlers.length === 0)
    .map(r => r.name)
    .sort();
  // toggle-advanced-settings is known dead code: exposed in preload
  // (toggleAdvancedSettings) but never handled — pre-existing, tracked here
  // explicitly so a NEW missing handler cannot hide behind it.
  assert.deepStrictEqual(missingHandlers, ['toggle-advanced-settings'],
    `invoke channels with no handler (beyond the known toggle-advanced-settings): ${missingHandlers.join(', ')}`);
});
