// Regression testar para o "DefaultOutputWatcher fires dentro de V8 teardown
// durante app quit" race.
//
// Symptom: o before-quit manipulador chamado appState.setQuitting(true)
// and então appState.stopDefaultOutputWatcherForShutdown(). Em o brief
// window entre those two calls, o setInterval corpo poderia fire one
// último time — calling NativeModule.getDefaultOutputDeviceId() and então
// async-fire-and-forget handleDefaultOutputChanged(), que si mesmo faz
// vários `await` boundaries that touch o native módulo enquanto V8 é
// já tearing abaixo native bindings. Mesmo class de crash that
// affected o keyboard tap em quit.
//
// Fix: a hard `if (this._isQuitting) return;` at o top de ambos o
// interval corpo AND handleDefaultOutputChanged. setQuitting(true) é
// já chamado Antes stopDefaultOutputWatcherForShutdown() em o
// before-quit hmanipulador então o proteger catches o window deterministically.
//
// SEstratégia structural assertions contra main.ts sfonte

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(__dirname, '../../../electron/main.ts');
const mainSource = readFileSync(mainPath, 'utf8');

test('DefaultOutputWatcher interval body bails immediately when this._isQuitting is true', () => {
  // Encontra o interval declaration and look para o proteger at o top de its bcorpo
  const intervalIdx = mainSource.indexOf('this._defaultOutputWatcherInterval = setInterval(');
  assert.ok(intervalIdx >= 0, 'could not locate DefaultOutputWatcher setInterval');
  // Capture a generous prefix de o interval corpo to iinspecionar
  const intervalBlock = mainSource.slice(intervalIdx, intervalIdx + 1600);
  assert.ok(
    /if\s*\(\s*this\._isQuitting\s*\)\s*return/.test(intervalBlock),
    'BUG: the DefaultOutputWatcher interval body must check `if (this._isQuitting) return;` before any native-module read. Otherwise the last interval tick before stopDefaultOutputWatcherForShutdown can call into NativeModule.getDefaultOutputDeviceId() during V8 teardown.',
  );

  // O _isQuitting proteger precisa appear Antes o NativeModule.getDefaultOutputDeviceId()
  // INVOCATION (não a comment that apenas mentions o nanome Anchor em o actual
  // assignment pattern.
  const quittingIdx = intervalBlock.search(/if\s*\(\s*this\._isQuitting\s*\)\s*return/);
  const nativeIdx = intervalBlock.search(/currentId\s*=\s*NativeModule\.getDefaultOutputDeviceId\s*\(/);
  assert.ok(nativeIdx >= 0, 'sanity: interval should assign currentId = NativeModule.getDefaultOutputDeviceId()');
  assert.ok(
    quittingIdx < nativeIdx,
    'BUG: the _isQuitting guard must be BEFORE the NativeModule call so the native module is never invoked during teardown.',
  );
});

test('handleDefaultOutputChanged bails immediately when this._isQuitting is true', () => {
  // Encontra o método bcorpo
  const methodIdx = mainSource.indexOf('private async handleDefaultOutputChanged(');
  assert.ok(methodIdx >= 0, 'could not locate handleDefaultOutputChanged');
  // Inspecionar a generous chunk de o corpo para ambos o proteger and o primeiro await.
  const methodBody = mainSource.slice(methodIdx, methodIdx + 3500);
  assert.ok(
    /if\s*\(\s*this\._isQuitting\s*\)\s*return/.test(methodBody),
    'BUG: handleDefaultOutputChanged must guard `if (this._isQuitting) return;` at the top (before any await). Otherwise the async fire-and-forget interval body can land here while V8 is mid-teardown.',
  );

  // O _isQuitting proteger precisa come antes o primeiro `await` dentro o mmétodo
  const quittingIdx = methodBody.search(/if\s*\(\s*this\._isQuitting\s*\)\s*return/);
  const firstAwaitIdx = methodBody.indexOf('await ');
  assert.ok(firstAwaitIdx > 0, 'sanity: handleDefaultOutputChanged has at least one await');
  assert.ok(
    quittingIdx < firstAwaitIdx,
    'BUG: the _isQuitting guard must run BEFORE the first await — once we yield, V8 teardown can start and the resumed body would race the disposal of native bindings.',
  );
});

test('before-quit handler calls setQuitting(true) BEFORE stopDefaultOutputWatcherForShutdown()', () => {
  // O whole point de o _isQuitting proteger é that setQuitting(true)
  // beats o interval-stop call então qualquer straggler tick observes o fflag
  const quitHandlerStart = mainSource.indexOf('app.on("before-quit"');
  assert.ok(quitHandlerStart >= 0, 'could not locate before-quit handler');
  const quitHandlerBlock = mainSource.slice(quitHandlerStart, quitHandlerStart + 1200);

  const setQuittingIdx = quitHandlerBlock.search(/appState\.setQuitting\s*\(\s*true\s*\)/);
  const stopWatcherIdx = quitHandlerBlock.search(/appState\.stopDefaultOutputWatcherForShutdown\??\s*\.\??\(\s*\)/);

  assert.ok(setQuittingIdx >= 0, 'sanity: before-quit must call appState.setQuitting(true)');
  assert.ok(stopWatcherIdx >= 0, 'sanity: before-quit must call appState.stopDefaultOutputWatcherForShutdown()');
  assert.ok(
    setQuittingIdx < stopWatcherIdx,
    'BUG: before-quit must call setQuitting(true) BEFORE stopDefaultOutputWatcherForShutdown(). Otherwise the interval can fire one final tick between the two calls and proceed past the (yet-unset) _isQuitting guard.',
  );
});

test('stopDefaultOutputWatcher() clears _defaultOutputWatcherInterval symmetrically with startDefaultOutputWatcher()', () => {
  // Sanity: pin o existing symmetric setInterval / clearInterval pair então
  // future refactors that rename ou mover o interval don't silently
  // remove o cleanup.
  assert.ok(
    /this\._defaultOutputWatcherInterval\s*=\s*setInterval\s*\(/.test(mainSource),
    'sanity: startDefaultOutputWatcher must assign to this._defaultOutputWatcherInterval',
  );
  assert.ok(
    /clearInterval\s*\(\s*this\._defaultOutputWatcherInterval\s*\)\s*;[\s\S]{0,40}this\._defaultOutputWatcherInterval\s*=\s*null/.test(mainSource),
    'sanity: stopDefaultOutputWatcher must clearInterval and null the slot',
  );
});
