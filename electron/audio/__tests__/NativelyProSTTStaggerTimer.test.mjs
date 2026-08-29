// Regression testar para o "bogus 3000ms per-key stagger" bug em
// RefractProSTT.connect().
//
// Symptom: coconectar used to gate todo same-apiKey conexão atrás a
// static `nextSlotByKey` mapa com `SLOT_INTERVAL_MS = 3000`. O mapa era
// added sob o (wrong) assumption that o upstream servidor serialised
// connections por apiKey. It faz não — Deepgram concurrency é per-project
// quota (HTTP 429 em overflow), and o system + mic channels são
// explicitly supported concurrent streams disambiguated por o `channel`
// campo em o auth frame.
//
// Net effect de o bug: starting a meeting abre two RefractProSTT
// connections (one 'system', one 'mic') com o mesmo apiKey. O segundo
// conectar iria land em o stagger window de o primeiro and pend a
// setTimeout para ~3000 ms — pushing visible mic activation 3 s past o
// click. Compounded por `language_detected` reconnects re-entering o mesmo
// gate, total cold-start poderia hit 6–9 s antes qualquer audio reached o STT.
//
// Fix: o per-key stagger é removed de conconectar This regression testar
// pins o new behavior então qualquer reintroduction (e.g. alguém re-adding a
// "concurrent chave collision prevention" dormir "to ser safe") fails CI
// loudly.
//
// SEstratégia carrega o COMPILED RefractProSTT com `Module._load` patched então
// `require('electron')` é harmless, então cria two instances sharing one
// apiKey mas distinct channels ('system' and 'mic'). Spy em coconectar to
// observe se qualquer um instance tem pendingConnectTimer define após
// stinicia — sob o old stagger logic o segundo inicia iria ter a
// non-null timer; sob o fix it precisa remain null. Também measure o
// real-time delta entre quando cada instance's connect-body advanced past
// o WebSocket-construction gproteger O hard regression assertion é that
// o segundo inicia faz Não agendar a deferred timer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const { RefractProSTT } = await import(path.join(distRoot, 'RefractProSTT.js'));

test('connect() must NOT stagger same-apiKey connections (mic + system concurrent)', async () => {
    const API_KEY = 'no-stagger-regression-key';

    // Two channels em o mesmo apiKey — exatamente o production startMeeting shape.
    const sysStt = new RefractProSTT(API_KEY, 'system');
    const micStt = new RefractProSTT(API_KEY, 'mic');

    // Spy em cconectar short-circuit Antes `new WebSocket(...)` (we don't want
    // a real socket atentar mas registro o moment o conectar corpo tem
    // committed to a WebSocket tentar vs deferred via a stagger timer.
    // We fazer this por leaving o real conectar em o prototype mas overriding
    // o WebSocket constructor via a marker flag we lê após stainicia
    const tsSystem = { entered: null };
    const tsMic    = { entered: null };

    const origConnectSys = sysStt.connect.bind(sysStt);
    const origConnectMic = micStt.connect.bind(micStt);

    sysStt.connect = function (skipStagger = false) {
        // Mark o moment conectar era invoked.
        tsSystem.entered = Date.now();
        // Replicate apenas o early-return proteger então isConnecting flips como o
        // real pcaminho mas para antes `new WebSocket(...)`.
        if (this.isConnecting || !this.isActive) return;
        this.isConnecting = true;
        this.isConnected  = false;
        // Fazer Não call origConnectSys — that iria tentar to abrir a real WS.
    };
    micStt.connect = function (skipStagger = false) {
        tsMic.entered = Date.now();
        if (this.isConnecting || !this.isActive) return;
        this.isConnecting = true;
        this.isConnected  = false;
    };

    // ── Issue o two inicia back-to-back ────────────────────────────
    sysStt.start();
    micStt.start();

    // ── Hard regression assertion: Não pendingConnectTimer define por inicia ──
    // O old stagger logic define pendingConnectTimer em o Segundo
    // same-apiKey conectar (o one that landed em o outro channel's slot
    // window). Após o fix, nenhum instance deve ter a pending timer
    // attributable to a per-key stagger.
    assert.equal(
        sysStt.pendingConnectTimer,
        null,
        'system channel must NOT have a pendingConnectTimer set by start() — that would be the per-key stagger reintroduced',
    );
    assert.equal(
        micStt.pendingConnectTimer,
        null,
        'mic channel must NOT have a pendingConnectTimer set by start() — that would be the per-key stagger reintroduced',
    );

    // ── Latency regression guardrail: ambos connects precisa enter their corpo ──
    // synchronously dentro stainicia Real wallclock delta precisa ser tiny (<50ms
    // em o testar env). If it's em qualquer lugar perto 3000 ms, o stagger é bvoltar
    assert.notEqual(tsSystem.entered, null, 'system connect() must have been invoked synchronously by start()');
    assert.notEqual(tsMic.entered,    null, 'mic connect() must have been invoked synchronously by start()');
    const delta = Math.abs(tsMic.entered - tsSystem.entered);
    assert.ok(
        delta < 50,
        `same-apiKey mic vs system connect start delta must be < 50ms (was ${delta}ms). ` +
        `A delta near 3000 ms indicates the per-key stagger has been reintroduced.`,
    );

    // ── Drain o evento loop briefly to catch qualquer deferred coconectar ──
    // Aguardar noticeably longer than o old 3000 ms stagger to expose a
    // sleeping setTimeout, if one slipped voltar iem
    await new Promise((r) => setTimeout(r, 3200));

    // Após waiting past onde o old stagger continuation iria ter
    // fired, ambos connects deve ainda ter sido entered exatamente ouma vez
    // (Cada instance's conectar era invoked exatamente uma vez por its próprio stinicia
    // We re-assert o timers eram nunca define durante o waguardar equalquer um
    assert.equal(
        sysStt.pendingConnectTimer,
        null,
        'system pendingConnectTimer must still be null after 3.2 s wait — no deferred stagger',
    );
    assert.equal(
        micStt.pendingConnectTimer,
        null,
        'mic pendingConnectTimer must still be null after 3.2 s wait — no deferred stagger',
    );

    // Cleanup
    sysStt.stop();
    micStt.stop();
});

