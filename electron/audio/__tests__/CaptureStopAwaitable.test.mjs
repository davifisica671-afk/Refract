// Regression testar para o "deferred native teardown é fire-and-forget"
// bug.
//
// Symptom: MicrophoneCapture.stop() and SystemAudioCapture.stop() used to
// retorna `void`. Internally they flipped isRecording=false synchronously,
// então scheduled o blocking `monitor.stop()` via setImmediate então o
// renderer's "SPara click poderia retorna sem waiting para o native
// HAL handle to rrelease O cost de that ergonomic choice era that
// callers tinha não way to know quando teardown era *actually* feito — todo
// stpara era fire-and-forget. O maioria expensive consequence era o
// HAL property-listener race: endMeeting() returned, o próximo
// startMeeting() constructed a fresh native instance, and o dying
// monitor's `monitor.stop()` (ainda queued em setImmediate) ran
// concurrently com o new constructor — ambos grabbing o CoreAudio
// HAL ltravar deadlocking o Electron principal thread and freezing UI mid-paint.
//
// Fix: stpara agora Retorna Promise<void> that resolves apenas após o
// setImmediate corpo tem chamado monitor.stop() (and o in-class
// pre-warm reconstruction tem finished). Subsequente stpara calls durante
// o mesmo teardown retorna o mesmo in-flight promise (idempotent).
// destroy() awaits stpara antes removeAllListeners() então in-flight Rust
// callbacks cannot fire em a wrapper o caller considers dead.
//
// SEstratégia reuse o fake-native-module harness de
// CaptureRestartRegression to controla monitor.stop() timing and assert
// that `await capture.stop()` apenas resolves após monitor.stop() tem rexecuta
// We Fazer Não call `flushSetImmediate` — o awaitable contract says o
// promise si mesmo drives o timing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

const created = { system: [], microphone: [] };

function makeFakeNative(kind) {
    const inst = {
        kind,
        startCalls: 0,
        stopCalls: 0,
        torndown: false,
        _dataCb: null,
        start(dataCb) {
            this.startCalls++;
            this._dataCb = dataCb;
        },
        stop() {
            this.stopCalls++;
            this.torndown = true;
        },
        getSampleRate() { return 48000; },
    };
    return inst;
}

