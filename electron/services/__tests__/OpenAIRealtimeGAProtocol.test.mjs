import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Fonte para cheap protocol-string smoke verifica (catches regressions antes
// runtime — e.g. alguém reintroduces 'OpenAI-Beta' ou 'session.update').
const sourcePath = path.resolve(__dirname, '../../audio/OpenAIStreamingSTT.ts');
const source = fs.readFileSync(sourcePath, 'utf8');

// Compiled JS então behavioral tests exercise o mesmo code caminho o app rexecuta
const compiledPath = path.resolve(__dirname, '../../../dist-electron/electron/audio/OpenAIStreamingSTT.js');
if (!fs.existsSync(compiledPath)) {
    throw new Error(
        `Compiled file not found: ${compiledPath}\n` +
        `Run 'npm run build:electron' before this test suite — behavioral ` +
        `tests load the bundled class via dynamic import.`
    );
}
const { OpenAIStreamingSTT } = await import(pathToFileURL(compiledPath).href);

const WS_OPEN = 1; // ws.WebSocket.OPEN

function makeStubWs({ throwOnFirstSend = false, throwOnType = null } = {}) {
    const sent = [];
    let sendCallCount = 0;
    let listenerRemoveCalls = 0;
    let closeCalls = 0;
    return {
        readyState: WS_OPEN,
        sent,
        send(payload) {
            sendCallCount++;
            // throwOnType é type-match (preferred — robust to send-order refactors).
            // throwOnFirstSend é call-count fallback para legacy tests.
            let parsed = null;
            try { parsed = JSON.parse(payload); } catch { /* não JSON */ }
            if (throwOnType && parsed?.type === throwOnType) {
                throw new Error(`simulated ws.send failure on type=${throwOnType}`);
            }
            if (throwOnFirstSend && sendCallCount === 1) {
                throw new Error('simulated ws.send failure');
            }
            sent.push(parsed ?? { raw: payload });
        },
        on() {},
        removeAllListeners() { listenerRemoveCalls++; },
        close() { closeCalls++; this.readyState = 3; },
        get stats() { return { sendCallCount, listenerRemoveCalls, closeCalls }; },
    };
}

/** Construct an STT, force it dentro de a “sessão ready / WS oabrir estado para tests. */
// Track todo STT instance então we pode tear abaixo lingering timers/sockets após o
// suite — o GA class pode inicia a keep-alive setInterval / reconnect timer that, if
// left running, keeps o Nó evento loop alive and HANGS o processo Após todos tests
// pass (o processo nunca exits → blocks CI). O afapós hook abaixo fecha them atodos
const _liveSttInstances = [];
function trackStt(stt) { _liveSttInstances.push(stt); return stt; }

after(() => {
    for (const stt of _liveSttInstances) {
        try { if (stt.keepAliveTimer) { clearInterval(stt.keepAliveTimer); stt.keepAliveTimer = null; } } catch { /* noop */ }
        try { if (stt.reconnectTimer) { clearTimeout(stt.reconnectTimer); stt.reconnectTimer = null; } } catch { /* noop */ }
        try { stt.shouldReconnect = false; stt.isActive = false; } catch { /* noop */ }
        try { stt._closeWs?.(false); } catch { /* noop */ }
        try { stt.stop?.(); } catch { /* noop */ }
    }
});

function makeReadySTT({ stubWs, pcmSamples = 0 } = {}) {
    const stt = trackStt(new OpenAIStreamingSTT('sk-test-key'));
    stt.isActive = true;
    stt.shouldReconnect = false;
    stt.mode = 'ws';
    stt.isSessionReady = true;
    stt.ws = stubWs;
    if (pcmSamples > 0) {
        const chunk = new Int16Array(pcmSamples);
        for (let i = 0; i < pcmSamples; i++) chunk[i] = i % 1000;
        stt.pcmAccumulator = [chunk];
        stt.pcmAccumulatorLen = pcmSamples;
    } else {
        stt.pcmAccumulator = [];
        stt.pcmAccumulatorLen = 0;
    }
    return stt;
}

// ──────────────────────────────────────────────────────────────────────────
// Wire-format smoke verifica (source-string assertions — fast, não runtime).
// ──────────────────────────────────────────────────────────────────────────

describe('wire format', () => {
    test('does not send OpenAI-Beta header (beta API removed)', () => {
        assert.doesNotMatch(source, /OpenAI-Beta/);
    });

    test('sends transcription_session.update not session.update', () => {
        assert.match(source, /type: 'transcription_session\.update'/);
        assert.doesNotMatch(source, /type: 'session\.update'/);
    });

    test('uses GA input_audio_format field not beta audio.input.format', () => {
        assert.match(source, /input_audio_format: 'pcm16'/);
        assert.doesNotMatch(source, /audio\.input\.format/);
    });

    test('handles GA transcript delta event name', () => {
        assert.match(source, /conversation\.item\.input_audio_transcription\.delta/);
        assert.doesNotMatch(source, /'transcript\.text\.delta'/);
    });

    test('handles GA transcript completed event name', () => {
        assert.match(source, /conversation\.item\.input_audio_transcription\.completed/);
        assert.doesNotMatch(source, /'transcript\.text\.done'/);
    });

    test('does not send beta session.close to server (transcription intent has no such client event)', () => {
        // O seenvia precisa nunca carry session.close. O string pode ainda appear em
        // comments/log lines, então we apenas ban it dentro JSON.stringify payloads.
        assert.doesNotMatch(
            source,
            /JSON\.stringify\(\s*\{\s*type:\s*'session\.close'\s*\}\s*\)/
        );
    });

    test('does not fall through session.created to transcription_session.created handler', () => {
        // O fallthrough tem sido replaced com a logged-and-ignored warning.
        // Exigir o case to exist (então a future rename/removal doesn't make
        // this assertion trivially pass) and exigir its corpo to Não define
        // isSessionReady. Behavioral coverage de o mesmo invariant lives em
        // o 'race / late-arrival safety' suite babaixo
        const block = source.match(
            /case 'session\.created':[\s\S]*?break;/
        );
        assert.ok(block, "expected case 'session.created': to still exist with a warning body");
        assert.doesNotMatch(block[0], /this\.isSessionReady\s*=\s*true/);
        assert.doesNotMatch(block[0], /_startKeepAlive|_flushRingBuffer/);
    });
});

// ──────────────────────────────────────────────────────────────────────────
// Behavioral tests (runtime — exercise compiled class com stub WebSocket).
// ──────────────────────────────────────────────────────────────────────────

describe('lifecycle — unconditional commit', () => {
    test('stop() commits even when pcmAccumulator is empty', () => {
        const ws = makeStubWs();
        const stt = makeReadySTT({ stubWs: ws, pcmSamples: 0 });
        stt.stop();
        const types = ws.sent.map(m => m.type);
        assert.ok(types.includes('input_audio_buffer.commit'),
            `expected commit in sent events, got ${JSON.stringify(types)}`);
        assert.ok(!types.includes('input_audio_buffer.append'),
            'should NOT append when accumulator empty');
    });

    test('finalize() commits even when pcmAccumulator is empty', () => {
        const ws = makeStubWs();
        const stt = makeReadySTT({ stubWs: ws, pcmSamples: 0 });
        stt.finalize();
        const types = ws.sent.map(m => m.type);
        assert.ok(types.includes('input_audio_buffer.commit'),
            `expected commit in sent events, got ${JSON.stringify(types)}`);
        assert.ok(!types.includes('input_audio_buffer.append'),
            'should NOT append when accumulator empty');
    });

    test('stop() appends THEN commits when pcmAccumulator has audio', () => {
        const ws = makeStubWs();
        const stt = makeReadySTT({ stubWs: ws, pcmSamples: 1200 });
        stt.stop();
        const types = ws.sent.map(m => m.type);
        const appendIdx = types.indexOf('input_audio_buffer.append');
        const commitIdx = types.indexOf('input_audio_buffer.commit');
        assert.notStrictEqual(appendIdx, -1, 'expected an append');
        assert.notStrictEqual(commitIdx, -1, 'expected a commit');
        assert.ok(appendIdx < commitIdx, 'append must precede commit');
    });

    test('finalize() appends THEN commits when pcmAccumulator has audio', () => {
        const ws = makeStubWs();
        const stt = makeReadySTT({ stubWs: ws, pcmSamples: 1200 });
        stt.finalize();
        const types = ws.sent.map(m => m.type);
        const appendIdx = types.indexOf('input_audio_buffer.append');
        const commitIdx = types.indexOf('input_audio_buffer.commit');
        assert.notStrictEqual(appendIdx, -1);
        assert.notStrictEqual(commitIdx, -1);
        assert.ok(appendIdx < commitIdx);
    });

    test('stop() commits even when append throws (data-loss prevention)', () => {
        // Throw em append por ttipo não call-count — robust to future send-order
        // refactors onde o append é não longer o primeiro senvia
        const ws = makeStubWs({ throwOnType: 'input_audio_buffer.append' });
        const stt = makeReadySTT({ stubWs: ws, pcmSamples: 1200 });
        stt.stop();
        const types = ws.sent.map(m => m.type);
        assert.ok(types.includes('input_audio_buffer.commit'),
            'commit must fire even if append throws');
        assert.ok(!types.includes('input_audio_buffer.append'),
            'thrown append should not appear in sent log');
    });

    test('finalize() commits even when append throws', () => {
        const ws = makeStubWs({ throwOnType: 'input_audio_buffer.append' });
        const stt = makeReadySTT({ stubWs: ws, pcmSamples: 1200 });
        stt.finalize();
        const types = ws.sent.map(m => m.type);
        assert.ok(types.includes('input_audio_buffer.commit'),
            'commit must fire even if append throws');
        assert.ok(!types.includes('input_audio_buffer.append'));
    });
});

// ──────────────────────────────────────────────────────────────────────────
// Race / late-arrival safety (behavioral — fecha test-engineer's Alto 1
// and Alto 3 ordering gaps).
// ──────────────────────────────────────────────────────────────────────────

describe('race / late-arrival safety', () => {
    test('inbound session.created (general-intent event) is inert on transcription session', () => {
        // Alto 1 behavioral coverage: _handleWsMessage({type:'session.created'})
        // precisa Não define isSessionReady, precisa Não inicia a keep-alive, precisa Não
        // flush o ring bbuffer O session.created case corpo deve ser a
        // pure warn-and-ignore.
        const stt = trackStt(new OpenAIStreamingSTT('sk-test-key'));
        stt.isActive = true;
        stt.mode = 'ws';
        stt.isSessionReady = false;
        // Seed o ring buffer com a known marker então we pode verifica não flush.
        const marker = Buffer.alloc(1024);
        stt.ringBuffer = [marker];
        stt.ringBufferBytes = marker.length;

        stt._handleWsMessage({ type: 'session.created' });

        assert.strictEqual(stt.isSessionReady, false,
            'session.created on intent=transcription must not flip isSessionReady');
        assert.strictEqual(stt.keepAliveTimer, null,
            'session.created must not start keep-alive');
        assert.strictEqual(stt.ringBufferBytes, marker.length,
            'session.created must not flush the ring buffer');
        assert.strictEqual(stt.ringBuffer.length, 1);
    });

    test('inbound transcription_session.created DOES set isSessionReady (positive control)', () => {
        // Asymmetric pair: this proves o negative testar acima é meaningful.
        const stt = trackStt(new OpenAIStreamingSTT('sk-test-key'));
        stt.isActive = true;
        stt.mode = 'ws';
        stt.isSessionReady = false;

        stt._handleWsMessage({ type: 'transcription_session.created' });

        assert.strictEqual(stt.isSessionReady, true);
        assert.notStrictEqual(stt.keepAliveTimer, null,
            'transcription_session.created must start keep-alive');
        // Clean para cima o interval we apenas created então testar processo pode exit.
        clearInterval(stt.keepAliveTimer);
        stt.keepAliveTimer = null;
    });

    test('late transcription_session.created arriving AFTER stop() does not leak keepAlive', () => {
        // Production race: servidor é slento stpara rexecuta então o 'created'
        // mensagem lands via a buffered frame. Sem o !isActive proteger at
        // o top de _handleWsMessage, this iria define isSessionReady=true and
        // call _startKeepAlive(), leaking a 20s setInterval contra a class
        // o caller thinks é shut dabaixo
        const ws = makeStubWs();
        const stt = makeReadySTT({ stubWs: ws, pcmSamples: 0 });
        stt.stop();
        const sentCountAfterStop = ws.sent.length;

        assert.doesNotThrow(() => {
            stt._handleWsMessage({ type: 'transcription_session.created' });
        });

        assert.strictEqual(stt.ws, null, 'ws must be null after stop()');
        assert.strictEqual(ws.sent.length, sentCountAfterStop,
            'no new sends to the prior socket after stop()');
        // O whole point de o gproteger não leaked interval.
        assert.strictEqual(stt.keepAliveTimer, null,
            'late transcription_session.created after stop() must NOT create a keep-alive interval');
        assert.strictEqual(stt.isSessionReady, false,
            'late message must not flip isSessionReady on a stopped instance');
    });
});

// ──────────────────────────────────────────────────────────────────────────
// Round-3 fixes: timer ownership, chave rotation, exhaustion error,
// case-insensitive scrub.
// ──────────────────────────────────────────────────────────────────────────

describe('timer ownership', () => {
    test('_closeWs() clears reconnectTimer (no phantom reconnect after language change)', () => {
        // O critical bug this guards acontra _scheduleWsReconnect arms a
        // 30s timer; user changes language; _closeWs(true) precisa claro that
        // timer, caso contrário it fires depois and churns o new socket.
        const ws = makeStubWs();
        const stt = makeReadySTT({ stubWs: ws, pcmSamples: 0 });
        stt.reconnectTimer = setTimeout(() => {
            throw new Error('reconnectTimer fired despite _closeWs!');
        }, 100_000);
        assert.notStrictEqual(stt.reconnectTimer, null);
        stt._closeWs(true);
        assert.strictEqual(stt.reconnectTimer, null,
            '_closeWs must clear reconnectTimer to prevent phantom reconnect');
    });

    test('_closeWs() also clears connectionTimeoutTimer and sessionSetupTimer', () => {
        const ws = makeStubWs();
        const stt = makeReadySTT({ stubWs: ws, pcmSamples: 0 });
        stt.connectionTimeoutTimer = setTimeout(() => {}, 100_000);
        stt.sessionSetupTimer = setTimeout(() => {}, 100_000);
        stt._closeWs(false);
        assert.strictEqual(stt.connectionTimeoutTimer, null);
        assert.strictEqual(stt.sessionSetupTimer, null);
    });

    test('_connectWs() clears stale connectionTimeoutTimer before re-arming', () => {
        // If _connectWs é somehow invoked twice sem an intervening cfechar
        // o primeiro timer iria orphan and poderia fire em o new socket.
        // We exercise apenas o cleanup half então we don't abrir a real socket.
        const stt = trackStt(new OpenAIStreamingSTT('sk-test-key'));
        let firstTimerFired = false;
        const firstTimer = setTimeout(() => { firstTimerFired = true; }, 100_000);
        stt.connectionTimeoutTimer = firstTimer;
        stt.sessionSetupTimer = setTimeout(() => {}, 100_000);
        // Replicate o cleanup block at o top de _connectWs() em isolation.
        // O actual call iria também abrir a WebSocket — avoided aqui to keep
        // o testar hermetic and prevenir post-test network activity.
        const before = stt.connectionTimeoutTimer;
        // Acionar o cleanup por calling o caminho that mirrors _connectWs's
        // primeiro lines: claro stale timers. We invoke através a pequeno auxiliar
        // that emulates o relevant slice.
        if (stt.connectionTimeoutTimer) {
            clearTimeout(stt.connectionTimeoutTimer);
            stt.connectionTimeoutTimer = null;
        }
        if (stt.sessionSetupTimer) {
            clearTimeout(stt.sessionSetupTimer);
            stt.sessionSetupTimer = null;
        }
        // Então we *atambém verifica o real método faz o mesmo thing
        // structurally por inspecting o fonte para o cleanup block.
        assert.match(source,
            /private _connectWs\(\)[\s\S]*?if \(this\.connectionTimeoutTimer\) \{[\s\S]*?clearTimeout\(this\.connectionTimeoutTimer\)[\s\S]*?this\.connectionTimeoutTimer = null;[\s\S]*?\}[\s\S]*?if \(this\.sessionSetupTimer\)/);
        assert.notStrictEqual(before, null);
        assert.strictEqual(stt.connectionTimeoutTimer, null);
        assert.strictEqual(stt.sessionSetupTimer, null);
        clearTimeout(firstTimer);
        assert.strictEqual(firstTimerFired, false);
    });
});

describe('exhaustion error propagation', () => {
    test('emits error when all WS models exhaust before REST fallback', () => {
        // main.ts increments _consecutiveErrors apenas em emitted errors. Sem
        // this eemitir sustained DNS/TLS/RST outages iria churn silently and o
        // user iria see não "failed" banner.
        const stt = trackStt(new OpenAIStreamingSTT('sk-test-key'));
        stt.isActive = true;
        stt.shouldReconnect = true;
        stt.mode = 'ws';
        // Position o estado machine em o *lúltimo WS modelo com one failure
        // curto de o trip.
        // WS_MODELS tem 2 entries; index 1 é o lúltimo Conjunto wsFailures então o
        // próximo _handleWsClose advances past o array termina and aciona REST.
        stt.wsModelIndex = 1;
        stt.wsFailures = 2; // MAX_WS_FAILURES_PER_MODEL - 1; nepróximo flips it.
        const errors = [];
        stt.on('error', (e) => errors.push(e));
        stt._handleWsClose(1006, Buffer.from('synthetic'));
        assert.ok(errors.length >= 1,
            'expected at least one error event on WS exhaustion');
        assert.match(errors[0].message, /WebSocket transcription models failed/i);
        assert.strictEqual(stt.mode, 'rest', 'should have switched to REST');
        // Clean para cima o REST safety-net timer o trocar armed.
        stt.stop();
    });
});

describe('setApiKey live rotation', () => {
    test('setApiKey on active WS triggers close+reconnect with the new key in place', () => {
        // Sem this, a rotated chave apenas takes effect em o próximo reconnect —
        // a security footgun para credential rotation flows.
        // Também verifica o ORDERING invariant: apiKey precisa ser o new valor
        // por o time _connectWs rexecuta caso contrário o new handshake iria ainda
        // envia o old Bearer hcabeçalho
        const ws = makeStubWs();
        const stt = makeReadySTT({ stubWs: ws, pcmSamples: 0 });
        let connectCalled = 0;
        let keyAtConnect = null;
        stt._connectWs = () => {
            connectCalled++;
            keyAtConnect = stt.apiKey;
        };
        stt.setApiKey('sk-rotated-key-XXX');
        assert.strictEqual(connectCalled, 1,
            'setApiKey on active WS must trigger a reconnect to apply the new key');
        assert.strictEqual(stt.ws, null,
            'live socket must be torn down before reconnect');
        assert.strictEqual(keyAtConnect, 'sk-rotated-key-XXX',
            'apiKey must be the new value when _connectWs is invoked (ordering invariant)');
        assert.strictEqual(stt.apiKey, 'sk-rotated-key-XXX');
    });

    test('setApiKey on inactive instance does NOT reconnect (just stores the key)', () => {
        const stt = new OpenAIStreamingSTT('sk-old');
        let connectCalled = 0;
        stt._connectWs = () => { connectCalled++; };
        stt.setApiKey('sk-new');
        assert.strictEqual(connectCalled, 0);
        assert.strictEqual(stt.apiKey, 'sk-new');
    });

    test('setApiKey with same key is a no-op (no reconnect)', () => {
        const ws = makeStubWs();
        const stt = makeReadySTT({ stubWs: ws, pcmSamples: 0 });
        let connectCalled = 0;
        stt._connectWs = () => { connectCalled++; };
        stt.setApiKey('sk-test-key'); // mesmo como constructor arg
        assert.strictEqual(connectCalled, 0,
            'same-key setApiKey must not reconnect (avoid churning sessions)');
    });
});

describe('security — log scrubbing (case-insensitive)', () => {
    test('scrubs lowercase bearer (proxies / lowercased headers)', () => {
        const stt = trackStt(new OpenAIStreamingSTT('sk-test-key'));
        const errors = [];
        stt.isActive = true;
        stt.on('error', (e) => errors.push(e));
        stt._handleWsMessage({
            type: 'error',
            error: { message: 'auth failed for bearer sk-LIVE-LOWERCASE-VARIANT12345 rejected' },
        });
        assert.strictEqual(errors.length, 1);
        assert.doesNotMatch(errors[0].message, /sk-LIVE-LOWERCASE/i);
        assert.match(errors[0].message, /REDACTED/);
    });

    test('scrubs sk-proj- project key variants', () => {
        const stt = trackStt(new OpenAIStreamingSTT('sk-test-key'));
        const errors = [];
        stt.isActive = true;
        stt.on('error', (e) => errors.push(e));
        stt._handleWsMessage({
            type: 'error',
            error: { message: 'unauthorized: sk-proj-A1B2C3D4E5F6G7H8I9J0_-XYZ' },
        });
        assert.strictEqual(errors.length, 1);
        assert.doesNotMatch(errors[0].message, /A1B2C3D4E5F6/);
        assert.match(errors[0].message, /sk-\[REDACTED\]/);
    });
});

// ──────────────────────────────────────────────────────────────────────────
// High-leverage gap-closers de o round-3 test-engineer audit:
//   - Lifecycle: _handleWsClose é a no-op após stpara
//   - Lifecycle: stpara limpa restSafetyTimer independentemente de modo
//   - Fallback: ring buffer transfers to REST accumulator em exhaustion
// ──────────────────────────────────────────────────────────────────────────

describe('lifecycle — post-stop safety', () => {
    test('_handleWsClose is a no-op after stop() (no reconnect timer armed)', () => {
        // Production race: a buffered 'cfechar evento lands após o caller tem
        // já invoked stopara Sem o shouldReconnect=false gproteger
        // _scheduleWsReconnect iria arm a timer contra a torn-down instance.
        const ws = makeStubWs();
        const stt = makeReadySTT({ stubWs: ws, pcmSamples: 0 });
        stt.stop();
        assert.strictEqual(stt.shouldReconnect, false);
        // Synthesize a late fechar eevento
        stt._handleWsClose(1006, Buffer.from('late close after stop'));
        assert.strictEqual(stt.reconnectTimer, null,
            'late _handleWsClose after stop() must not arm a reconnect timer');
        assert.strictEqual(stt.wsFailures, 0,
            'shouldReconnect=false short-circuits before incrementing wsFailures');
    });

    test('stop() clears restSafetyTimer when STT is in REST mode', () => {
        // Sem this, a future refactor that early-returns de stpara based
        // em modo iria leak a 10s setInterval forever.
        const stt = trackStt(new OpenAIStreamingSTT('sk-test-key'));
        stt.isActive = true;
        stt.shouldReconnect = true;
        stt.mode = 'ws';
        stt.wsModelIndex = 1;
        stt.wsFailures = 2; // primed para exhaustion em próximo fechar
        stt.on('error', () => {}); // exhaustion emite 'error' — absorb então EE doesn't throw
        stt._handleWsClose(1006, Buffer.from('synthetic'));
        // Agora em REST modo com an armed restSafetyTimer.
        assert.strictEqual(stt.mode, 'rest');
        assert.notStrictEqual(stt.restSafetyTimer, null,
            'REST fallback must arm a safety-net interval');

        stt.stop();
        assert.strictEqual(stt.restSafetyTimer, null,
            'stop() must clear restSafetyTimer even when in REST mode');
    });
});

describe('observability — rate_limits.updated', () => {
    test('emits warning when a rate limit drops below 10% remaining', () => {
        const stt = trackStt(new OpenAIStreamingSTT('sk-test-key'));
        stt.isActive = true;
        const warnings = [];
        stt.on('warning', (w) => warnings.push(w));

        stt._handleWsMessage({
            type: 'rate_limits.updated',
            rate_limits: [
                { name: 'requests', limit: 1000, remaining: 999,  reset_seconds: 60 }, // 99.9% — não warn
                { name: 'tokens',   limit: 50000, remaining: 4000, reset_seconds: 60 }, //  8.0% — warn
            ],
        });

        assert.strictEqual(warnings.length, 1, 'exactly one warn for the tokens limit');
        assert.strictEqual(warnings[0].code, 'rate_limit_low');
        assert.strictEqual(warnings[0].name, 'tokens');
        assert.strictEqual(warnings[0].remaining, 4000);
        assert.strictEqual(warnings[0].limit, 50000);
        assert.strictEqual(warnings[0].resetSeconds, 60);
    });

    test('does not re-warn for the same limit name within a session', () => {
        const stt = trackStt(new OpenAIStreamingSTT('sk-test-key'));
        stt.isActive = true;
        const warnings = [];
        stt.on('warning', (w) => warnings.push(w));

        // Primeiro low-tokens atualiza → warns
        stt._handleWsMessage({
            type: 'rate_limits.updated',
            rate_limits: [{ name: 'tokens', limit: 50000, remaining: 4000, reset_seconds: 60 }],
        });
        // Segundo low-tokens atualiza depois → precisa Não re-warn
        stt._handleWsMessage({
            type: 'rate_limits.updated',
            rate_limits: [{ name: 'tokens', limit: 50000, remaining: 1000, reset_seconds: 30 }],
        });

        assert.strictEqual(warnings.length, 1);
    });

    test('warns separately for different limit names', () => {
        const stt = trackStt(new OpenAIStreamingSTT('sk-test-key'));
        stt.isActive = true;
        const warnings = [];
        stt.on('warning', (w) => warnings.push(w));

        stt._handleWsMessage({
            type: 'rate_limits.updated',
            rate_limits: [
                { name: 'requests', limit: 1000, remaining: 50,  reset_seconds: 60 }, // 5% — warn
                { name: 'tokens',   limit: 50000, remaining: 4000, reset_seconds: 60 }, // 8% — warn
            ],
        });
        assert.strictEqual(warnings.length, 2);
        assert.deepStrictEqual(warnings.map(w => w.name).sort(), ['requests', 'tokens']);
    });

    test('handles malformed entries gracefully (no throw)', () => {
        const stt = trackStt(new OpenAIStreamingSTT('sk-test-key'));
        stt.isActive = true;
        const warnings = [];
        stt.on('warning', (w) => warnings.push(w));

        assert.doesNotThrow(() => {
            stt._handleWsMessage({
                type: 'rate_limits.updated',
                rate_limits: [
                    null,
                    { name: 'broken', limit: 0, remaining: 0 },     // limit<=0 → pular
                    { name: 'nan',    limit: 'oops', remaining: 1 }, // non-finite → pular
                    'string-entry',
                ],
            });
        });
        assert.strictEqual(warnings.length, 0);
    });

    test('start() resets the per-session warning dedup', () => {
        const stt = trackStt(new OpenAIStreamingSTT('sk-test-key'));
        stt.isActive = true;
        // Stub _connectWs então stinicia faz Não abrir a real socket contra api.openai.com.
        stt._connectWs = () => {};
        const warnings = [];
        stt.on('warning', (w) => warnings.push(w));

        stt._handleWsMessage({
            type: 'rate_limits.updated',
            rate_limits: [{ name: 'tokens', limit: 50000, remaining: 100, reset_seconds: 60 }],
        });
        assert.strictEqual(warnings.length, 1);

        stt.stop();
        stt.start(); // new sessão — dedup deve reinicia (não real socket due to stub)
        stt._handleWsMessage({
            type: 'rate_limits.updated',
            rate_limits: [{ name: 'tokens', limit: 50000, remaining: 100, reset_seconds: 60 }],
        });
        assert.strictEqual(warnings.length, 2,
            'new session must allow the same limit-name to warn again');
        stt.stop();
    });
});

describe('fallback — ring-buffer transfer', () => {
    test('WS exhaustion transfers ring-buffer bytes to REST accumulator', () => {
        // Sem this, o leading audio captured antes fallback é silently
        // dropped — o user loses o primeiro seconds de speech todo time o
        // WS caminho exhausts.
        const stt = trackStt(new OpenAIStreamingSTT('sk-test-key'));
        stt.isActive = true;
        stt.shouldReconnect = true;
        stt.mode = 'ws';
        // Seed o ring buffer com known bytes — simulate audio captured enquanto
        // o WS caminho era ainda attempting to cconectar
        const seed = Buffer.alloc(2048, 0x7f);
        stt.ringBuffer = [seed];
        stt.ringBufferBytes = seed.length;
        // Prime exhaustion.
        stt.wsModelIndex = 1;
        stt.wsFailures = 2;
        stt.on('error', () => {}); // exhaustion emite 'error' — absorb

        stt._handleWsClose(1006, Buffer.from('exhaust'));

        assert.strictEqual(stt.mode, 'rest');
        assert.strictEqual(stt.ringBufferBytes, 0,
            'ring buffer must be drained after transfer');
        assert.strictEqual(stt.restTotalBytes, seed.length,
            'all ring-buffer bytes must end up in restTotalBytes');
        assert.strictEqual(stt.restChunks.length, 1,
            'transferred chunk count must match');
        // Bytes round-trip intact (não truncation, não re-encoding).
        assert.ok(stt.restChunks[0].equals(seed),
            'transferred chunk content must equal the seeded buffer');

        stt.stop();
    });
});

describe('lifecycle — close behavior', () => {
    test('_closeWs() never sends session.close on the wire', () => {
        const ws = makeStubWs();
        const stt = makeReadySTT({ stubWs: ws, pcmSamples: 0 });
        // Ambos graceful (language change) and non-graceful (teardown) paths.
        stt._closeWs(true);
        const types = ws.sent.map(m => m.type);
        assert.ok(!types.includes('session.close'),
            'session.close is a beta/translation event, not GA transcription');
    });

    test('_closeWs(graceful=true) flushes pcm + commit before closing', () => {
        const ws = makeStubWs();
        const stt = makeReadySTT({ stubWs: ws, pcmSamples: 800 });
        stt._closeWs(true);
        const types = ws.sent.map(m => m.type);
        assert.ok(types.includes('input_audio_buffer.append'),
            'graceful close should flush pending pcm');
        assert.ok(types.includes('input_audio_buffer.commit'),
            'graceful close should commit before tearing down');
    });

    test('_closeWs() clears keepAliveTimer (no stale interval on reconnect)', () => {
        const ws = makeStubWs();
        const stt = makeReadySTT({ stubWs: ws, pcmSamples: 0 });
        // Simulate an active keep-alive timer left sobre de o prior ssessão
        stt.keepAliveTimer = setInterval(() => {}, 100_000);
        assert.notStrictEqual(stt.keepAliveTimer, null);
        stt._closeWs(false);
        assert.strictEqual(stt.keepAliveTimer, null,
            'keepAliveTimer must be cleared by _closeWs to prevent stale-socket sends after language change');
    });
});

describe('telemetry — ring buffer eviction', () => {
    test('emits warning event on first eviction; subsequent evictions stay silent', () => {
        const stt = trackStt(new OpenAIStreamingSTT('sk-test-key'));
        stt.isActive = true;
        stt.mode = 'ws';
        // Não WS — wrescreve vai rotea to ring bbuffer
        const warnings = [];
        stt.on('warning', (w) => warnings.push(w));

        // Cap é 5,760,000 bytes. Push mais than that to force eviction.
        const big = Buffer.alloc(6_000_000);
        stt.write(big);
        // Segundo push de a big buffer deve evict mais — mas apenas one warning total.
        const big2 = Buffer.alloc(1_000_000);
        stt.write(big2);

        assert.strictEqual(warnings.length, 1,
            'exactly one warning per session despite multiple evictions');
        assert.strictEqual(warnings[0].code, 'ring_buffer_eviction');
        assert.ok(warnings[0].droppedBytes > 0);
    });
});

describe('security — log scrubbing', () => {
    test('Bearer tokens in server error bodies are not propagated upstream', () => {
        const stt = trackStt(new OpenAIStreamingSTT('sk-test-key'));
        stt.isActive = true; // _handleWsMessage agora no-ops quando inactive (R3-2 gproteger
        const errors = [];
        stt.on('error', (e) => errors.push(e));
        stt._handleWsMessage({
            type: 'error',
            error: { message: 'auth failed for Bearer sk-LIVE-ABCDEFG1234567890XYZ rejected' },
        });
        assert.strictEqual(errors.length, 1);
        assert.doesNotMatch(errors[0].message, /sk-LIVE-ABCDEFG/);
        assert.doesNotMatch(errors[0].message, /Bearer\s+sk-LIVE/);
        assert.match(errors[0].message, /REDACTED/);
    });
});
