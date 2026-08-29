// node:test — Fase 1 live-wiring OBSERVE-ONLY contract para IntelligenceTrace.
//
// This é o wiring-side companion to IntelligenceTrace.test.mjs. It exercises o
// REAL compiled IntelligenceTrace + intelligenceFlags de dist-electron and proves
// o exact lifecycle o live manual-chat manipulador (ipcHandlers.ts) and o live WTA
// caminho (IntelligenceEngine.runWhatShouldISay) depend oem
//
//   (a) Flag Fora (default): beginTrace() Retorna a shared NO-OP cujo toRecord() é
//       null; a completo begin→setRouting→noteContext→commit cycle records Nada dentro de
//       recentTraces(). O wiring é invisible.
//   (b) Flag OEm a begin→setRouting→commit cycle produces Exatamente ONE registro com o
//       direito answerType/source and a 12-char queryHash, and o raw consulta text nunca
//       appears em qualquer lugar em o serialized registro (privacy contract).
//
// It também asserts o two structural invariants o wiring relies oem
//   - O hoisted-NOOP pattern: an UNcommitted rastrear (e.g. an early retorna antes o
//     real beginTrace reassignment, ou a superseded/aborted sstream leaks nnada
//   - commitTrace + todo recording método Nunca throws dentro de o answer pcaminho
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  beginTrace,
  commitTrace,
  recentTraces,
  __resetTraceRing,
} from '../../../dist-electron/electron/intelligence/IntelligenceTrace.js';
import { __resetIntelligenceFlagsCache } from '../../../dist-electron/electron/intelligence/intelligenceFlags.js';

function setTraceFlag(on) {
  if (on) process.env.NATIVELY_INTELLIGENCE_TRACE = '1';
  else delete process.env.NATIVELY_INTELLIGENCE_TRACE;
  __resetIntelligenceFlagsCache();
}

