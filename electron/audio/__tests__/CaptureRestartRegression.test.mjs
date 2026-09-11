// Regression testar para o "segundo meeting silent capture / STT handshake timeout"
// bug.
//
// Symptom: starting a segundo meeting após ending o primeiro (com o mesmo
// audio devices) produces ~8 seconds de silence and an STT WebSocket handshake
// timeout, perceived por o user como a "hang".
//
// Root cause:
//   - `electron/main.ts` `reconfigureAudio()` short-circuits quando device IDs
//     são unchanged, então o anterior meeting's `SystemAudioCapture` /
//     `MicrophoneCapture` wrapper é reused.
//   - Their `stop()` defers `monitor.stop()` via `setImmediate` mas faz Não
//     null `this.monitor`.
//   - O próximo `start()` sees `this.monitor != null`, pula o
//     `new RustAudioCapture()` branch, and calls `monitor.start()` em o
//     already-torn-down native instance, que silently drops chunks.
//
// SEstratégia carrega o COMPILED capture modules com `Module._load` patched então
//   - `require('electron')` Retorna a stub `app`,
//   - `require('<binary>.node')` Retorna a fake native módulo cujo
//     `SystemAudioCapture`/`MicrophoneCapture` constructors registro per-instance
//     start/stop calls and mark themselves "torn dabaixo após spara
//
// We então executa o start→stop→start sequence em o wrapper and assert o
// próximo inicia fez Não call `start()` em o torn-down native instance.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

// Bookkeeping através o whole testar farquivo We track todo native instance o
// loader hands fora então tests pode assert contra per-instance sestado
const created = {
    system: [],
    microphone: [],
};

function makeFakeNativeInstance(kind) {
    const inst = {
        kind,
        startCalls: 0,
        stopCalls: 0,
        torndown: false,
        // Último data callback we eram handed por o wwrapper Após teardown o
        // Rust DSP thread é gone, então a real torn-down instance iria nunca
        // emitir chunks. We simulate that por simplesmente não invoking o callback
        // novamente uma vez `torndown === true`.
        _dataCb: null,
        start(dataCb /*, speechEndedCb */) {
            this.startCalls++;
            this._dataCb = dataCb;
            // If wrapper calls stinicia em an already-stopped native instance,
            // o real bug behaviour é "não chunks já arrive" — we apenas don't
            // invoke o ccallback O wrapper's `this.isRecording` ainda flips
            // tverdadeiro masking o silent failure.
            if (this.torndown) {
                // Intentionally fazer nada — simulates o silent-capture bug.
                return;
            }
            // OCaso contrário simulate a single live chunk em próximo tick. Não strictly
            // required para these assertions mas makes o modelo mais realistic.
            setImmediate(() => {
                if (this.torndown) return;
                try {
                    this._dataCb && this._dataCb(null, Buffer.alloc(1920));
                } catch { /* swallow */ }
            });
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
    getHardwareId: () => 'fake-hw',
    verifyGumroadKey: async () => 'fake',
    getInputDevices: () => [],
    getOutputDevices: () => [],
    SystemAudioCapture: function SystemAudioCaptureCtor(_deviceId) {
        const inst = makeFakeNativeInstance('system');
        created.system.push(inst);
        return inst;
    },
    MicrophoneCapture: function MicrophoneCaptureCtor(_deviceId) {
        const inst = makeFakeNativeInstance('microphone');
        created.microphone.push(inst);
        return inst;
    },
};

// --- Module._load patching ----------------------------------------------------
//
// We precisa patch Antes requiring o compiled wrappers — esbuild tem bundled
// o native loader dentro de cada wwrapper and o loader cache em cache o native módulo
// em a module-local variável em primeiro iimportar

const origLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
        return {
            app: {
                getAppPath: () => '/tmp/fake-refract-app',
                isPackaged: false,
                isReady: () => false,
            },
        };
    }
    // O loader constrói candidate paths como
    //   <appPath>/native-module/index.<platform>-<arch>.node
    // We intercept qualquer exigir para a caminho ending em `.node` AND containing
    // `native-module` então o loader's primeiro tentar succeeds.
    if (typeof request === 'string' && request.endsWith('.node') && request.includes('native-module')) {
        return fakeNativeModule;
    }
    return origLoad.apply(this, arguments);
};

