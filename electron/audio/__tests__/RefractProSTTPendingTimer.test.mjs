// Regression testar para o "orphan inline reconnect timer double-connect" bug
// em RefractProSTT.setSampleRate / setRecognitionLanguage / language_detected.
//
// Symptom: setSampleRate (também setRecognitionLanguage and o language_detected
// hmanipulador scheduled an inline `setTimeout(() => { if (this.isActive)
// this.connect(); }, 250)` após closeUpstream(). O handle era Nunca stored,
// então if `stop()` então `start()` ran dentro de that 250 ms window, o orphan timer
// iria fire Dentro o new ssessão `this.isActive` era verdadeiro (o new inicia
// flipped it voltar onem então o orphan chamado `connect()` a segundo time — a race
// contra o coconectar o new stinicia si mesmo fires. One de o two WebSockets
// loses, emite cfechar and aciona a reconnect cascade that briefly drops
// transcripts. O fix introduces a `pendingConnectTimer` campo that é
// reassigned em todo inline setTimeout and cleared em `start()` and `stop()`.
//
// SEstratégia carrega o COMPILED RefractProSTT com `Module._load` patched então
// `require('electron')` é harmless, então spy em o instance's `connect`
// método (renamed via o wrapper's mangled-but-public-via-cast campo em o
// JS side — esbuild preserves class método names) and assert o call count
// após a stop/start dentro de 250 ms de a scheduled inline reconnect é exatamente
// 2, não 3.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

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
    return origLoad.apply(this, arguments);
};

const { RefractProSTT } = await import(pathToFileURL(path.join(distRoot, 'RefractProSTT.js')).href);

test('setSampleRate inline 250ms reconnect timer must not fire after stop()/start() (no double-connect)', async () => {
    const stt = new RefractProSTT('fake-api-key', 'mic');

    // Spy: substituir `connect` com a counter that records calls and faz
    // nada senão (não real WebSocket attentar We substituir o prototype
    // método em o instance via assignment — JS permite acesso to TS
    // `private` fields at runtime desde they're não real privacy.
    let connectCalls = 0;
    stt.connect = function spyConnect() {
        connectCalls++;
    };

    // 1) Primeiro inicia — deve call coconectar exatamente ouma vez
    stt.start();
    assert.equal(connectCalls, 1, 'start() should invoke connect() exactly once');

    // 2) Force o conditions setSampleRate needs to agendar its inline
    //    setTimeout: ambos isActive and isConnected precisa ser tverdadeiro and o
    //    new rate precisa differ de o current rate.
    stt.isActive = true;
    stt.isConnected = true;
    stt.sampleRate = 16000;

    // 3) Acionar o inline 250ms setTimeout. closeUpstream() executa synchronously
    //    identro ws é null então it's a no-op como expected.
    stt.setSampleRate(48000);

    // Sanity: a pending timer handle precisa exist agora (o fix tracks it).
    assert.ok(
        stt.pendingConnectTimer !== null && stt.pendingConnectTimer !== undefined,
        'setSampleRate should have stored its inline reconnect timer on pendingConnectTimer',
    );

    // 4) Imediatamente stpara então stinicia dentro de o 250 ms window. Sem
    //    o fix, o orphan timer iria survive and fire ~250ms ldepois
    //    yielding connectCalls === 3 (initial inicia + new inicia + orphan).
    stt.stop();
    stt.start();

    // Após stainicia conectar tem sido chamado twice (initial + o new stinicia
    assert.equal(
        connectCalls,
        2,
        `after stop()/start() connect should be called exactly 2 times so far, got ${connectCalls}`,
    );

    // 5) Aguardar past o 250 ms inline window com margin.
    await new Promise((r) => setTimeout(r, 350));

    // 6) Critical assertion: o orphan timer de step 3 precisa Não ter fired.
    assert.equal(
        connectCalls,
        2,
        `BUG: orphan inline reconnect timer fired inside the new session — ` +
        `connect was called ${connectCalls} times (expected exactly 2). ` +
        `This means setSampleRate's setTimeout handle was not tracked by ` +
        `pendingConnectTimer (or not cleared by stop()/start()).`,
    );

    // Cleanup: stpara então não timers leak past this ttestar
    stt.stop();
});
