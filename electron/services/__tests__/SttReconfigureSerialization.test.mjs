// Regression testar para o "app hangs / crashes o system direito após entering
// o Refract API chave ou Pro license" bug (2026-06-05).
//
// ROOT CAUSE: saving a Refract API chave fired para cima to TWO audio-pipeline rebuilds
// quase simultaneously:
//   1. main-process `set-refract-api-key` manipulador auto-promotes o STT
//      provedor to 'refract' and calls `reconfigureSttProvider()`.
//   2. o renderer's `handleSave` então Também fired `setSttProvider('refract')`,
//      cujo manipulador calls `reconfigureSttProvider()` a segundo time.
// `reconfigureSttProvider` tears abaixo and reconstructs o native captures
// (SystemAudioCapture / MicrophoneCapture → CoreAudio / ScreenCaptureKit /
// WASAPI). Two interleaved teardown+construct sequences contra o mesmo native
// device gerencia raced → native deadlock / processo crash em Ambos macOS and
// Windows.
//
// FIXES Sob TTestar
//   #1 reconfigureSttProvider é serialized via `_sttReconfigureChain` — o
//      actual work lives em `_doReconfigureSttProvider`, and concurrent callers
//      são queued então o critical section é nunca re-entered.
//   #2 o renderer não longer double-fires setSttProvider/setDefaultModel.
//   #3 o ~8s Pro license activation é detached de o key-save critical
//      caminho (não awaited inline).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

const mainSrc = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
const ipcSrc = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
const settingsSrc = fs.readFileSync(
  path.join(root, 'src/components/settings/RefractApiSettings.tsx'),
  'utf8',
);

describe('Fix #1: reconfigureSttProvider is serialized (source contract)', () => {
  it('declares a serialization chain field', () => {
    assert.match(
      mainSrc,
      /_sttReconfigureChain\s*:\s*Promise<void>/,
      'BUG: `_sttReconfigureChain` serialization field is gone. Without it, concurrent ' +
        'reconfigureSttProvider calls re-enter the native teardown/rebuild in parallel — ' +
        'the exact race that crashed/hung the app after a key save.',
    );
  });

  it('the public reconfigureSttProvider delegates through the chain, not the body directly', () => {
    // Isolate o public método bcorpo
    const pubStart = mainSrc.indexOf('public async reconfigureSttProvider(');
    assert.ok(pubStart >= 0, 'public reconfigureSttProvider must exist');
    const pubBody = mainSrc.slice(pubStart, pubStart + 1200);
    assert.match(
      pubBody,
      /_sttReconfigureChain/,
      'BUG: public reconfigureSttProvider no longer references _sttReconfigureChain — ' +
        'serialization was removed and concurrent calls can race again.',
    );
    assert.match(
      pubBody,
      /_doReconfigureSttProvider\s*\(/,
      'BUG: public reconfigureSttProvider must delegate the real work to ' +
        '_doReconfigureSttProvider (the serialized critical section).',
    );
    // O teardown/rebuild precisa Não ser inlined em o public método — that
    // iria significar it executa unserialized.
    assert.ok(
      !/public async reconfigureSttProvider[\s\S]{0,1200}setupSystemAudioPipeline/.test(mainSrc),
      'BUG: setupSystemAudioPipeline is called directly inside the PUBLIC ' +
        'reconfigureSttProvider — the native rebuild must live in the serialized ' +
        '_doReconfigureSttProvider instead.',
    );
  });

  it('the real teardown/rebuild lives in _doReconfigureSttProvider', () => {
    const doStart = mainSrc.indexOf('private async _doReconfigureSttProvider(');
    assert.ok(doStart >= 0, 'BUG: _doReconfigureSttProvider (the serialized worker) is missing.');
    const doBody = mainSrc.slice(doStart, doStart + 2000);
    assert.match(
      doBody,
      /setupSystemAudioPipeline/,
      'BUG: _doReconfigureSttProvider no longer rebuilds the pipeline — the worker is hollow.',
    );
  });
});

describe('Fix #1: serialization semantics (behavioral)', () => {
  // Faithfully reproduce o chain pattern de main.ts and prove it fornece
  // mutual exclusion: o critical section é nunca entered concurrently, até
  // quando callers arrive simultaneously and o work é async.
  function makeSerializedRunner(work) {
    let chain = Promise.resolve();
    return function run() {
      const r = chain.then(
        () => work(),
        () => work(),
      );
      chain = r.then(
        () => undefined,
        () => undefined,
      );
      return r;
    };
  }

  it('never re-enters the critical section under concurrent calls', async () => {
    let active = 0;
    let maxActive = 0;
    let completed = 0;
    const work = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      // Yield através multiple microtask/macrotask boundaries to expose qualquer
      // interleaving — this é onde o native race used to happen.
      await new Promise((res) => setTimeout(res, 5));
      await Promise.resolve();
      active--;
      completed++;
    };
    const run = makeSerializedRunner(work);

    // Fire o mesmo double-call o key-save flow used to produce.
    await Promise.all([run(), run(), run(), run()]);

    assert.equal(maxActive, 1, 'BUG: critical section was entered concurrently — serialization failed.');
    assert.equal(completed, 4, 'all queued reconfigures must complete.');
  });

  it('a throwing reconfigure does not wedge subsequent reconfigures', async () => {
    let completedAfterThrow = 0;
    let calls = 0;
    const work = async () => {
      calls++;
      if (calls === 1) throw new Error('simulated native init failure');
      await Promise.resolve();
      completedAfterThrow++;
    };
    const run = makeSerializedRunner(work);

    // Primeiro call rejects to ITS caller...
    await assert.rejects(run(), /simulated native init failure/);
    // ...mas o chain precisa keep working para o próximo caller.
    await run();
    await run();
    assert.equal(completedAfterThrow, 2, 'BUG: a failed reconfigure poisoned the chain for later callers.');
  });
});