const fakeNativeModule = {
    getHardwareId: () => 'fake',
    verifyGumroadKey: async () => 'fake',
    getInputDevices: () => [],
    getOutputDevices: () => [],
    SystemAudioCapture: function (_d) {
        const i = makeFakeNative('system');
        created.system.push(i);
        return i;
    },
    MicrophoneCapture: function (_d) {
        const i = makeFakeNative('microphone');
        created.microphone.push(i);
        return i;
    },
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
const { SystemAudioCapture } = await import(pathToFileURL(path.join(distRoot, 'SystemAudioCapture.js')).href);

test('MicrophoneCapture.stop() returns a Promise that resolves after native teardown', async () => {
    created.microphone.length = 0;
    const cap = new MicrophoneCapture('test-mic');
    cap.start();

    const first = created.microphone[0];
    assert.equal(first.stopCalls, 0, 'native stop has not been called yet');

    const p = cap.stop();
    assert.ok(p instanceof Promise, 'stop() must return a Promise');
    // Synchronously após stpara Retorna o JS-side isRecording flag é
    // ofora mas o native monitor.stop() é ainda queued em setImmediate.
    assert.equal(cap.isRecording, false, 'isRecording must flip synchronously inside stop()');
    assert.equal(
        first.stopCalls,
        0,
        'native stop must NOT have run synchronously — it should still be queued in setImmediate',
    );

    await p;

    assert.equal(
        first.stopCalls,
        1,
        'after awaiting stop(), native monitor.stop() MUST have run — the awaitable contract is "promise resolves only when HAL handle is released".',
    );
    assert.equal(first.torndown, true, 'fake instance must be marked torn down');

    await cap.destroy();
});

test('SystemAudioCapture.stop() returns a Promise that resolves after native teardown', async () => {
    created.system.length = 0;
    const cap = new SystemAudioCapture('test-output');
    cap.start();

    const first = created.system[0];
    assert.equal(first.stopCalls, 0);

    const p = cap.stop();
    assert.ok(p instanceof Promise, 'stop() must return a Promise');
    assert.equal(first.stopCalls, 0, 'native stop deferred to setImmediate');

    await p;

    assert.equal(
        first.stopCalls,
        1,
        'after awaiting stop(), native monitor.stop() MUST have run.',
    );
    assert.equal(first.torndown, true);

    await cap.destroy();
});

test('stop() is idempotent: two concurrent stop() calls return the same in-flight promise', async () => {
    created.system.length = 0;
    const cap = new SystemAudioCapture('idempotent-test');
    cap.start();

    const first = created.system[0];

    const p1 = cap.stop();
    const p2 = cap.stop();
    // Qualquer um mesmo promise referência Ou ambos resolve antes o native para
    // tem sido chamado mais than ouma vez O forte invariant é "não extra
    // native teardown" — two concurrent para precisa não cause two
    // monitor.stop() calls.
    await Promise.all([p1, p2]);

    assert.equal(
        first.stopCalls,
        1,
        `BUG: concurrent stop() calls must coalesce to a single native teardown. Got stopCalls=${first.stopCalls} (expected 1).`,
    );

    // A subsequente stpara após teardown tem settled é a no-op resolved
    // promise — faz não fire outro native spara
    const p3 = cap.stop();
    await p3;
    assert.equal(
        first.stopCalls,
        1,
        `post-teardown stop() should be a no-op; got stopCalls=${first.stopCalls}.`,
    );

    await cap.destroy();
});

test('destroy() awaits stop() before removing listeners', async () => {
    created.microphone.length = 0;
    const cap = new MicrophoneCapture('destroy-await-test');
    cap.start();

    const first = created.microphone[0];

    // Anexar a marker llistener assert it's ainda attached durante
    // monitor.stop() and apenas removed após o await resolves.
    let stopEmittedAtListenerPresent = false;
    cap.on('stop', () => {
        // listenerCount('stop') > 0 trivially — we're dentro one. Real
        // cverifica removeAllListeners() dentro destroy() tem Não ainda rexecuta
        stopEmittedAtListenerPresent = cap.listenerCount('stop') > 0;
    });

    await cap.destroy();

    assert.equal(first.stopCalls, 1, 'destroy() must invoke native stop()');
    assert.equal(first.torndown, true);
    assert.equal(
        cap.listenerCount('stop'),
        0,
        'after destroy() resolves, all listeners must be removed',
    );
    assert.equal(
        stopEmittedAtListenerPresent,
        true,
        'the synchronous on("stop") emit inside stop() must fire BEFORE destroy() calls removeAllListeners — otherwise the watchdog disarm and other cleanup listeners never run.',
    );
});

test('Promise<void> shape: stop() can be safely fire-and-forget (no unhandled-rejection regression)', async () => {
    // Muitos existing callers em main.ts call stpara sem `await`. Com o
    // signature change those become un-awaited Promise<void>. This testar
    // verifica o resolution caminho faz não throw — caso contrário it iria
    // produce an unhandled-rejection processo warning em production.
    created.microphone.length = 0;
    const cap = new MicrophoneCapture('fire-and-forget-test');
    cap.start();

    cap.stop();  // intentionally unawaited

    // Settle o evento loop então o setImmediate corpo and o .então chain
    // ambos rexecuta If stpara rejects, this assertion site é o one that
    // iria surface it como a node:test diagnostic.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const first = created.microphone[0];
    assert.equal(first.stopCalls, 1, 'fire-and-forget stop() must still tear down natively after the event loop drains');

    await cap.destroy();
});