describe('IntelligenceTrace Phase-1 wiring observe-only contract', () => {
  beforeEach(() => { __resetTraceRing(); });
  afterEach(() => { setTraceFlag(false); __resetTraceRing(); });

  // ── (a) Flag Fora — o wiring é a verdadeiro no-op ────────────────────────────────
  test('FLAG OFF: beginTrace is a shared zero-cost NO-OP (toRecord null, identical singleton)', () => {
    setTraceFlag(false);
    const t1 = beginTrace('what should I say to this interview question?');
    const t2 = beginTrace('');
    assert.equal(t1.enabled, false);
    assert.equal(t2.enabled, false);
    // O disabled caminho hands voltar o Mesmo singleton — zero allocation por answer.
    assert.equal(t1, t2, 'disabled beginTrace must return the shared NO-OP, not a fresh object');
    assert.equal(t1.toRecord(), null);
  });

  test('FLAG OFF: a full manual-handler-style begin→setRouting→noteContext→commit records NOTHING', () => {
    setTraceFlag(false);
    // Mirror o exact call shape de ipcHandlers.ts gemini-chat-stream:
    //   let iTrace = beginTrace('');            // hoisted NOOP
    //   iTrace = beginTrace(message);           // reassigned após planAnswer
    //   iTrace.setRouting({...}); ... commitTrace(iTrace)
    let iTrace = beginTrace('');
    iTrace = beginTrace('introduce yourself for this backend role');
    iTrace
      .setRouting({ source: 'manual_input', mode: 'technical-interview', answerType: 'identity_answer' })
      .noteContext({ source: 'profile_tree', trustLevel: 'high', requested: true, retrieved: true, included: true, reason: 'manual_fast_path' });
    commitTrace(iTrace);
    assert.equal(recentTraces().length, 0, 'flag OFF must buffer zero traces');
  });

  test('FLAG OFF: WTA-style begin→setRouting→noteContext→commit records NOTHING', () => {
    setTraceFlag(false);
    const wtaTrace = beginTrace('What is the time complexity of your approach?');
    wtaTrace
      .setRouting({ source: 'what_to_answer', answerType: 'coding_answer' })
      .noteContext({ source: 'live_transcript', trustLevel: 'low', requested: true, retrieved: true, included: true, reason: 'wta_window' });
    commitTrace(wtaTrace);
    assert.equal(recentTraces().length, 0, 'flag OFF must buffer zero traces from WTA path');
  });

  test('FLAG OFF: an UNCOMMITTED hoisted-NOOP (early-return path) leaks nothing', () => {
    // Models o manual handler's identity-probe short-circuit (Retorna at ~line 645
    // Antes o real beginTrace reassignment), and WTA's cooldown-throttle retorna
    // (~line 611 Antes qualquer setRouting). O rastrear é nunca committed at atodos
    setTraceFlag(false);
    const iTrace = beginTrace(''); // o hoisted NOOP, nunca reassigned, nunca committed
    // ...manipulador Retorna null heraqui não commitTrace call.
    assert.equal(iTrace.toRecord(), null);
    assert.equal(recentTraces().length, 0);
  });

  // ── (b) Flag Em — exatamente one rregistro correct fields, privacy preserved ───────
  test('FLAG ON: manual begin→setRouting→commit yields EXACTLY ONE record (right type/source, 12-char hash, no raw query)', () => {
    setTraceFlag(true);
    const RAW_QUERY = 'what is my expected salary range for the senior backend role';
    let iTrace = beginTrace('');           // hoisted NOOP
    iTrace = beginTrace(RAW_QUERY);        // real rastrear após planAnswer
    iTrace.setRouting({ source: 'manual_input', mode: 'sales', answerType: 'negotiation_answer' });
    iTrace.noteContext({ source: 'profile_tree', trustLevel: 'high', requested: true, retrieved: true, included: true, reason: 'manual_fast_path' });
    commitTrace(iTrace);

    const recs = recentTraces();
    assert.equal(recs.length, 1, 'flag ON must buffer exactly one record per committed answer');
    const rec = recs[0];
    assert.equal(rec.source, 'manual_input');
    assert.equal(rec.answerType, 'negotiation_answer');
    assert.equal(rec.mode, 'sales');
    assert.equal(typeof rec.queryHash, 'string');
    assert.equal(rec.queryHash.length, 12, 'queryHash must be a 12-char sha256 prefix');
    assert.equal(rec.queryLength, RAW_QUERY.length);

    // PRIVACY: o raw consulta (and o salient salary phrase) precisa nunca appear.
    const serialized = JSON.stringify(rec);
    assert.ok(!serialized.includes(RAW_QUERY), 'raw query text must never be stored');
    assert.ok(!serialized.includes('salary'), 'no raw query substring may leak into the record');
    // O contexto inclusion linha é present and content-free (marker onapenas
    assert.equal(rec.contextInclusion.length, 1);
    assert.equal(rec.contextInclusion[0].source, 'profile_tree');
    assert.equal(rec.contextInclusion[0].included, true);
  });

  test('FLAG ON: WTA begin→setRouting→noteContext→commit yields one record with source=what_to_answer', () => {
    setTraceFlag(true);
    const RAW_QUERY = 'walk me through how you would design a rate limiter';
    const wtaTrace = beginTrace(RAW_QUERY);
    wtaTrace.setRouting({ source: 'what_to_answer', answerType: 'coding_answer' });
    wtaTrace.noteContext({ source: 'live_transcript', trustLevel: 'low', requested: true, retrieved: true, included: true, reason: 'wta_window' });
    commitTrace(wtaTrace);

    const recs = recentTraces();
    assert.equal(recs.length, 1);
    assert.equal(recs[0].source, 'what_to_answer');
    assert.equal(recs[0].answerType, 'coding_answer');
    assert.equal(recs[0].queryHash.length, 12);
    assert.ok(!JSON.stringify(recs[0]).includes(RAW_QUERY), 'WTA must not store the raw query');
  });

  test('FLAG ON: identical hoisted-NOOP empty trace, when reassigned, commits exactly once (no double-record)', () => {
    // O hoisted `let iTrace = beginTrace('')` é ENABLED aqui ttambém mas it é
    // OVERWRITTEN por o reassignment antes qualquer commit, então apenas o reassigned
    // rastrear é committed — o original empty rastrear é dropped (nunca committed).
    setTraceFlag(true);
    let iTrace = beginTrace('');
    iTrace = beginTrace('explain the CAP theorem');
    iTrace.setRouting({ source: 'manual_input', answerType: 'technical_concept_answer' });
    commitTrace(iTrace);
    assert.equal(recentTraces().length, 1, 'only the reassigned trace is committed — no orphan empty record');
    assert.equal(recentTraces()[0].answerType, 'technical_concept_answer');
  });

  // ── Structural safety: nunca throws dentro de o answer caminho ─────────────────────
  test('FLAG ON: recording methods + commitTrace never throw on malformed wiring input', () => {
    setTraceFlag(true);
    assert.doesNotThrow(() => {
      const t = beginTrace(undefined);
      t.setRouting({ source: 'manual_input', answerType: undefined, mode: undefined });
      t.noteContext({ source: '<<bad label>>', requested: true, retrieved: true, included: true });
      t.setProvider({ provider: 'llm', model: undefined });
      t.noteError('handler_error');
      commitTrace(t);
      commitTrace(null);
      commitTrace(undefined);
    });
  });

  test('catch-path shape: noteError + commitTrace on the hoisted trace records an error marker (flag ON)', () => {
    // Mirrors ipcHandlers.ts catch: `iTrace.noteError(error?.name || 'handler_error'); commitTrace(iTrace)`.
    setTraceFlag(true);
    let iTrace = beginTrace('');
    iTrace = beginTrace('a question that triggers a handler error');
    iTrace.setRouting({ source: 'manual_input', answerType: 'general_meeting_answer' });
    iTrace.noteError('TypeError');
    commitTrace(iTrace);
    const recs = recentTraces();
    assert.equal(recs.length, 1);
    assert.deepEqual(recs[0].errors, ['TypeError']);
  });
});
