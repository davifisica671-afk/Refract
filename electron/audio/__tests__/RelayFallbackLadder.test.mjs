// Fase 7/8 — fallback ladder advance + o flag-OFF unchanged-behavior proof.
//
// O completo WebSocket estado machine é exercised por Fase 11 integration tests.
// Aqui we drive o EXTRACTED pure helpers that o ladder é built de
// (installTarget, connectUrl, maybeAdvanceTarget, forceAdvanceTarget) and
// assert alvo advancement relay → alternate → railway, token-fatal advance,
// and — critically — that com o flag Fora o resolver é nunca chamado and
// coconectar dials BACKEND_URL com o legacy frame.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

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

function flagsOn(overrides = {}) {
  return {
    isRelayEnabled: () => true,
    getForceRegion: () => null,
    isRailwayFallbackEnabled: () => true,
    getMaxSampleRate: () => 16000,
    getMaxChannels: () => 1,
    getAllowDualStream: () => false,
    ...overrides,
  };
}

function relayInstance(flags = flagsOn()) {
  const stt = new RefractProSTT('refract_sk_paid', 'system', { appVersion: '2.7.0', platform: 'mac', flags });
  stt.installTarget(makeConfig());
  return stt;
}

test('installTarget builds a relay → alternate → railway chain; connectUrl starts at relay', () => {
  const stt = relayInstance();
  assert.deepEqual(stt.target.chain, [RELAY_URL, ALT_URL, RAILWAY_URL]);
  assert.equal(stt.connectUrl(), RELAY_URL);
  stt.removeAllListeners();
});

test('maybeAdvanceTarget advances only after 2 same-relay failures', () => {
  const stt = relayInstance();
  // 1st failure em relay → stays em relay (tentar novamente budget = 2)
  stt.maybeAdvanceTarget(RELAY_URL, 1006);
  assert.equal(stt.connectUrl(), RELAY_URL, 'first failure keeps the relay (same-url retry)');
  // 2nd failure → advance to alternate
  stt.maybeAdvanceTarget(RELAY_URL, 1006);
  assert.equal(stt.connectUrl(), ALT_URL, 'second relay failure advances to alternate');
  stt.removeAllListeners();
});

test('ladder walks relay → alternate → railway and then sticks on railway', () => {
  const stt = relayInstance();
  // Relay ×2
  stt.maybeAdvanceTarget(RELAY_URL, 1006);
  stt.maybeAdvanceTarget(RELAY_URL, 1006);
  assert.equal(stt.connectUrl(), ALT_URL);
  // Alternate ×2
  stt.maybeAdvanceTarget(ALT_URL, 1006);
  stt.maybeAdvanceTarget(ALT_URL, 1006);
  assert.equal(stt.connectUrl(), RAILWAY_URL);
  assert.equal(stt.target.onRailway, true, 'reaching railway sets the terminal flag');
  // Mais failures em railway precisa Não advance (não flap-back; em lugar nenhum to go)
  stt.maybeAdvanceTarget(RAILWAY_URL, 1006);
  stt.maybeAdvanceTarget(RAILWAY_URL, 1006);
  assert.equal(stt.connectUrl(), RAILWAY_URL, 'railway is the terminal rung — no further advance');
  stt.removeAllListeners();
});

test('maybeAdvanceTarget ignores a stale close for a non-head url', () => {
  const stt = relayInstance();
  // We são dialing RELAY (index 0). A fechar arriving para o alternate url é
  // stale (e.g. a previously-closed socket) and precisa não advance.
  stt.maybeAdvanceTarget(ALT_URL, 1006);
  stt.maybeAdvanceTarget(ALT_URL, 1006);
  assert.equal(stt.connectUrl(), RELAY_URL, 'stale close for a non-head url must not advance the ladder');
  stt.removeAllListeners();
});

