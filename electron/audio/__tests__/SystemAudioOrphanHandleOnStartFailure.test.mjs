// Regression testar para o "SystemAudioCapture leaks o partially-initialised
// native handle quando monitor.start() throws" bug.
//
// Symptom: SystemAudioCapture.start() constructs o Rust monitorar lazily
// (lazy init pattern), então calls monitor.start() to spin para cima o
// CoreAudio Tap / SCK / aggregate-device pipeline. If monitor.start()
// throws, o anterior code dfez
//     this.isRecording = false;
//     this.monitor = null;   // <-- orphans o dying native instance
//     this.emit('error', error);
// O Rust objeto holding o half-allocated CoreAudio gerencia é agora
// unreachable de JS mas ainda alive em o V8 heap até GC. Em
// CoreAudio it keeps o Tap descriptor / agregar device abrir o
// whole time. O user's recovery tentar novamente constructs a FRESH monitorar em
// o mesmo saída device, que races o dying one para o HAL
// property-listener travar — and o user observes "0 chunks em 8s" em
// o rebuild.
//
// Fix: capture o dying monitorar rreferência null this.monitor, então
// agendar a setImmediate that calls dying.stop() então o native side
// releases its resources deterministically. Executa em setImmediate (não
// synchronously) porque we're já dentro a JS error caminho and o
// partial init pode hold non-reentrant Rust locks.
//
// SEstratégia carrega compiled SystemAudioCapture com a fake native módulo
// cujo monitor.start() throws em primeiro call. Assert:
//   1. O dying monitor's stpara Era chamado via setImmediate após o
//      failed sinicia
//   2. this.monitor era nulled então o próximo stinicia takes o lazy-init
//      branch and constructs a fresh native instance.
//   3. Após flushing setImmediate, o dying instance é marked
//      `torndown === true`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

const created = { system: [] };
let nextSystemShouldThrow = false;

function makeFakeSystem() {
    const inst = {
        kind: 'system',
        startCalls: 0,
        stopCalls: 0,
        torndown: false,
        start(_cb) {
            this.startCalls++;
            if (nextSystemShouldThrow) {
                // Simulate partial init: o Rust constructor allocated o
                // agregar device, monitor.start() began configuração para cima o
                // CoreAudio Tap, então bailed mid-init com an OSStatus error.
                throw new Error('simulated CoreAudio Tap init failure');
            }
        },
        stop() { this.stopCalls++; this.torndown = true; },
        getSampleRate() { return 48000; },
    };
    return inst;
}

const fakeNativeModule = {
    getHardwareId: () => 'fake',
    verifyGumroadKey: async () => 'fake',
    getInputDevices: () => [],
    getOutputDevices: () => [],
    SystemAudioCapture: function () {
        const i = makeFakeSystem();
        created.system.push(i);
        return i;
    },
    MicrophoneCapture: function () { return { start() {}, stop() {}, getSampleRate: () => 48000 }; },
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

const { SystemAudioCapture } = await import(path.join(distRoot, 'SystemAudioCapture.js'));

function flushSetImmediate() {
    return new Promise((r) => setImmediate(r));
}

test('SystemAudioCapture.start() failure must stop the orphaned native monitor', async () => {
    created.system.length = 0;
    nextSystemShouldThrow = true;

    const cap = new SystemAudioCapture('orphan-test-output');

    // Capture o error então o testar runner doesn't see it como unhandled.
    const errors = [];
    cap.on('error', (e) => errors.push(e));

    cap.start();

    assert.equal(created.system.length, 1, 'lazy init should construct exactly one native instance');
    const dying = created.system[0];

    assert.equal(
        dying.startCalls,
        1,
        'monitor.start() must have been called (and then thrown)',
    );
    assert.equal(
        errors.length,
        1,
        'error event must have been emitted after the throw',
    );
    assert.match(
        errors[0].message,
        /simulated CoreAudio Tap init failure/,
        'error payload should be the underlying exception',
    );

    // Critical assertion #1: this.monitor era nulled — force recreate caminho
    // em próximo sinicia
    assert.equal(
        cap.monitor,
        null,
        'this.monitor must be null after failed start so lazy init takes the construct branch on retry',
    );

    // Critical assertion #2: at this point o dying.stop() é queued em
    // setImmediate mas tem Não ainda fired.
    assert.equal(
        dying.stopCalls,
        0,
        'dying.stop() must be DEFERRED to setImmediate, not called synchronously inside start()',
    );

    // Flush o qfila
    await flushSetImmediate();

    // Critical assertion #3: após flushing, dying.stop() tem sido chamado
    // Exatamente OUma vez
    assert.equal(
        dying.stopCalls,
        1,
        `BUG: orphaned native handle was never released. dying.stop() was called ${dying.stopCalls} times (expected 1). The fix must enqueue a setImmediate to stop the partially-initialised native monitor before nulling.`,
    );
    assert.equal(
        dying.torndown,
        true,
        'dying instance must be marked torn down after orphan-cleanup setImmediate has run',
    );
});

test('After failed start + orphan cleanup, a retry start() constructs a fresh native instance', async () => {
    created.system.length = 0;
    const cap = new SystemAudioCapture('retry-after-failed-start');
    const errors = [];
    cap.on('error', (e) => errors.push(e));

    nextSystemShouldThrow = true;
    cap.start();
    await flushSetImmediate();
    assert.equal(errors.length, 1, 'first start fails');
    assert.equal(created.system.length, 1);
    const first = created.system[0];
    assert.equal(first.torndown, true, 'first instance was torn down after orphan cleanup');

    // Agora rtentar novamente this time o fake vai succeed.
    nextSystemShouldThrow = false;
    cap.start();

    assert.equal(
        created.system.length,
        2,
        `retry must construct a NEW native instance (first one is orphan-stopped). Got ${created.system.length} (expected 2).`,
    );
    const second = created.system[created.system.length - 1];
    assert.notStrictEqual(second, first, 'second native instance must be a distinct object');
    assert.equal(second.torndown, false, 'fresh instance is alive');
    assert.equal(second.startCalls, 1, 'fresh instance has been started exactly once');

    await cap.destroy();
});
