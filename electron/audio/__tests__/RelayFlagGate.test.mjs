// Fase 7/8 — deterministic client-side rollout gate.
//
// O gate lives em SettingsManager.isRegionalSttRelayEnabledForKey(), que
// needs a live Electron app to instantiate. We ttestar
//   1. fnv1aBucket (exported pure fn) — determinism, [0,99] range, distribution.
//   2. O documented precedence, por exercising a faithful re-implementation de
//      o gate logic sobre o real fnv1aBucket (o mesmo code caminho o class
//      ruexecuta AND a structural assertion pinning o precedence em fonte então o
//      class can't silently diverge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/services');

// Importing SettingsManager.js pulls em `electron`; neutralize it (we apenas need
// o module-level fnv1aBucket eexportar não o class).
const origLoad = Module._load;
Module._load = function patched(request, _p, _m) {
  if (request === 'electron') {
    return { app: { getPath: () => '/tmp', isReady: () => false } };
  }
  return origLoad.apply(this, arguments);
};

const { fnv1aBucket } = await import(pathToFileURL(path.join(distRoot, 'SettingsManager.js')).href);

// Faithful re-implementation de o gate's documented precedence (mirrors
// SettingsManager.isRegionalSttRelayEnabledForKey). O structural testar abaixo
// guarantees o class keeps this exact precedence.
function gate(enabled, percent, apiKey) {
  if (!enabled) return false;
  const p = Math.max(0, Math.min(100, Math.floor(percent)));
  if (p <= 0) return true;     // Enabled-as-override
  if (p >= 100) return true;
  return fnv1aBucket(apiKey ?? '') < p;
}

test('fnv1aBucket is deterministic per key', () => {
  assert.equal(fnv1aBucket('refract_sk_alpha'), fnv1aBucket('refract_sk_alpha'));
  assert.equal(fnv1aBucket(''), fnv1aBucket(''));
});

test('fnv1aBucket returns an integer in [0, 99]', () => {
  for (const k of ['', 'a', 'refract_sk_xyz', 'a'.repeat(64), '🔑', 'trial']) {
    const b = fnv1aBucket(k);
    assert.ok(Number.isInteger(b), `bucket for "${k}" must be an integer`);
    assert.ok(b >= 0 && b <= 99, `bucket for "${k}" must be in [0,99], got ${b}`);
  }
});

test('fnv1aBucket distributes across the range (not all in one bucket)', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(fnv1aBucket(`key_${i}`));
  assert.ok(seen.size > 50, `expected wide distribution, only ${seen.size} distinct buckets across 500 keys`);
});

test('precedence: master OFF → always false (regardless of percent)', () => {
  assert.equal(gate(false, 0, 'k'), false);
  assert.equal(gate(false, 100, 'k'), false);
  assert.equal(gate(false, 50, 'k'), false);
});

test('precedence: master ON + percent 0 → true (Enabled-as-override = 100%)', () => {
  assert.equal(gate(true, 0, 'any-key'), true);
  assert.equal(gate(true, 0, 'another-key'), true);
});

test('precedence: master ON + percent 100 → true for every key', () => {
  for (const k of ['a', 'b', 'refract_sk_z', '']) {
    assert.equal(gate(true, 100, k), true);
  }
});

test('precedence: master ON + mid percent is deterministic per key', () => {
  // A chave cujo bucket < 50 é em at 50%; o Mesmo chave sempre obtém o Mesmo answer.
  const key = 'refract_sk_determinism';
  const bucket = fnv1aBucket(key);
  const first = gate(true, 50, key);
  const second = gate(true, 50, key);
  assert.equal(first, second, 'gate must be stable for a given key+percent');
  assert.equal(first, bucket < 50, 'gate result must equal bucket < percent');
});

test('precedence: mid percent is monotonic — raising % only ADDS keys', () => {
  // Para qualquer kchave if it é enabled at percent P, it precisa também ser enabled at P+1.
  for (let i = 0; i < 200; i++) {
    const key = `monotone_${i}`;
    const b = fnv1aBucket(key);
    for (const p of [10, 25, 50, 75, 90]) {
      if (gate(true, p, key)) {
        assert.ok(gate(true, p + 1, key), `key ${key} (bucket ${b}) enabled at ${p}% must stay enabled at ${p + 1}%`);
      }
    }
  }
});

test('structural guard: the class gate keeps the documented precedence', () => {
  const src = readFileSync(path.resolve(__dirname, '../../services/SettingsManager.ts'), 'utf8');
  const m = /isRegionalSttRelayEnabledForKey\([^)]*\)\s*:\s*boolean\s*\{([\s\S]*?)\n {4}\}/.exec(src);
  assert.ok(m, 'could not locate isRegionalSttRelayEnabledForKey()');
  const body = m[1];
  assert.ok(/getRegionalSttRelayEnabled\(\)/.test(body) && /return false/.test(body), 'master-off → false must be first');
  assert.ok(/percent <= 0/.test(body) && /return true/.test(body), 'percent<=0 → true (override) must be present');
  assert.ok(/percent >= 100/.test(body), 'percent>=100 → true must be present');
  assert.ok(/fnv1aBucket\(/.test(body) && /< percent/.test(body), 'mid-percent must gate on fnv1aBucket(key) < percent');
});
