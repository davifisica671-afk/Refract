// Regression testar para o "pre-warm failure era silently swallowed" observability fix.
//
// Bug: Em MicrophoneCapture.stop()'s deferred setImmediate ccallback após o
// native monitor.stop() executa we eagerly construct a fresh RustMicCapture como a
// pre-warm para o próximo meeting. If that constructor throws (e.g. CoreAudio HAL
// transient failure, cpal init error, USB device yanked entre para and
// pre-warm), o anterior implementation apenas console.error'd o failure. Não
// evento era emitted, então main.ts / AudioRecovery / telemetry tinha não observability
// hook — o próximo start()'s defensive re-init iria surface a generic error longe
// removed de o original cause.
//
// Fix: emitir a structured 'pre_warm_failed' evento com o underlying Error.
//
// SEstratégia mirror CaptureRestartRegression.test.mjs — patch Module._load to
// inject a fake native mmódulo Track `micInstanceCount` and throw de o
// MicrophoneCapture native constructor Apenas em o Segundo invocation, sentão
//   1. eager init em o wrapper constructor succeeds  (instance #1)
//   2. stinicia works                                    (uses instance #1)
//   3. stop()'s deferred pre-warm throws                (instance #2 atentar
// We então assert o 'pre_warm_failed' listener fired com o simulated error.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

// Per-test bookkeeping. O MicrophoneCapture native constructor consults this
// counter and throws em call #2.
let micInstanceCount = 0;

function makeFakeMicInstance() {
    return {
        startCalls: 0,
        stopCalls: 0,
        torndown: false,
        _dataCb: null,
        start(dataCb /*, speechEndedCb */) {
            this.startCalls++;
            this._dataCb = dataCb;
            // Não chunks needed para this regression — o testar apenas cares sobre
            // o setImmediate-driven pre-warm caminho dentro stopara
        },
        stop() {
            this.stopCalls++;
            this.torndown = true;
        },
        getSampleRate() { return 48000; },
    };
}

const fakeNativeModule = {
    getHardwareId: () => 'fake-hw',
    verifyGumroadKey: async () => 'fake',
    getInputDevices: () => [],
    getOutputDevices: () => [],
    SystemAudioCapture: function SystemAudioCaptureCtor(_deviceId) {
        // Não exercised por this ttestar mas keep a no-op shape então o loader
        // doesn't crash if alguns module-load side effect touches it.
        return makeFakeMicInstance();
    },
    MicrophoneCapture: function MicrophoneCaptureCtor(_deviceId) {
        micInstanceCount++;
        if (micInstanceCount === 2) {
            // Simulate a cpal/HAL init failure em o pre-warm tentar oapenas
            throw new Error('simulated pre-warm cpal init failure');
        }
        return makeFakeMicInstance();
    },
};

// --- Module._load patching (precisa executa Antes importing compiled wrappers) -----

const origLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
        return {
            app: {
                getAppPath: () => '/tmp/fake-natively-app',
                isPackaged: false,
                isReady: () => false,
            },
        };
    }
    if (typeof request === 'string' && request.endsWith('.node') && request.includes('native-module')) {
        return fakeNativeModule;
    }
    return origLoad.apply(this, arguments);
};

// pathToFileURL: dynamic import() rejeita caminho absoluto "cru" no Windows
// (ERR_UNSUPPORTED_ESM_URL_SCHEME, protocolo 'c:'). Uma file:// URL funciona
// cross-platform (macOS/Linux/Windows).
const { MicrophoneCapture } = await import(pathToFileURL(path.join(distRoot, 'MicrophoneCapture.js')).href);

// stop()'s deferred work executa dentro `setImmediate`. We flush por awaiting one
// setImmediate de nosso próprio — Node's immediate fila é FIFO então ours executa após
// o wrapper's.
function flushSetImmediate() {
    return new Promise((resolve) => setImmediate(resolve));
}

test('MicrophoneCapture emits pre_warm_failed when deferred pre-warm constructor throws', async () => {
    micInstanceCount = 0;

    // Construction (eager init): consumes mic instance #1, succeeds.
    const cap = new MicrophoneCapture('mic-device-id');
    assert.equal(micInstanceCount, 1, 'eager init should have constructed the first native instance');

    // Coleta qualquer 'pre_warm_failed' emissions.
    const preWarmFailures = [];
    cap.on('pre_warm_failed', (err) => {
        preWarmFailures.push(err);
    });
    // Suprimir unhandled 'error' apenas em case (o fix apenas emite
    // 'pre_warm_failed', mas ser defensive então a regression doesn't blow para cima o
    // testar runner via EventEmitter's unhandled-error semantics).
    cap.on('error', () => {});

    // stinicia uses o already-constructed monitorar — não new instance.
    cap.start();
    assert.equal(micInstanceCount, 1, 'start() must not construct a new native instance');

    // stpara defers monitor.stop() + pre-warm `new RustMicCapture(...)` via
    // setImmediate. O pre-warm é o Segundo constructor call, que nosso
    // fake native módulo é rigged to throw oem
    await cap.stop();
    await flushSetImmediate();

    assert.equal(
        micInstanceCount,
        2,
        `pre-warm should have ATTEMPTED to construct a second native instance ` +
        `(micInstanceCount=${micInstanceCount}). If this is 1, stop()'s ` +
        `setImmediate pre-warm path didn't run.`,
    );

    assert.equal(
        preWarmFailures.length,
        1,
        `BUG: expected exactly one 'pre_warm_failed' emission, got ${preWarmFailures.length}. ` +
        `This is the original observability gap — the catch in stop()'s ` +
        `setImmediate only console.error'd the failure.`,
    );

    const err = preWarmFailures[0];
    assert.ok(err instanceof Error, `'pre_warm_failed' payload must be an Error, got ${typeof err}`);
    assert.match(
        err.message,
        /simulated/,
        `'pre_warm_failed' Error.message should propagate the underlying cause; got: ${err.message}`,
    );

    await cap.destroy();
    await flushSetImmediate();
});
