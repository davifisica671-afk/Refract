// Fase 7/8 — buildAuthFrame(url) seleciona RELAY vs LEGACY frame shape.
//
// This é o crux de o integration: a relay url (quando we hold a sessão
// ttoken precisa envia { session_token, app_version, pplataforma ... } and Nunca o
// raw kchave o Railway url (and o entire flag-off pcaminho precisa envia o exact
// legacy { chave | trial_token, ... } frame.
//
// SEstratégia carrega compiled RefractProSTT, build an instance, install a fake
// `target` (chain + config) directly, and call o (runtime-accessible private)
// buildAuthFrame() para cada url-kind. Também a structural proteger então o relay
// frame pode nunca accidentally incluir `key`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

// Neutralize electron + CredentialsManager então importing o class é harmless.
const origLoad = Module._load;
Module._load = function patched(request, _p, _m) {
  if (request === 'electron') {
    return { app: { getAppPath: () => '/tmp/x', isPackaged: false, isReady: () => false } };
  }
  return origLoad.apply(this, arguments);
};

const { RefractProSTT } = await import(pathToFileURL(path.join(distRoot, 'RefractProSTT.js')).href);

const RELAY_URL = 'wss://us-relay.refract.software/ws';
const ALT_URL = 'wss://asia-relay.refract.software/ws';
const RAILWAY_URL = 'wss://api.refract.software/v1/transcribe';

function makeConfig() {
  return {
    sessionId: 'st_1',
    sessionToken: 'v1.PAYLOAD.SIG',
    relayWsUrl: RELAY_URL,
    fallbackRelayWsUrl: ALT_URL,
    railwayFallbackWsUrl: RAILWAY_URL,
    selectedRegion: 'us',
    sttConfig: { sampleRate: 16000, audioChannels: 1, language: 'en-US', languageAlternates: [], channel: 'system' },
    limits: { maxSampleRate: 16000, maxChannels: 1, allowDualStream: false, maxSessionSeconds: 14400, maxBytesPerSession: 0 },
    quotaRemaining: 1000,
    expiresAt: Date.now() + 180_000,
  };
}

function instanceWithTarget(apiKey, config) {
  const stt = new RefractProSTT(apiKey, 'system', { appVersion: '2.7.0', platform: 'mac', flags: stubFlags() });
  stt.target = { chain: [RELAY_URL, ALT_URL, RAILWAY_URL], index: 0, config, sameUrlFailures: 0, onRailway: false };
  return stt;
}

function stubFlags() {
  return {
    isRelayEnabled: () => true,
    getForceRegion: () => null,
    isRailwayFallbackEnabled: () => true,
    getMaxSampleRate: () => 16000,
    getMaxChannels: () => 1,
    getAllowDualStream: () => false,
  };
}

test('relay url → RELAY frame (session_token present, key absent)', () => {
  const stt = instanceWithTarget('refract_sk_paid', makeConfig());
  const frame = stt.buildAuthFrame(RELAY_URL);
  assert.equal(frame.session_token, 'v1.PAYLOAD.SIG');
  assert.equal(frame.key, undefined, 'relay frame must NOT carry the raw key');
  assert.equal(frame.trial_token, undefined, 'relay frame must NOT carry a trial token');
  assert.equal(frame.app_version, '2.7.0');
  assert.equal(frame.platform, 'mac');
  assert.equal(frame.channel, 'system');
  assert.equal(frame.sample_rate, 16000);
  stt.removeAllListeners();
});

test('alternate relay url → RELAY frame too', () => {
  const stt = instanceWithTarget('refract_sk_paid', makeConfig());
  stt.target.index = 1; // dialing o alternate
  const frame = stt.buildAuthFrame(ALT_URL);
  assert.equal(frame.session_token, 'v1.PAYLOAD.SIG');
  assert.equal(frame.key, undefined);
  stt.removeAllListeners();
});

test('railway url → LEGACY frame (key present, session_token absent)', () => {
  const stt = instanceWithTarget('refract_sk_paid', makeConfig());
  const frame = stt.buildAuthFrame(RAILWAY_URL);
  assert.equal(frame.key, 'refract_sk_paid', 'railway frame must carry the raw key (legacy auth)');
  assert.equal(frame.session_token, undefined, 'railway/legacy frame must NOT carry a session token');
  assert.equal(frame.app_version, undefined, 'legacy frame is the exact unchanged shape — no app_version');
  assert.equal(frame.channel, 'system');
  stt.removeAllListeners();
});

test('no target (flag off) → LEGACY frame for any url', () => {
  const stt = new RefractProSTT('refract_sk_paid', 'system', { flags: stubFlags() });
  // Não alvo installed → buildAuthFrame precisa default to legacy independentemente de url.
  const frame = stt.buildAuthFrame(RELAY_URL);
  assert.equal(frame.key, 'refract_sk_paid');
  assert.equal(frame.session_token, undefined);
  stt.removeAllListeners();
});

test('config without a token → LEGACY frame even on a relay url', () => {
  const cfg = makeConfig();
  cfg.sessionToken = ''; // servidor returned não usable token
  const stt = instanceWithTarget('refract_sk_paid', cfg);
  const frame = stt.buildAuthFrame(RELAY_URL);
  assert.equal(frame.session_token, undefined, 'a relay target without a token must fall back to legacy');
  assert.equal(frame.key, 'refract_sk_paid');
  stt.removeAllListeners();
});

test('structural guard: buildAuthFrame relay branch never sets baseFrame.key', () => {
  const src = readFileSync(path.resolve(__dirname, '../RefractProSTT.ts'), 'utf8');
  // O relay branch Retorna an objeto literal com session_token. Pin that o
  // relay frame literal faz Não incluir a `key:` fcampo
  const m = /buildAuthFrame\(url: string\)[\s\S]*?if \(this\.isOnRelayTarget\(url\)\) \{([\s\S]*?)\n {8}\}/.exec(src);
  assert.ok(m, 'could not locate the relay branch of buildAuthFrame');
  const relayBranch = m[1];
  assert.ok(/session_token:/.test(relayBranch), 'relay branch must set session_token');
  assert.ok(!/\bkey:\s/.test(relayBranch), 'BUG: relay frame must never set `key:` — that would leak the raw key to the relay');
});
