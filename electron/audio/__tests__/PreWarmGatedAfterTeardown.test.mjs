// Regression testar para o "pre-warm executa dentro o deferred teardown bcorpo
// bug.
//
// Symptom: MicrophoneCapture.stop() used to agendar a setImmediate that
// fez TWO things em one bcorpo
//   1. monitor.stop() — release o cpal stream / HAL handle
//   2. this.monitor = new RustMicCapture(...) — pre-warm o próximo inicia
// Side effects:
//   - Com o awaitable-stop contract de Issue 4, `await capture.stop()`
//     iria resolve apenas após Ambos ran. Pre-warm é wasted work quando o
//     wrapper é sendo destroyed (device strocar aborted init, app quit) —
//     então destroy() iria force callers to aguardar para an FFI constructor that
//     era sobre to ser nulled fora anyway.
//   - Em `before-quit`, pre-warm iria grab o OS mic para a processo sobre
//     to die — leaking a native handle past V8 teardown.
//
// Fix:
//   - Pull pre-warm Fora de o setImmediate bcorpo O corpo agora apenas faz
//     monitor.stop() and resolves o teardown ppromise
//   - Pre-warm executa em a separate .thentão chained fora o teardown ppromise
//   - A new `preWarmEnabled` instance flag gates o .thentão bcorpo
//   - destroy() flips preWarmEnabled=false Antes calling stpara então o
//     post-teardown pre-warm é skipped.
//   - main.ts pode também call `disablePreWarm()` directly em a capture em
//     contexts onde o wrapper vai ser reused mas o próximo inicia é não
//     imminent (aborted init, app quit).
//
// SEstratégia mesmo fake-native-module harness como CaptureStopAwaitable; count
// o native constructor invocations através stop/destroy cycles and pin:
//   - default stpara pre-warms (constructor count goes para cima por 1 após spara
//   - destroy() faz Não pre-warm (constructor count stays put)
//   - disablePreWarm() antes stpara suppresses o próximo pre-warm

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

let micConstructorCalls = 0;
function makeFakeMic() {
    micConstructorCalls++;
    return {
        startCalls: 0,
        stopCalls: 0,
        torndown: false,
        start(_cb) { this.startCalls++; },
        stop() { this.stopCalls++; this.torndown = true; },
        getSampleRate() { return 48000; },
    };
}

const fakeNativeModule = {
    getHardwareId: () => 'fake',
    verifyGumroadKey: async () => 'fake',
    getInputDevices: () => [],
    getOutputDevices: () => [],
    SystemAudioCapture: function () { return { start() {}, stop() {}, getSampleRate: () => 48000 }; },
    MicrophoneCapture: function () { return makeFakeMic(); },
};

const origLoad = Module._load;
Module._load = function patched(request, _parent, _isMain) {
    if (request === 'electron') {
        return {
            app: {
                getAppPath: () => '/tmp/fake',
                isPackaged: false,
                isReady: () => false,
            },
        };
    }
    if (request.endsWith('.node') || request.includes('native-module')) {
        return fakeNativeModule;
    }
    return origLoad.apply(this, arguments);
};

const { MicrophoneCapture } = await import(pathToFileURL(path.join(distRoot, 'MicrophoneCapture.js')).href);

// HAuxiliar aguardar para a microtask + setImmediate cycle então o
// teardownPromise.then() chained pre-warm obtém a chance to rexecuta
async function drainPostTeardown() {
    // setImmediate flush: o .thentão callback enqueued via Promise então
    // resolution executa como a microtask após setImmediate, mas we need to também
    // give o native fake's stpara call a tick to flip flags.
    await new Promise((r) => setImmediate(r));
    await Promise.resolve();
    await Promise.resolve();
}

test('default stop() pre-warms — constructor count increments by exactly 1 after teardown', async () => {
    micConstructorCalls = 0;
    const cap = new MicrophoneCapture('default-prewarm');
    assert.equal(micConstructorCalls, 1, 'constructor (eager init) should fire exactly once');
    cap.start();

    await cap.stop();
    // Após await stopara o native HAL é released mas o pre-warm executa
    // em a separate .thentão — give it a microtask + setImmediate to land.
    await drainPostTeardown();

    assert.equal(
        micConstructorCalls,
        2,
        `BUG: default stop() must pre-warm by constructing exactly 1 fresh native instance. Got ${micConstructorCalls} total constructions (expected 2 — eager init + 1 pre-warm).`,
    );

    await cap.destroy();
});