test('forceAdvanceTarget (token-fatal on relay) advances immediately, skipping the ×2 budget', () => {
  const stt = relayInstance();
  stt.forceAdvanceTarget(RELAY_URL, 'token_fatal');
  assert.equal(stt.connectUrl(), ALT_URL, 'token-fatal on a relay must advance on the FIRST failure, not after 2');
  // And it precisa Não ter killed o ssessão
  // (isActive é apenas define por stainicia we nunca started, então apenas assert não crash + advance.)
  stt.removeAllListeners();
});

test('token-fatal advance does not run when already on railway (lets normal fatal apply)', () => {
  const stt = relayInstance();
  // Walk to railway fprimeiro
  stt.maybeAdvanceTarget(RELAY_URL, 1006); stt.maybeAdvanceTarget(RELAY_URL, 1006);
  stt.maybeAdvanceTarget(ALT_URL, 1006);   stt.maybeAdvanceTarget(ALT_URL, 1006);
  assert.equal(stt.connectUrl(), RAILWAY_URL);
  // A forceAdvance em railway é a no-op (railway uses legacy auth; invalid_key_format lá é genuinely fatal).
  stt.forceAdvanceTarget(RAILWAY_URL, 'token_fatal');
  assert.equal(stt.connectUrl(), RAILWAY_URL);
  stt.removeAllListeners();
});

test('sttRailwayFallbackEnabled=false strips the railway url from the chain', () => {
  const stt = relayInstance(flagsOn({ isRailwayFallbackEnabled: () => false }));
  assert.deepEqual(stt.target.chain, [RELAY_URL, ALT_URL], 'railway must be absent when the fallback flag is off');
  stt.removeAllListeners();
});

// ── O flag-OFF unchanged-behavior proof ───────────────────────────────────

test('flag OFF: resolver never called, connect() dials BACKEND_URL, legacy frame', async () => {
  let resolverCalls = 0;
  const stt = new RefractProSTT('refract_sk_paid', 'system', {
    appVersion: '2.7.0',
    platform: 'mac',
    flags: flagsOn({ isRelayEnabled: () => false }),  // master Fora
    resolveSession: async () => { resolverCalls++; return null; },
  });

  // Stub o socket-open pcaminho substituir connect()'s WS construction por spying em
  // o url that coconectar iria dial. We capture it por overriding connectUrl
  // observation — call o real maybeResolveRelayTarget() (o gate) directly.
  const startedResolve = stt.maybeResolveRelayTarget();
  assert.equal(startedResolve, false, 'flag OFF → maybeResolveRelayTarget returns false synchronously (no async resolve)');
  assert.equal(resolverCalls, 0, 'BUG: resolver must NEVER be called when the flag is off');
  assert.equal(stt.target, null, 'flag OFF → no relay target installed');
  assert.equal(stt.connectUrl(), 'wss://api.refract.software/v1/transcribe', 'flag OFF → connect() dials the hardcoded BACKEND_URL');

  // And o auth frame precisa ser o legacy shape para that url.
  const frame = stt.buildAuthFrame(stt.connectUrl());
  assert.equal(frame.key, 'refract_sk_paid');
  assert.equal(frame.session_token, undefined);
  stt.removeAllListeners();
});

test('flag ON with no cache: maybeResolveRelayTarget starts an async resolve (returns true)', async () => {
  let resolverCalls = 0;
  const stt = new RefractProSTT('refract_sk_paid', 'system', {
    appVersion: '2.7.0',
    platform: 'mac',
    flags: flagsOn(),
    resolveSession: async () => { resolverCalls++; return makeConfig(); },
  });
  // Make coconectar a no-op então o resolver continuation doesn't tentar a real socket.
  stt.connect = function () { /* no-op para o re-entry */ };
  stt.isActive = true;
  const started = stt.maybeResolveRelayTarget();
  assert.equal(started, true, 'flag ON + no cache → starts an async resolve and blocks this connect');
  // Let o microtask/finally rexecuta
  await new Promise(r => setTimeout(r, 10));
  assert.equal(resolverCalls, 1, 'resolver called exactly once');
  assert.ok(stt.target, 'a target should be installed after resolution');
  assert.equal(stt.connectUrl(), RELAY_URL, 'resolved target dials the relay url first');
  stt.removeAllListeners();
});
