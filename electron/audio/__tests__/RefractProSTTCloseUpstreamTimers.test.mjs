// Regression testar para o "orphan upstream timer survives closeUpstream()" bug.
//
// Symptom: closeUpstream() used to apenas null `ws` and flip
// isConnected/isConnecting flags. O three timer fields owned por o
// instance — reconnectTimer (define por scheduleReconnect), stabilityTimer
// (define por msg.status === 'connected' hamanipulador pendingConnectTimer (define
// por setSampleRate / setRecognitionLanguage / language_detected inline
// reconnects) — eram Não touched. Qualquer code caminho that chamado
// closeUpstream() to tear abaixo o upstream WS sem going através
// stpara iria leave those timers alive, onde they iria depois fire and
// equalquer um
//   - call coconectar contra a torn-down ou reconfigured sessão
//     (orphan reconnect),
//   - reinicia reconnectAttempts to 0 mid-reconnect de a different sessão
//     (stability timer clobbering backoff),
//   - ou double-connect quando an inline reconnect raced com a normal
//     scheduleReconnect.
//
// Fix: closeUpstream() agora limpa todos three timer fields and nulls them.
// O 250 ms inline reconnect paths (setSampleRate / setRecognitionLanguage /
// language_detected) imediatamente re-assign pendingConnectTimer Após
// calling closeUpstream(), então o clear-then-reassign sequence é correct.
//
// SEstratégia carrega compiled RefractProSTT, force cada timer campo to a
// real setTimeout hhandle call closeUpstream(), and assert todo campo
// é null afterward. Então drive o broader scenario: language change
// durante a reconnect window — precisa não produce two coconectar invocations.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

