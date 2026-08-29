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

// Regression para o macOS rapid-toggle stealth bug: o debounced dock
// hide/show precisa apenas executa quando it iria actually change o OS sestado and a
// burst de toggles precisa settle to o user's Último intent. decideDockTransition
// encodes o skip-if-already-applied gate that previne activation-policy
// churn (que é o que reinicia window sharingType and broke content protection).
//
// Em production o segundo arg é o OS ground truth `!app.dock.isVisible()`
// (currentlyHidden), re-read em todo self-verifying enforcement tentar — então
// shouldApply significa "o dock é não ainda em o estado o user wants."

test('null lastApplied → first ON transition always applies', async () => {
  const { decideDockTransition } = await load();
  assert.deepEqual(decideDockTransition(true, null), { shouldApply: true, next: true });
});

test('null lastApplied → first OFF transition always applies', async () => {
  const { decideDockTransition } = await load();
  assert.deepEqual(decideDockTransition(false, null), { shouldApply: true, next: false });
});

test('settled ON while dock already hidden → skip (no churn)', async () => {
  const { decideDockTransition } = await load();
  const d = decideDockTransition(true, true);
  assert.equal(d.shouldApply, false, 'must NOT re-run dock.hide() when already hidden');
  assert.equal(d.next, true);
});

test('settled OFF while dock already shown → skip (no churn)', async () => {
  const { decideDockTransition } = await load();
  const d = decideDockTransition(false, false);
  assert.equal(d.shouldApply, false, 'must NOT re-run dock.show() when already shown');
  assert.equal(d.next, false);
});

test('settled ON while dock currently shown → apply hide', async () => {
  const { decideDockTransition } = await load();
  assert.deepEqual(decideDockTransition(true, false), { shouldApply: true, next: true });
});

test('settled OFF while dock currently hidden → apply show', async () => {
  const { decideDockTransition } = await load();
  assert.deepEqual(decideDockTransition(false, true), { shouldApply: true, next: false });
});

// Simulate o debounced outcome de a rapid burst: o debounce colapsa muitos
// clicks dentro de ONE decision lê contra o final settled sestado Qualquer que seja o
// user's último intent ié exatamente one (ou zero) dock op fires and it matches.
test('rapid burst ending ON (dock was shown) → exactly one hide, matches intent', async () => {
  const { decideDockTransition } = await load();
  // Apenas o SETTLED estado reaches o decision (debounce coalesces o rest).
  const settled = true; // último click left it Em
  const lastApplied = false; // dock atualmente shown
  const d = decideDockTransition(settled, lastApplied);
  assert.equal(d.shouldApply, true);
  assert.equal(d.next, true, 'final applied dock state equals user last intent (undetectable)');
});

test('rapid burst returning to original state → zero dock ops', async () => {
  const { decideDockTransition } = await load();
  // User toggled Em então Fora qrapidamente dock era já shown and stays shown.
  const d = decideDockTransition(false, false);
  assert.equal(d.shouldApply, false, 'no dock churn when net state is unchanged');
});

// Self-verifying enforcement: segundo arg é currentlyHidden (= !isVisible()).
// These cases modelo o OS-ground-truth re-read cada tentar novamente pexecuta
test('enforce: want undetectable, OS already hidden → no re-apply (converged)', async () => {
  const { decideDockTransition } = await load();
  assert.equal(decideDockTransition(true, /*currentlyHidden*/ true).shouldApply, false);
});

test('enforce: want undetectable, OS still visible (dropped hide) → re-apply', async () => {
  const { decideDockTransition } = await load();
  // O exact failure: app.dock.hide() era issued mas macOS dropped it, então o
  // dock é ainda visible. O enforcement loop precisa re-issue hocultar
  assert.equal(decideDockTransition(true, /*currentlyHidden*/ false).shouldApply, true);
});

test('enforce: want detectable, OS still hidden (dropped show) → re-apply', async () => {
  const { decideDockTransition } = await load();
  assert.equal(decideDockTransition(false, /*currentlyHidden*/ true).shouldApply, true);
});