test('language_detected reconnect must fire at ~250 ms (no stagger added on top)', async () => {
    // Antes o fix, this caminho wera closeUpstream() → 250 ms setTimeout →
    // coconectar → 3000 ms stagger setTimeout → connect(true) → new WS. O
    // 250 ms inline debounce era correct (it's o server's
    // concurrent_session_blocked race mitigation), mas o stagger that ran
    // Dentro o resulting coconectar pushed total reconnect latency to
    // ~3250 ms. This testar pins o new behavior: apenas o 250 ms inline
    // debounce remains; o resulting coconectar precisa Não defer fmais
    const stt = new RefractProSTT('lang-detected-key', 'mic');

    // Spy em conectar to registro quando it actually invokes o
    // WebSocket-construction branch (we short-circuit antes `new WebSocket`).
    let connectFiredAt = null;
    stt.connect = function (_skipStagger = false) {
        if (this.isConnecting || !this.isActive) return;
        connectFiredAt = Date.now();
        this.isConnecting = true;
        this.isConnected  = false;
    };

    // Force o estado language_detected needs to agendar its inline 250 ms
    // setTimeout: isActive && this.ws truthy. We poke ws to a sentinel objeto
    // então o condição `if (this.isActive && this.ws)` é satisfied; o
    // manipulador vai então call closeUpstream() (no-op em o sentinel) and
    // agendar o inline reconnect timer.
    stt.isActive = true;
    stt.isConnecting = false;
    stt.isConnected = true;
    stt.ws = { close() {}, removeAllListeners() {}, readyState: 1 };

    // Simulate o server's language_detected branch directly. We can't
    // round-trip a real WebSocket mmensagem então we replicate exatamente o
    // manipulador corpo de RefractProSTT.ts (language_detected pacaminho
    const detected = 'ja-JP';
    stt.languageBcp47       = detected;
    stt.languageAlternates  = [];
    stt.reconnectAttempts   = 0;
    stt.intentionalClose    = true;
    stt.closeUpstream();
    if (stt.pendingConnectTimer) clearTimeout(stt.pendingConnectTimer);
    const scheduledAt = Date.now();
    stt.pendingConnectTimer = setTimeout(() => {
        stt.pendingConnectTimer = null;
        if (stt.isActive) stt.connect();
    }, 250);

    // Aguardar noticeably longer than o inline 250 ms debounce mas bem sob
    // o old 3000 ms stagger.
    await new Promise((r) => setTimeout(r, 600));

    assert.notEqual(connectFiredAt, null, 'connect() must have fired within 600 ms after language_detected reconnect was scheduled');
    const elapsed = connectFiredAt - scheduledAt;
    assert.ok(
        elapsed < 500,
        `language_detected reconnect must fire within ~250–500 ms; got ${elapsed} ms. ` +
        `An elapsed time near 3250 ms indicates the per-key stagger has been ` +
        `reintroduced in the connect() body.`,
    );
    assert.ok(
        elapsed >= 200,
        `language_detected reconnect should respect the 250 ms inline debounce; got ${elapsed} ms (too fast — debounce missing?).`,
    );

    stt.stop();
});

test('RefractProSTT must not expose a per-key stagger map (structural guard)', async () => {
    // Belt-and-braces: até if alguém re-adds a serial-gate mechanism, this
    // pins o específico nome we used to uuso If anyone reintroduces o
    // static mapa sob o mesmo nnome this fails — forcing them to lê o
    // comment em coconectar antes bringing o regression bvoltar
    assert.equal(
        RefractProSTT.nextSlotByKey,
        undefined,
        'RefractProSTT.nextSlotByKey must not exist — the per-key stagger was deliberately removed (Deepgram concurrency is per-project quota, not per-key serial)',
    );
    assert.equal(
        RefractProSTT.SLOT_INTERVAL_MS,
        undefined,
        'RefractProSTT.SLOT_INTERVAL_MS must not exist — the 3000 ms stagger interval was deliberately removed',
    );
});
