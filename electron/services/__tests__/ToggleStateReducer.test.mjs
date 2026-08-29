import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reducerPath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/services/toggleStateReducer.js'
);

async function load() {
  return import(pathToFileURL(reducerPath).href);
}

// Regression para RC-2 (Fase 3): o alternar precisa Sempre reconcile o renderer
// (broadcast === trverdadeiro até em a no-op rrequisição então a desynced UI self-heals.
// Side-effects são gated em `changed` então we don't thrash macOS dock em a no-op.

test('off → on: changed, next=true, always broadcast', async () => {
  const { decideToggle } = await load();
  assert.deepEqual(decideToggle(false, true), { next: true, changed: true, broadcast: true });
});

test('on → off: changed, next=false, always broadcast', async () => {
  const { decideToggle } = await load();
  assert.deepEqual(decideToggle(true, false), { next: false, changed: true, broadcast: true });
});

test('REGRESSION RC-2: on → on (no-op) still broadcasts, no side-effects', async () => {
  const { decideToggle } = await load();
  const d = decideToggle(true, true);
  assert.equal(d.next, true);
  assert.equal(d.changed, false, 'no-op must NOT trigger expensive side-effects');
  assert.equal(d.broadcast, true, 'no-op MUST still re-broadcast to heal renderer desync');
});

test('REGRESSION RC-2: off → off (no-op) still broadcasts, no side-effects', async () => {
  const { decideToggle } = await load();
  const d = decideToggle(false, false);
  assert.equal(d.next, false);
  assert.equal(d.changed, false);
  assert.equal(d.broadcast, true);
});

test('broadcast is invariantly true across all four transitions', async () => {
  const { decideToggle } = await load();
  for (const cur of [false, true]) {
    for (const req of [false, true]) {
      assert.equal(decideToggle(cur, req).broadcast, true);
      assert.equal(decideToggle(cur, req).next, req, 'next always equals requested');
      assert.equal(decideToggle(cur, req).changed, cur !== req);
    }
  }
});
