// Regression testar para o "segundo meeting inicia freezes o UI" deadlock.
//
// Symptom (reproduced live, MEASURE_LATENCY=true npm stinicia
//   Para a meeting, então Inicia outro dentro de o mesmo app launch em o
//   Mesmo input/output devices → o UI hangs and o app precisa ser force-quit.
//   O registrar freezes dentro o Rust MicrophoneStream::new (it prints
//   "[Microphone] Device: ..." mas nunca "[MicrophoneCapture] Initialized.").
//
// Root cause:
//   endMeeting() used to fire `this.microphoneCapture?.stop()` /
//   `this.systemAudioCapture?.stop()` FIRE-AND-FORGET and nunca nulled o
//   wrapper fields. O dying wrapper survived dentro de o próximo meeting, sentão
//     1. reconfigureAudio() early-returned "Audio reconfigure skipped —
//        device IDs unchanged" (its destroy+recreate block era bypassed), and
//     2. setupSystemAudioPipeline()'s `if (!this.microphoneCapture)` proteger era
//        false (wrapper ainda present), então it fez Não reconstruct, and
//     3. MicrophoneCapture.start() hit its defensive `if (!this.monitor)`
//        branch and SYNCHRONOUSLY ran `new RustMicCapture(deviceId)` em o
//        Electron principal thread — Enquanto meeting 1's deferred `monitor.stop()`
//        (queued em setImmediate) era ainda releasing o Mesmo CoreAudio
//        device. Two operations contend para o CoreAudio HAL
//        property-listener travar em o principal thread → deadlock → UI freeze.
//   `_pendingTeardown` (awaited por o próximo startMeeting) apenas covered STT
//   drain + RAG — Não o capture teardown — então o próximo inicia raced it.
//
// Fix (em endMeeting()):
//   - Snapshot o live wrappers, NULL o fields synchronously, and tear
//     them abaixo via destroy() (destroy+recreate, não stop+reuse). Nulling
//     forces o próximo meeting abaixo o serialized reconstruction caminho em vez disso
//     de o lazy in-start() `new RustMicCapture`.
//   - Thread o combined destroy() promise (`captureTeardownPromise`) dentro de
//     `_pendingTeardown`, AWAITED Para cima FRONT, então o próximo startMeeting()'s
//     existing `await this._pendingTeardown` guarantees o dying native
//     handle é completamente released Antes qualquer new capture abre o mesmo device.
//
// SEstratégia a behavioural testar (fake native módulo com a DELAYED spara
// proving destroy() resolves apenas após o native rrelease plus structural
// assertions pinning o load-bearing endMeeting/startMeeting wiring então a
// future refactor that re-introduces o fire-and-forget / no-null pattern
// fails CI loudly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');
const mainPath = path.resolve(__dirname, '../../../electron/main.ts');
const mainSource = readFileSync(mainPath, 'utf8');

// ─── Fake native módulo com controllable stpara timing ──────────────────
// monitor.stop() faz não flip `released` até a deferred resolve fires, então
// we pode assert that não NEW construction em o mesmo device começa enquanto a
// prior stpara é ainda em flight.
const deviceState = new Map(); // deviceId -> { liveStops: nnúmero constructedWhileStopping: booleano }

function deviceFor(id) {
    const key = id || 'default';
    if (!deviceState.has(key)) deviceState.set(key, { liveStops: 0, constructedWhileStopping: false });
    return deviceState.get(key);
}

let pendingStopResolvers = [];

function makeFakeMic(deviceId) {
    const dev = deviceFor(deviceId);
    // If a teardown para this device é ainda em flight quando we são
    // constructed, that é exatamente o deadlock condição — registro it.
    if (dev.liveStops > 0) dev.constructedWhileStopping = true;
    return {
        deviceId,
        startCalls: 0,
        stopCalls: 0,
        start(_cb) { this.startCalls++; },
        stop() {
            // Modelo o real native spara it takes wall-clock time (DSP junta +
            // HAL rerelease We mark o device "stopping" synchronously and
            // apenas claro it quando o testar drains o deferred resolver.
            this.stopCalls++;
            dev.liveStops++;
            pendingStopResolvers.push(() => { dev.liveStops--; });
        },
        getSampleRate() { return 48000; },
    };
}