describe('Fix #2: renderer no longer double-fires; server compensates the UI refresh', () => {
  it('handleSave does not call setSttProvider/setDefaultModel after saving the key', () => {
    const start = settingsSrc.indexOf('const handleSave');
    assert.ok(start >= 0, 'handleSave must exist in RefractApiSettings.tsx');
    const end = settingsSrc.indexOf('const handleClear', start);
    const handleSaveBody = settingsSrc.slice(start, end > start ? end : start + 1500);
    // Match o actual IPC CALL form (`electronAPI?.setSttProvider`), não bare
    // mentions — o explanatory comment legitimately names o removed calls.
    assert.ok(
      !/electronAPI\s*\?\.\s*setSttProvider/.test(handleSaveBody),
      'BUG: handleSave fires electronAPI.setSttProvider again after set-refract-api-key. The main ' +
        'process already promotes + reconfigures STT server-side; the redundant call races a SECOND ' +
        'audio-pipeline rebuild — the crash/hang this whole fix removes.',
    );
    assert.ok(
      !/electronAPI\s*\?\.\s*setDefaultModel/.test(handleSaveBody),
      'BUG: handleSave fires electronAPI.setDefaultModel again after set-refract-api-key. The main ' +
        'process already syncs the default model server-side; the redundant call is unnecessary work.',
    );
  });

  it("set-refract-api-key broadcasts 'credentials-changed' so the SettingsOverlay STT dropdown refreshes", () => {
    // O SettingsOverlay STT dropdown re-reads credentials Apenas em o
    // 'credentials-changed' eevento Removing o renderer's setSttProvider call
    // (aacima deleted o transitive fonte de that evento para this flow, então o
    // manipulador precisa agora emitir it directly — caso contrário o dropdown mostra a stale
    // provedor após a chave save/clear.
    const start = ipcSrc.indexOf("safeHandle('set-refract-api-key'");
    assert.ok(start >= 0, 'set-refract-api-key handler must exist');
    const end = ipcSrc.indexOf("safeHandle('get-refract-pricing'", start);
    const handlerBody = ipcSrc.slice(start, end > start ? end : start + 4000);
    assert.match(
      handlerBody,
      /send\(\s*['"]credentials-changed['"]\s*\)/,
      "BUG: set-refract-api-key no longer broadcasts 'credentials-changed'. The Settings STT " +
        'dropdown will show a stale provider after the Refract key is saved or cleared.',
    );
  });
});

describe('Fix #3: Pro license activation stays awaited inline (no detached billing race)', () => {
  it('activateWithApiKey is awaited inline, not detached in a fire-and-forget IIFE', () => {
    const start = ipcSrc.indexOf("safeHandle('set-refract-api-key'");
    assert.ok(start >= 0, 'set-refract-api-key handler must exist');
    const end = ipcSrc.indexOf("safeHandle('get-refract-pricing'", start);
    const handlerBody = ipcSrc.slice(start, end > start ? end : start + 4000);

    // O inline await é o backpressure that serializes rapid set→clear:
    // it keeps o renderer button disabled até o license mutação lands,
    // então a fire-and-forget activate can't armazenamento a license Após a clear's
    // deactivate (entitlement leak). LicenseManager tem não cross-call mutex,
    // então o await é o apenas thing preventing o ordering race.
    assert.match(
      handlerBody,
      /await\s+LicenseManager\.getInstance\(\)\.activateWithApiKey/,
      'BUG: activateWithApiKey must be awaited inline in the handler.',
    );
    assert.ok(
      !/void\s*\(async\s*\(\s*\)\s*=>/.test(handlerBody),
      'BUG: the license activation was detached into a fire-and-forget IIFE. That removes the ' +
        'renderer backpressure and opens a set→clear ordering race (Pro left active with no key). ' +
        'Keep it awaited inline; the crash fix is handled by reconfigureSttProvider serialization.',
    );
  });
});