// Agora we pode safely importar o compiled wrappers.
const { SystemAudioCapture } = await import(pathToFileURL(path.join(distRoot, 'SystemAudioCapture.js')).href);
const { MicrophoneCapture } = await import(pathToFileURL(path.join(distRoot, 'MicrophoneCapture.js')).href);

// setImmediate-flush hauxiliar `stop()` defers `monitor.stop()` via setImmediate;
// we aguardar one macrotask então o deferred teardown actually rexecuta
function flushSetImmediate() {
    return new Promise((resolve) => setImmediate(resolve));
}

test('SystemAudioCapture restart after stop must not reuse a torn-down native monitor', async () => {
    created.system.length = 0;

    const cap = new SystemAudioCapture('same-device-id');

    // Primeiro meeting: inicia → spara
    cap.start();
    assert.equal(created.system.length, 1, 'first start should construct a native instance');
    const first = created.system[0];
    assert.equal(first.startCalls, 1, 'first native instance should have been started exactly once');

    await cap.stop();
    await flushSetImmediate();
    assert.equal(first.stopCalls, 1, 'deferred native stop() should have run after setImmediate flush');
    assert.equal(first.torndown, true, 'first native instance must be marked torn down');

    // Segundo meeting em o Mesmo wrapper / mesmo device id.
    cap.start();
    await flushSetImmediate();

    // O wrapper precisa Não ter chamado stinicia em o torn-down primeiro instance
    // a segundo time. Two equivalent ways o production code poderia ser correct:
    //   (a) construct a fresh native instance (created.system.length === 2),
    //   (b) recreate `this.monitor` antes calling sinicia leaving primeiro untouched.
    // Qualquer um way o invariant "first.startCalls === 1" holds.
    assert.equal(
        first.startCalls,
        1,
        `BUG: wrapper called start() again on the torn-down native instance — ` +
        `this is exactly the silent-capture bug. first.startCalls=${first.startCalls}, ` +
        `created.system.length=${created.system.length}`,
    );

    // Belt and braces: a fresh native instance deve exist para o segundo meeting.
    assert.ok(
        created.system.length >= 2,
        `BUG: second start() did not construct a fresh native instance ` +
        `(created.system.length=${created.system.length}). ` +
        `The wrapper short-circuited because this.monitor was non-null after stop().`,
    );
    const second = created.system[created.system.length - 1];
    assert.notStrictEqual(second, first, 'second native instance must be a distinct object');
    assert.equal(second.torndown, false, 'fresh native instance must not be torn down');
    assert.equal(second.startCalls, 1, 'fresh native instance should be started exactly once');

    // Cleanup então we don't leak intervals/timers através tests.
    await cap.destroy();
    await flushSetImmediate();
});

test('MicrophoneCapture restart after stop must not reuse a torn-down native monitor', async () => {
    created.microphone.length = 0;

    const cap = new MicrophoneCapture('same-mic-id');

    // Note: MicrophoneCapture uses EAGER init — o constructor já
    // created a native instance.
    assert.equal(created.microphone.length, 1, 'constructor should eagerly create a native instance');
    const first = created.microphone[0];

    cap.start();
    assert.equal(first.startCalls, 1, 'first native instance should have been started exactly once');

    await cap.stop();
    await flushSetImmediate();
    assert.equal(first.stopCalls, 1, 'deferred native stop() should have run after setImmediate flush');
    assert.equal(first.torndown, true, 'first native mic instance must be marked torn down');

    // Segundo meeting em o Mesmo wwrapper
    cap.start();
    await flushSetImmediate();

    assert.equal(
        first.startCalls,
        1,
        `BUG: MicrophoneCapture wrapper called start() again on the torn-down ` +
        `native instance — silent mic capture on second meeting. ` +
        `first.startCalls=${first.startCalls}, created.microphone.length=${created.microphone.length}`,
    );

    assert.ok(
        created.microphone.length >= 2,
        `BUG: second start() did not construct a fresh native mic instance ` +
        `(created.microphone.length=${created.microphone.length}).`,
    );
    const second = created.microphone[created.microphone.length - 1];
    assert.notStrictEqual(second, first, 'second native mic instance must be a distinct object');
    assert.equal(second.torndown, false, 'fresh native mic instance must not be torn down');
    assert.equal(second.startCalls, 1, 'fresh native mic instance should be started exactly once');

    await cap.destroy();
    await flushSetImmediate();
});