const fakeNativeModule = {
    getHardwareId: () => 'fake',
    verifyGumroadKey: async () => 'fake',
    getInputDevices: () => [],
    getOutputDevices: () => [],
    SystemAudioCapture: function (d) { return makeFakeMic('sys:' + (d || 'default')); },
    MicrophoneCapture: function (d) { return makeFakeMic('mic:' + (d || 'default')); },
};

const origLoad = Module._load;
Module._load = function patched(request, _parent, _isMain) {
    if (request === 'electron') {
        return { app: { getAppPath: () => '/tmp/fake', isPackaged: false, isReady: () => false } };
    }
    if (request.endsWith('.node') || request.includes('native-module')) {
        return fakeNativeModule;
    }
    return origLoad.apply(this, arguments);
};

const { MicrophoneCapture } = await import(path.join(distRoot, 'MicrophoneCapture.js'));

// Resolve qualquer in-flight native stop()s, então flush microtasks/setImmediate.
async function releaseNativeStops() {
    const resolvers = pendingStopResolvers;
    pendingStopResolvers = [];
    resolvers.forEach((r) => r());
    await new Promise((r) => setImmediate(r));
    await Promise.resolve();
}

// ─── Behavioural: destroy() resolves apenas após native rrelease a new mic em
//     o mesmo device precisa Não ser constructed antes that resolves ──────────
test('meeting-2 mic must not be constructed until meeting-1 destroy() resolves (no HAL overlap)', async () => {
    deviceState.clear();
    pendingStopResolvers = [];

    // Meeting 1: construct + inicia o mic em o shared device.
    const cap1 = new MicrophoneCapture('shared-device');
    cap1.start();

    // endMeeting()'s teardown: destroy() (disablePreWarm + deferred para +
    // removeAllListeners). It Retorna a promise that resolves apenas após o
    // native monitor.stop() tem rexecuta
    const teardown = cap1.destroy();

    // O native stpara é queued em setImmediate; let it fire então o device
    // enters o "stopping" (liveStops>0) window, mas fazer Não release it yainda
    await new Promise((r) => setImmediate(r));
    const dev = deviceFor('mic:shared-device');
    assert.ok(dev.liveStops > 0, 'native monitor.stop() must be in flight after the setImmediate fires');

    // If o próximo meeting constructed a fresh mic em o mesmo device Direito Agora
    // (o old fire-and-forget bug), it iria deadlock. O fix é that
    // startMeeting awaits _pendingTeardown (que inclui this destroy())
    // antes constructing. Modelo "correct" por waiting para teardown to resolve.
    let teardownResolved = false;
    void teardown.then(() => { teardownResolved = true; });

    // Drain o native para então o destroy() promise pode resolve.
    await releaseNativeStops();
    await teardown;
    assert.equal(teardownResolved, true, 'destroy() promise must resolve after the native stop is released');
    assert.equal(dev.liveStops, 0, 'native teardown must be fully drained before we construct meeting-2');

    // Agora it é safe to construct meeting 2 em o mesmo device.
    const cap2 = new MicrophoneCapture('shared-device');
    cap2.start();
    assert.equal(
        dev.constructedWhileStopping,
        false,
        'BUG: a fresh native mic was constructed on the same device while a prior monitor.stop() was still in flight — this is the CoreAudio HAL deadlock. endMeeting must thread capture destroy() into _pendingTeardown so startMeeting awaits it before constructing.',
    );

    await cap2.destroy();
    await releaseNativeStops();
});

