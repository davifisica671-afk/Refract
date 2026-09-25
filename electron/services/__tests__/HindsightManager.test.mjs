// HindsightManager — config resolution (settings Ou env), health-check, and o cached
// isAvailable() gate that o retain/recall paths uuso Headless-safe: SettingsManager
// needs Electron, então these tests drive getHindsightConfig via ENV (que takes precedence)
// and verifica graceful degrade quando nada é configured / o servidor é absent.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { HindsightManager, validateHindsightServerCommand } from '../../../dist-electron/electron/services/HindsightManager.js';

const requireCjs = createRequire(import.meta.url);
const HM = requireCjs('../../../dist-electron/electron/services/HindsightManager.js');
const resolveHindsightApiKey = HM.resolveHindsightApiKey;

const ENV_KEYS = ['HINDSIGHT_BASE_URL', 'HINDSIGHT_API_KEY', 'HINDSIGHT_TIMEOUT_MS'];
function clearEnv() { for (const k of ENV_KEYS) delete process.env[k]; }

describe('HindsightManager.getHindsightConfig', () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  test('returns null when nothing is configured (feature off)', () => {
    // Não env + (headless) não settings → null.
    assert.equal(HindsightManager.getInstance().getHindsightConfig(), null);
  });

  test('env HINDSIGHT_BASE_URL configures the server', () => {
    process.env.HINDSIGHT_BASE_URL = 'http://localhost:8888';
    const cfg = HindsightManager.getInstance().getHindsightConfig();
    assert.ok(cfg);
    assert.equal(cfg.baseUrl, 'http://localhost:8888');
    assert.equal(cfg.timeoutMs, 800);
  });

  test('apiKey + timeout carried from env (Cloud path)', () => {
    process.env.HINDSIGHT_BASE_URL = 'https://cloud.example/api';
    process.env.HINDSIGHT_API_KEY = 'secret';
    process.env.HINDSIGHT_TIMEOUT_MS = '1500';
    const cfg = HindsightManager.getInstance().getHindsightConfig();
    assert.equal(cfg.apiKey, 'secret');
    assert.equal(cfg.timeoutMs, 1500);
  });

  test('blank/whitespace baseUrl → null (treated as unconfigured)', () => {
    process.env.HINDSIGHT_BASE_URL = '   ';
    assert.equal(HindsightManager.getInstance().getHindsightConfig(), null);
  });
});

describe('HindsightManager.healthCheck + isAvailable', () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  test('healthCheck is false when unconfigured', async () => {
    assert.equal(await HindsightManager.getInstance().healthCheck(), false);
  });

  test('healthCheck is false (no throw) when the server is unreachable', async () => {
    process.env.HINDSIGHT_BASE_URL = 'http://127.0.0.1:59999'; // nothing listening
    const ok = await HindsightManager.getInstance().healthCheck();
    assert.equal(ok, false);
  });

  test('isAvailable false when unconfigured (gate closed → retain/recall Noop)', () => {
    assert.equal(HindsightManager.getInstance().isAvailable(), false);
  });

  test('start() never throws when unconfigured (no spawn)', async () => {
    await assert.doesNotReject(() => HindsightManager.getInstance().start());
  });

  test('start() with a baseUrl but memory flag OFF does not spawn (stays Noop)', async () => {
    process.env.HINDSIGHT_BASE_URL = 'http://127.0.0.1:59999'; // unreachable
    delete process.env.REFRACT_HINDSIGHT_MEMORY; // flag fora
    // Precisa retorna rapidamente sem spawning aqualquer coisa isAvailable stays false.
    await assert.doesNotReject(() => HindsightManager.getInstance().start());
    assert.equal(HindsightManager.getInstance().isAvailable(), false);
  });

  test('stop() never throws when nothing is app-managed', async () => {
    await assert.doesNotReject(() => HindsightManager.getInstance().stop());
  });

  // OPT-IN: com a real servidor running, healthCheck passes and isAvailable gates oabrir
  test('healthCheck TRUE against a live server', { skip: process.env.HINDSIGHT_LIVE_TEST !== '1' && 'set HINDSIGHT_LIVE_TEST=1 + run the dev server' }, async () => {
    process.env.HINDSIGHT_BASE_URL = process.env.HINDSIGHT_BASE_URL || 'http://localhost:8888';
    const mgr = HindsightManager.getInstance();
    assert.equal(await mgr.healthCheck(), true);
    assert.equal(mgr.isAvailable(), true);
  });
});