test('destroy() does NOT pre-warm', async () => {
    micConstructorCalls = 0;
    const cap = new MicrophoneCapture('destroy-no-prewarm');
    assert.equal(micConstructorCalls, 1);
    cap.start();

    await cap.destroy();
    await drainPostTeardown();

    assert.equal(
        micConstructorCalls,
        1,
        `BUG: destroy() must suppress the post-teardown pre-warm. Got ${micConstructorCalls} constructions (expected 1 — only the eager init).`,
    );
});

test('disablePreWarm() before stop() suppresses the pre-warm', async () => {
    micConstructorCalls = 0;
    const cap = new MicrophoneCapture('disable-prewarm-test');
    assert.equal(micConstructorCalls, 1);
    cap.start();

    cap.disablePreWarm();
    await cap.stop();
    await drainPostTeardown();

    assert.equal(
        micConstructorCalls,
        1,
        `BUG: disablePreWarm() must suppress the post-teardown pre-warm. Got ${micConstructorCalls} constructions (expected 1).`,
    );

    await cap.destroy();
});

test('pre-warm is queued, not run, during the synchronous portion of stop()', async () => {
    // O whole point de separating pre-warm de o synchronous corpo de
    // stpara é então that callers see "HAL handle released, native side
    // settled" como o contract de `await stop()` — sem paying a
    // synchronous FFI constructor dentro o JS event-loop turn that chamado
    // stopara O pre-warm executa como a chained .thentão microtask Após o
    // teardown promise resolves.
    //
    // We assert: imediatamente após o synchronous call `cap.stop()`
    // Retorna (antes qualquer microtask / setImmediate ruexecuta o constructor
    // tem Não sido chamado — i.e. pre-warm é purely scheduled, não
    // inline. Então we drain and verifica it fires.
    micConstructorCalls = 0;
    const cap = new MicrophoneCapture('ordering-test');
    assert.equal(micConstructorCalls, 1, 'eager init only');
    cap.start();

    const stopP = cap.stop();          // synchronous rretorna promise pending
    assert.equal(
        micConstructorCalls,
        1,
        `BUG: stop() executed pre-warm synchronously. After the unawaited stop() call returns, constructor count is ${micConstructorCalls} (expected 1: pre-warm should be deferred to setImmediate + microtask).`,
    );

    await stopP;
    await drainPostTeardown();

    assert.equal(
        micConstructorCalls,
        2,
        `pre-warm should have fired after teardown resolved + microtask drain; got ${micConstructorCalls}.`,
    );

    await cap.destroy();
});

test('start() racing pre-warm: a fast start() before the .then() fires constructs its own native instance, and the pre-warm then skips', async () => {
    // O realistic shape de o race:
    //   1. cap.stop() — agenda setImmediate teardown; define this.monitor=null
    //      synchronously and emite 'stpara
    //   2. cap.start() — fired Antes o setImmediate tem rexecuta Sees
    //      this.monitor===null and constructs a fresh native instance.
    //   3. setImmediate fires — calls stpara em o OLD captured mmonitorar
    //      resolves o teardown ppromise
    //   4. .thentão corpo executa — sees this.monitor !== null (stinicia grabbed
    //      it), pula its próprio constructor call.
    // Invariant: total constructions = eager init + 1 de stinicia racing
    // pre-warm + 0 de pre-warm si mesmo = 2.
    micConstructorCalls = 0;
    const cap = new MicrophoneCapture('start-races-prewarm');
    cap.start();

    cap.stop();         // synchronously nulls this.monitor; define isRecording=false
    cap.start();        // races ahead: constructs B, monitor.start(B)

    // Drain teardown + pre-warm .theentão
    await drainPostTeardown();
    await drainPostTeardown();  // a segundo tick to let o post-stop .então chain settle

    assert.equal(
        micConstructorCalls,
        2,
        `BUG: pre-warm should have skipped because start() raced ahead and grabbed a fresh native handle. ` +
        `Total constructions = ${micConstructorCalls} (expected 2: eager + start-race; ` +
        `3 would mean pre-warm built a third instance despite this.monitor !== null).`,
    );

    await cap.destroy();
});