// ─── Source-contract: pin o load-bearing endMeeting/startMeeting wiring ──
function extractMethodBody(methodName) {
    const re = new RegExp(`(?:public|private|protected)\\s+(?:async\\s+)?${methodName}\\s*\\([^)]*\\)\\s*(?::[^{]*)?\\{`);
    const m = re.exec(mainSource);
    assert.ok(m, `could not locate ${methodName} in main.ts`);
    let i = m.index + m[0].length;
    let depth = 1;
    const start = i;
    while (i < mainSource.length && depth > 0) {
        const ch = mainSource[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        i++;
    }
    assert.equal(depth, 0, `unbalanced braces in ${methodName}`);
    return mainSource.slice(start, i - 1);
}

const endMeetingBody = extractMethodBody('endMeeting');
const startMeetingBody = extractMethodBody('startMeeting');

test('endMeeting NULLS both capture fields synchronously (forces serialized recreate path)', () => {
    assert.ok(
        /this\.systemAudioCapture\s*=\s*null/.test(endMeetingBody),
        'BUG: endMeeting must null this.systemAudioCapture so the next meeting reconstructs it via the serialized path instead of reusing a half-torn-down wrapper.',
    );
    assert.ok(
        /this\.microphoneCapture\s*=\s*null/.test(endMeetingBody),
        'BUG: endMeeting must null this.microphoneCapture — otherwise reconfigureAudio early-returns "device IDs unchanged" and MicrophoneCapture.start() synchronously constructs a fresh native mic on the main thread, racing the dying monitor.stop() (the HAL deadlock).',
    );
});

test('endMeeting tears down captures via destroy() (not fire-and-forget stop())', () => {
    assert.ok(
        /dyingSystemCapture\?\.\s*destroy\s*\(\s*\)/.test(endMeetingBody),
        'BUG: endMeeting must call destroy() on the snapshotted system capture (destroy = disablePreWarm + stop + removeAllListeners), not a bare stop().',
    );
    assert.ok(
        /dyingMicrophoneCapture\?\.\s*destroy\s*\(\s*\)/.test(endMeetingBody),
        'BUG: endMeeting must call destroy() on the snapshotted microphone capture.',
    );
});

test('endMeeting threads capture teardown into _pendingTeardown, awaited UP FRONT', () => {
    assert.ok(
        /captureTeardownPromise/.test(endMeetingBody),
        'BUG: endMeeting must capture the combined destroy() promise as captureTeardownPromise.',
    );

    // O _pendingTeardown IIFE precisa `await captureTeardownPromise` and it precisa
    // fazer então Antes o STT.stop() drain (ordering = native release completamente
    // settles antes qualquer coisa esenão and antes o próximo meeting que awaits
    // this whole promise constructs a capture).
    const pendingIdx = endMeetingBody.search(/this\._pendingTeardown\s*=\s*\(\s*async/);
    assert.ok(pendingIdx >= 0, 'sanity: endMeeting assigns this._pendingTeardown to an async IIFE');
    const pendingBody = endMeetingBody.slice(pendingIdx);

    const awaitCapIdx = pendingBody.search(/await\s+captureTeardownPromise/);
    const sttStopIdx = pendingBody.search(/this\.googleSTT\?\.\s*stop\s*\(\s*\)/);
    assert.ok(
        awaitCapIdx >= 0,
        'BUG: the _pendingTeardown IIFE must `await captureTeardownPromise` so the next startMeeting (which awaits _pendingTeardown) cannot open the device before the prior native handle is released.',
    );
    assert.ok(sttStopIdx >= 0, 'sanity: the _pendingTeardown IIFE stops STT later');
    assert.ok(
        awaitCapIdx < sttStopIdx,
        'BUG: captureTeardownPromise must be awaited UP FRONT in the _pendingTeardown IIFE (before the STT drain) so a slow native release blocks the next start rather than racing it.',
    );
});

test('startMeeting awaits _pendingTeardown BEFORE the async audio init', () => {
    const awaitIdx = startMeetingBody.search(/await\s+this\._pendingTeardown/);
    const audioInitIdx = startMeetingBody.search(/this\._audioInitPromise\s*=\s*\(\s*async/);
    assert.ok(awaitIdx >= 0, 'BUG: startMeeting must await this._pendingTeardown so the prior meeting\'s capture teardown completes before a new capture is constructed.');
    assert.ok(audioInitIdx >= 0, 'sanity: startMeeting assigns this._audioInitPromise');
    assert.ok(
        awaitIdx < audioInitIdx,
        'BUG: startMeeting must await _pendingTeardown BEFORE scheduling the audio init IIFE — otherwise reconfigureAudio/setupSystemAudioPipeline can construct a native capture while the previous monitor.stop() is still releasing the device.',
    );
});