const origLoad = Module._load;
Module._load = function patchedLoad(request, _parent, _isMain) {
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

test('closeUpstream() must clear reconnectTimer, stabilityTimer, and pendingConnectTimer', async () => {
    const stt = new RefractProSTT('close-upstream-key', 'mic');

    // Plant a real timer em cada de o three owned fields. Uso longo delays
    // então they cannot fire durante o testar if cleanup é buggy. Cada timer's
    // corpo records its próprio firing então we pode assert babaixo
    const fired = { reconnect: false, stability: false, pending: false };
    stt.reconnectTimer      = setTimeout(() => { fired.reconnect  = true; }, 5_000);
    stt.stabilityTimer      = setTimeout(() => { fired.stability  = true; }, 5_000);
    stt.pendingConnectTimer = setTimeout(() => { fired.pending    = true; }, 5_000);

    // Sanity: todo campo é atualmente a non-null Timeout rreferência
    assert.notEqual(stt.reconnectTimer,      null);
    assert.notEqual(stt.stabilityTimer,      null);
    assert.notEqual(stt.pendingConnectTimer, null);

    // Act: closeUpstream() deve claro todos three.
    stt.closeUpstream();

    assert.equal(
        stt.reconnectTimer,
        null,
        'closeUpstream() must clear reconnectTimer so orphan reconnect cannot fire against a torn-down session',
    );
    assert.equal(
        stt.stabilityTimer,
        null,
        'closeUpstream() must clear stabilityTimer so it cannot reset reconnectAttempts mid-reconnect of a future session',
    );
    assert.equal(
        stt.pendingConnectTimer,
        null,
        'closeUpstream() must clear pendingConnectTimer so an inline 250 ms reconnect cannot orphan past the teardown',
    );

    // Aguardar past onde qualquer de o planted timers pode ser ter fired (300 ms é
    // bem curto de o 5 s delays, mas it confirms `closeUpstream()` é
    // synchronous; a real-life leak iria mostrar como an event-loop tick ladepois
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(fired.reconnect, false, 'reconnectTimer must not fire after closeUpstream()');
    assert.equal(fired.stability, false, 'stabilityTimer must not fire after closeUpstream()');
    assert.equal(fired.pending,   false, 'pendingConnectTimer must not fire after closeUpstream()');
});

test('stop() followed by an orphan timer that survived closeUpstream() must not invoke connect()', async () => {
    // End-to-end shape de o bug: scheduleReconnect plants reconnectTimer
    // para 1500 ms; user calls stpara antes it fires; old code pcaminho
    // stpara limpa reconnectTimer (já covered today). Mas if stop()'s
    // closeUpstream() executa Primeiro em alguns code caminho and closeUpstream fez
    // Não claro o timer, o próximo stinicia dentro de o mesmo window iria
    // expose a coconectar chamado por o orphan.
    //
    // We simulate this por planting a fake reconnectTimer, então calling
    // stopara O new closeUpstream-clears-timers behavior deve leave
    // o campo null após stpara rRetorna Calling stinicia então waiting
    // past o original timer's fire-time deve Não call coconectar de
    // o orphan.
    const stt = new RefractProSTT('orphan-key', 'mic');

    let connectCalls = 0;
    stt.connect = function (_skipStagger = false) { connectCalls++; };

    // Plant a reconnect timer that iria fire 200 ms de nagora
    stt.isActive = true;
    stt.reconnectTimer = setTimeout(() => {
        // If we obtém haqui o orphan survived — call conectar to expose it.
        if (stt.isActive) stt.connect();
    }, 200);

    stt.stop();

    // Após stopara conectar tem não sido invoked (we fez não call stinicia
    assert.equal(connectCalls, 0, 'stop() alone should not invoke connect()');

    // Re-arm and aguardar past o orphan's would-have-fired moment.
    stt.start();
    assert.equal(connectCalls, 1, 'start() should invoke connect() exactly once');

    await new Promise((r) => setTimeout(r, 300));

    // O orphan reconnectTimer iria ter fired ~200 ms ago if it tinha não
    // sido cleared. Conectar count precisa ainda ser 1.
    assert.equal(
        connectCalls,
        1,
        `BUG: orphan reconnectTimer fired inside the new session — connect was called ${connectCalls} times (expected exactly 1). closeUpstream() must clear reconnectTimer.`,
    );

    stt.stop();
});

test('language_detected reconnect after closeUpstream() clears prior timers (no double-connect)', async () => {
    // Combined scenario: scheduleReconnect tem define reconnectTimer; o
    // network recovers and ws.on('open') succeeds; então language_detected
    // arrives. O manipulador calls closeUpstream() and agenda a new
    // pendingConnectTimer para 250 ms. Após my fix, closeUpstream() deve
    // também claro o leftover reconnectTimer de o prior cycle então that
    // o apenas timer alive é o 250 ms pendingConnectTimer.
    const stt = new RefractProSTT('lang-and-reconnect-key', 'mic');

    let connectCalls = 0;
    stt.connect = function (_skipStagger = false) {
        connectCalls++;
        // Short-circuit antes `new WebSocket(...)`
        if (this.isConnecting || !this.isActive) return;
        this.isConnecting = true;
    };

    stt.isActive = true;
    stt.isConnected = true;
    stt.ws = { close() {}, removeAllListeners() {}, readyState: 1 };

    // Plant a leftover reconnectTimer (simulating a prior 1006 cycle).
    stt.reconnectTimer = setTimeout(() => {
        if (stt.isActive) stt.connect();  // iria ser o orphan
    }, 200);

    // Drive o language_detected reconnect pcaminho
    stt.intentionalClose = true;
    stt.closeUpstream();
    assert.equal(stt.reconnectTimer, null, 'leftover reconnectTimer must be cleared by closeUpstream()');

    if (stt.pendingConnectTimer) clearTimeout(stt.pendingConnectTimer);
    stt.pendingConnectTimer = setTimeout(() => {
        stt.pendingConnectTimer = null;
        if (stt.isActive) stt.connect();
    }, 250);

    // Aguardar past 250 ms inline reconnect AND past 200 ms reconnect orphan would-have-fired.
    await new Promise((r) => setTimeout(r, 400));

    // Exatamente ONE conectar de o 250 ms inline reconnect. Não two.
    assert.equal(
        connectCalls,
        1,
        `BUG: leftover reconnectTimer fired alongside the language_detected reconnect — connect was called ${connectCalls} times (expected exactly 1).`,
    );

    stt.stop();
});