describe('validateHindsightServerCommand (security: no-shell RCE guard)', () => {
  test('empty string → ok with empty argv (feature off)', () => {
    assert.deepEqual(validateHindsightServerCommand(''), { ok: true, argv: [] });
    assert.deepEqual(validateHindsightServerCommand('   '), { ok: true, argv: [] });
  });

  test('unquoted shell metacharacters are rejected', () => {
    for (const evil of ['node`id`', 'node$(id)', 'node;rm -rf ~', 'node|cat /etc/passwd']) {
      const r = validateHindsightServerCommand(evil);
      assert.equal(r.ok, false, evil);
    }
  });

  test('nonexistent binary is rejected', () => {
    const r = validateHindsightServerCommand('definitely-not-a-real-binary-xyz123 --flag');
    assert.equal(r.ok, false);
  });

  test('interpreter without a script is rejected', () => {
    const r = validateHindsightServerCommand('node');
    assert.equal(r.ok, false);
    assert.match(r.error || '', /script/);
  });

  test('quoted path with spaces to a real temp file → ok with argv', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hindsight cmd '));
    const exe = path.join(dir, 'my server.sh');
    fs.writeFileSync(exe, '#!/bin/sh\necho hi\n');
    try {
      const r = validateHindsightServerCommand(`"${exe}" --port 8888`);
      assert.equal(r.ok, true);
      assert.deepEqual(r.argv, [exe, '--port', '8888']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('bash with a real temp script → ok', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hindsight bash '));
    const script = path.join(dir, 'start.sh');
    fs.writeFileSync(script, '#!/bin/sh\necho hi\n');
    try {
      const r = validateHindsightServerCommand(`bash "${script}"`);
      assert.equal(r.ok, true);
      assert.deepEqual(r.argv, ['bash', script]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('cmd /c calc → rejected (interpreter gate)', () => {
    const r = validateHindsightServerCommand('cmd /c calc');
    assert.equal(r.ok, false);
    assert.match(r.error || '', /script/i);
  });

  test('powershell -Command "x" → rejected (interpreter gate)', () => {
    const r = validateHindsightServerCommand('powershell -Command "x"');
    assert.equal(r.ok, false);
    assert.match(r.error || '', /script/i);
  });

  test('version-suffixed interpreter python3.11 -c "x" → rejected', () => {
    // Shim python3.11 onto PATH so version-stripping is exercised where it isn't installed.
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hindsight pybin '));
    const prevPath = process.env.PATH || '';
    try {
      for (const name of ['python3.11', 'python3.11.exe']) {
        const p = path.join(binDir, name);
        fs.writeFileSync(p, 'stub');
        try { fs.chmodSync(p, 0o755); } catch { /* windows */ }
      }
      process.env.PATH = binDir + path.delimiter + prevPath;
      const r = validateHindsightServerCommand('python3.11 -c "x"');
      assert.equal(r.ok, false);
      assert.match(r.error || '', /script/i);
    } finally {
      process.env.PATH = prevPath;
      fs.rmSync(binDir, { recursive: true, force: true });
    }
  });

  test('perl with a real temp script → ok', () => {
    // Shim perl onto PATH so the test passes where perl isn't installed.
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hindsight perlbin '));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hindsight perl '));
    const script = path.join(dir, 'script.pl');
    fs.writeFileSync(script, 'print "hi";\n');
    const prevPath = process.env.PATH || '';
    try {
      for (const name of ['perl', 'perl.exe']) {
        const p = path.join(binDir, name);
        fs.writeFileSync(p, 'stub');
        try { fs.chmodSync(p, 0o755); } catch { /* windows */ }
      }
      process.env.PATH = binDir + path.delimiter + prevPath;
      const r = validateHindsightServerCommand(`perl "${script}"`);
      assert.equal(r.ok, true);
      assert.deepEqual(r.argv, ['perl', script]);
    } finally {
      process.env.PATH = prevPath;
      fs.rmSync(binDir, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('resolveHindsightApiKey (security: safeStorage migration, one-time legacy fallback)', () => {
  // Fakes: in-memory stand-ins for CredentialsManager (encrypted store) and
  // SettingsManager (legacy plaintext settings.json).
  function makeStore(initial, persist = true) {
    let value = initial;
    const calls = { sets: [] };
    return {
      store: {
        getHindsightApiKey: () => value,
        setHindsightApiKey: (k) => { value = k; calls.sets.push(k); },
        isPersistenceAvailable: () => persist,
      },
      calls,
      peek: () => value,
    };
  }
  function makeLegacy(initial) {
    let value = initial;
    const calls = { sets: [] };
    return {
      settings: {
        get: (k) => (k === 'hindsightApiKey' ? value : undefined),
        set: (k, v) => { if (k === 'hindsightApiKey') { value = v; calls.sets.push(v); } },
      },
      calls,
      peek: () => value,
    };
  }

  test('exports resolveHindsightApiKey', () => {
    assert.equal(typeof resolveHindsightApiKey, 'function', 'HindsightManager.js must export resolveHindsightApiKey');
  });

  test('legacy present → moved to store + legacy cleared', () => {
    const s = makeStore(undefined, true);
    const l = makeLegacy('  legacy-key-123  ');
    const out = resolveHindsightApiKey(s.store, l.settings);
    assert.equal(out, 'legacy-key-123');
    assert.equal(s.peek(), 'legacy-key-123');
    assert.deepEqual(s.calls.sets, ['legacy-key-123']);
    assert.equal(l.peek(), undefined, 'legacy plaintext key must be cleared after migration');
    assert.deepEqual(l.calls.sets, [undefined]);
  });

  test('store hit wins; legacy left untouched', () => {
    const s = makeStore('cm-key', true);
    const l = makeLegacy('legacy-key');
    const out = resolveHindsightApiKey(s.store, l.settings);
    assert.equal(out, 'cm-key');
    assert.deepEqual(s.calls.sets, []);
    assert.deepEqual(l.calls.sets, []);
    assert.equal(l.peek(), 'legacy-key');
  });

  test('nothing anywhere → undefined, no writes', () => {
    const s = makeStore(undefined, true);
    const l = makeLegacy(undefined);
    assert.equal(resolveHindsightApiKey(s.store, l.settings), undefined);
    assert.deepEqual(s.calls.sets, []);
    assert.deepEqual(l.calls.sets, []);
  });

  test('whitespace-only legacy treated as absent (no migration writes)', () => {
    const s = makeStore(undefined, true);
    const l = makeLegacy('   ');
    assert.equal(resolveHindsightApiKey(s.store, l.settings), undefined);
    assert.deepEqual(s.calls.sets, []);
    assert.deepEqual(l.calls.sets, []);
  });

  test('encryption unavailable → value usable this session but legacy KEPT (fail closed)', () => {
    const s = makeStore(undefined, false);
    const l = makeLegacy('legacy-key');
    const out = resolveHindsightApiKey(s.store, l.settings);
    assert.equal(out, 'legacy-key');
    assert.deepEqual(s.calls.sets, ['legacy-key'], 'memory-only copy still set for this session');
    assert.deepEqual(l.calls.sets, [], 'durable legacy copy must NOT be cleared');
    assert.equal(l.peek(), 'legacy-key');
  });

  test('store unavailable (null) → legacy passthrough without clearing', () => {
    const l = makeLegacy('legacy-key');
    assert.equal(resolveHindsightApiKey(null, l.settings), 'legacy-key');
    assert.deepEqual(l.calls.sets, []);
    assert.equal(l.peek(), 'legacy-key');
  });

  test('store value is trimmed on return', () => {
    const s = makeStore('  cm-key  ', true);
    const l = makeLegacy(undefined);
    assert.equal(resolveHindsightApiKey(s.store, l.settings), 'cm-key');
    assert.deepEqual(l.calls.sets, []);
  });
});
