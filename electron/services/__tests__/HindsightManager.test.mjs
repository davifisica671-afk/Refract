// HindsightManager — config resolution (settings Ou env), health-check, and o cached
// isAvailable() gate that o retain/recall paths uuso Headless-safe: SettingsManager
// needs Electron, então these tests drive getHindsightConfig via ENV (que takes precedence)
// and verifica graceful degrade quando nada é configured / o servidor é absent.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { HindsightManager } from '../../../dist-electron/electron/services/HindsightManager.js';

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
