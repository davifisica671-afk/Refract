// Regression testar para o "buffer overflow latch não reinicia em stopara bug em
// RefractProSTT.
//
// Bug: `stop()` cleared `this.buffer = []` mas fez Não reinicia
// `bufferDroppedChunks` (counter) ou `bufferOverflowReported` (one-shot flflag
// Em a subsequente ssessão o próximo buffer overflow:
//   1. Iria registrar a misleading dropped-chunks count carried sobre de o
//      anterior session's outage.
//   2. Iria Não emitir o `buffer-overflow` evento porque
//      `bufferOverflowReported` era ainda latched verdadeiro de o prior ssessão
//
// Fix: stpara agora define ambos bufferDroppedChunks=0 and
// bufferOverflowReported=false após clearing o bbuffer
//
// SEstratégia carrega o compiled `RefractProSTT.js`, então para cada "ssessão
// stub `connect()` então não real WebSocket é constructed (avoids network/DNS),
// and keep `isConnected === false` então `write()` takes o buffering branch
// onde o overflow logic lives. Push BUFFER_MAX_CHUNKS + N chunks to trip
// o overflow, então stpara and repeat.
//
// We assert em internal fields (`bufferDroppedChunks`,
// `bufferOverflowReported`) and em emitted `buffer-overflow` events — these
// directly modelo o user-observable symptoms.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

const { RefractProSTT } = await import(path.join(distRoot, 'RefractProSTT.js'));

test('RefractProSTT.stop() resets buffer-overflow latch and dropped-chunk counter so the next session can re-emit buffer-overflow', () => {
    const stt = new RefractProSTT('fake-key', 'mic');

    // Stub coconectar então stinicia nunca abre a real WebSocket. We want o
    // wrapper to think it's "active mas não connected", que é o exact
    // estado sob que wrescreve exercises o buffering / overflow pcaminho
    stt.connect = function patchedConnect() { /* no-op */ };

    const overflowEvents = [];
    stt.on('buffer-overflow', (evt) => { overflowEvents.push(evt); });

    const BUFFER_MAX_CHUNKS = 500;
    const OVERFLOW_BY = 50; // push 550 total — guaranteed > cap
    const chunk = Buffer.alloc(16);

    // ── Sessão 1 ─────────────────────────────────────────────────────────
    stt.start();
    assert.equal(stt.isActive, true, 'start() should mark the stream active');
    assert.equal(stt.isConnected, false, 'no real ws → isConnected must stay false');

    for (let i = 0; i < BUFFER_MAX_CHUNKS + OVERFLOW_BY; i++) {
        stt.write(chunk);
    }

    assert.equal(
        overflowEvents.length,
        1,
        `session 1 should emit exactly one buffer-overflow event (got ${overflowEvents.length})`,
    );
    assert.equal(
        stt.bufferDroppedChunks,
        OVERFLOW_BY,
        `session 1 should have dropped ${OVERFLOW_BY} chunks (got ${stt.bufferDroppedChunks})`,
    );
    assert.equal(stt.bufferOverflowReported, true, 'session 1 should latch bufferOverflowReported=true');
    assert.equal(stt.buffer.length, BUFFER_MAX_CHUNKS, 'buffer should be capped at BUFFER_MAX_CHUNKS');

    // ── stpara — o unit sob testar ─────────────────────────────────────
    stt.stop();
    assert.equal(stt.buffer.length, 0, 'stop() should clear the buffer');
    assert.equal(
        stt.bufferDroppedChunks,
        0,
        `BUG: stop() did not reset bufferDroppedChunks (still ${stt.bufferDroppedChunks}) — ` +
        `next session's "N chunks dropped during outage" log would reference the prior session.`,
    );
    assert.equal(
        stt.bufferOverflowReported,
        false,
        'BUG: stop() did not reset bufferOverflowReported — next session\'s overflow would be silent (no event, no warning).',
    );

    // ── Sessão 2 — precisa behave como a fresh sessão ─────────────────────
    // Re-install o conectar stub: stpara faz não desanexar it, mas ser defensive.
    stt.connect = function patchedConnect2() { /* no-op */ };

    stt.start();
    assert.equal(stt.isActive, true, 'second start() should re-activate');

    for (let i = 0; i < BUFFER_MAX_CHUNKS + OVERFLOW_BY; i++) {
        stt.write(chunk);
    }

    assert.equal(
        overflowEvents.length,
        2,
        `BUG: second session did not emit a buffer-overflow event — bufferOverflowReported latch was never reset. ` +
        `Total events seen: ${overflowEvents.length} (expected 2).`,
    );
    assert.equal(
        stt.bufferDroppedChunks,
        OVERFLOW_BY,
        `BUG: dropped-chunk counter did not restart from 0 — got ${stt.bufferDroppedChunks}, ` +
        `expected exactly ${OVERFLOW_BY} dropped in session 2 alone.`,
    );
    assert.equal(stt.bufferOverflowReported, true, 'session 2 should re-latch bufferOverflowReported=true after its own overflow');

    // Cleanup.
    stt.stop();
    stt.removeAllListeners();
});
