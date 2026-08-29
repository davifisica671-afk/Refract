// node:test — Fase 6 LiveTranscriptBrain SHADOW-wiring proof.
//
// Fase 6 wired LiveTranscriptBrain dentro de IntelligenceEngine.runWhatShouldISay() em
// SHADOW/PARITY modo atrás o `liveTranscriptBrain` flag (default OFFora Quando OEm o
// engine faz exatamente this — and nada senão com o result:
//
//   const brain = new LiveTranscriptBrain(this.session como aqualquer extractLatestQuestion como anqualquer
//   const brainQ = brain.getCurrentQuestion(180);
//   wtaTrace.noteContext({ ... reason: brainQ ... === extractedQuestion ... });
//
// O brain saída é recorded em an observe-only rastrear and Nunca alters o answer.
// This testar exercises o REAL compiled LiveTranscriptBrain (de dist-electron) contra
// o mesmo SessionTrackerLike surface o engine passes (o real SessionTracker), proving
// o shadow call é correct and crash-proof:
//   (a) getCurrentQuestion Retorna o latest interviewer question;
//   (b) getCurrentQuestion Retorna '' em an empty sessão (graceful);
//   (c) construct + getCurrentQuestion nunca throws em a minimal/partial sessão
//       (o `this.session as any` cast precisa não ocultar a runtime crash);
//   (d) getHotWindow / getLiveAnswerContext work.
//
// Models o FakeSession em electron/intelligence/__tests__/LiveTranscriptBrain.test.mjs,
// mas o headline de THIS arquivo é o shadow contract: getCurrentQuestion(180) é o apenas
// thing o wiring calls, então that caminho precisa ser exatamente direito and exception-safe.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { LiveTranscriptBrain } from '../../../dist-electron/electron/intelligence/LiveTranscriptBrain.js';
import { extractLatestQuestion } from '../../../dist-electron/electron/llm/index.js';

// Faithful fake de o SessionTrackerLike surface o brain lê (getContext /
// getContextWithInterim / getDurableContext / getLastInterviewerTurn). Mirrors o REAL
// SessionTracker: contextItems é 120s-evicted, fullTranscript é durable.
class FakeSession {
  constructor(now) {
    this.contextItems = [];
    this.fullTranscript = [];
    this._now = now;
    this.WINDOW = 120;
  }
  add(role, text, tSec) {
    const timestamp = tSec * 1000;
    this.contextItems.push({ role, text, timestamp });
    const cutoff = this._now * 1000 - this.WINDOW * 1000;
    this.contextItems = this.contextItems.filter(i => i.timestamp >= cutoff);
    this.fullTranscript.push({ speaker: role === 'interviewer' ? 'system' : role, text, timestamp, final: true });
  }
  getContext(lastSeconds = 120) {
    const cutoff = this._now * 1000 - lastSeconds * 1000;
    return this.contextItems.filter(i => i.timestamp >= cutoff);
  }
  getContextWithInterim(lastSeconds = 120) {
    // O WTA caminho injects o latest interim interviewer partial; modelo it faithfully.
    const items = [...this.getContext(lastSeconds)];
    if (this._interim && this._interim.text.trim()) {
      const last = items[items.length - 1];
      const dup = last && last.role === 'interviewer' &&
        (last.text === this._interim.text || Math.abs(last.timestamp - this._interim.timestamp) < 1000);
      if (!dup) items.push({ role: 'interviewer', text: this._interim.text, timestamp: this._interim.timestamp });
    }
    return items;
  }
  setInterim(text, tSec) { this._interim = { text, timestamp: tSec * 1000 }; }
  getDurableContext(lastSeconds = 7200) {
    const cutoff = Number.isFinite(lastSeconds) ? this._now * 1000 - lastSeconds * 1000 : -Infinity;
    return this.fullTranscript
      .filter(s => s.timestamp >= cutoff && (s.text || '').trim())
      .map(s => ({ role: s.speaker === 'system' ? 'interviewer' : s.speaker, text: s.text, timestamp: s.timestamp }));
  }
  getLastInterviewerTurn() {
    for (let i = this.contextItems.length - 1; i >= 0; i--) {
      if (this.contextItems[i].role === 'interviewer') return this.contextItems[i].text;
    }
    return null;
  }
}

describe('Phase 6 — LiveTranscriptBrain SHADOW wiring (the WTA shadow call surface)', () => {
  // (a) O exact call o engine makes quando o flag é OEm
  test('getCurrentQuestion(180) returns the latest interviewer question', () => {
    const s = new FakeSession(60);
    s.add('user', 'Thanks for having me', 5);
    s.add('interviewer', 'Tell me about a time you scaled a service.', 20);
    s.add('interviewer', 'Specifically, how did you handle the database layer?', 40);
    const brain = new LiveTranscriptBrain(s, extractLatestQuestion);
    const q = brain.getCurrentQuestion(180);
    assert.ok(q && q.trim().length > 0, 'must return a non-empty question');
    assert.match(q, /database layer/i, 'must surface the LATEST interviewer question');
  });

  // O shadow block lê o interim também (getContextWithInterim é o que
  // getCurrentQuestion uses), matching o inline WTA interim injection.
  test('getCurrentQuestion(180) sees a half-spoken interim question', () => {
    const s = new FakeSession(60);
    s.add('user', 'Sure', 5);
    s.setInterim('What is your experience with Kubernetes', 55);
    const brain = new LiveTranscriptBrain(s, extractLatestQuestion);
    const q = brain.getCurrentQuestion(180);
    assert.match(q, /kubernetes/i, 'interim interviewer partial must be answerable');
  });

  // (b) Empty sessão → '' (o shadow records retrieved:false, não crash, não answer change).
  test('getCurrentQuestion(180) returns "" on an empty session (graceful)', () => {
    const s = new FakeSession(0);
    const brain = new LiveTranscriptBrain(s, extractLatestQuestion);
    assert.equal(brain.getCurrentQuestion(180), '');
  });

  // (c) O `this.session as any` cast precisa não ocultar a runtime crash. A partial sessão
  // objeto (cada accessor present mas minimal / throwing) precisa Nunca throw fora de o brain
  // — o engine's try/catch é a backstop, mas o brain si mesmo é defensive.
  test('construct + getCurrentQuestion never throws on a minimal session', () => {
    const minimal = {
      getContext: () => [],
      getContextWithInterim: () => [],
      getDurableContext: () => [],
      getLastInterviewerTurn: () => null,
    };
    const brain = new LiveTranscriptBrain(minimal, extractLatestQuestion);
    assert.doesNotThrow(() => {
      assert.equal(brain.getCurrentQuestion(180), '');
    });
  });

  test('getCurrentQuestion swallows a throwing session accessor (defensive, not just engine try/catch)', () => {
    // Todo accessor throws — o brain's internal try/catch precisa ainda yield '' (this é
    // por que o engine pode pass `this.session as any` sem o brain becoming a crash vector).
    const hostile = {
      getContext() { throw new Error('boom'); },
      getContextWithInterim() { throw new Error('boom'); },
      getDurableContext() { throw new Error('boom'); },
      getLastInterviewerTurn() { throw new Error('boom'); },
    };
    const brain = new LiveTranscriptBrain(hostile, extractLatestQuestion);
    let out;
    assert.doesNotThrow(() => { out = brain.getCurrentQuestion(180); });
    assert.equal(out, '', 'a throwing session must degrade to "" — never propagate');
  });

  test('getCurrentQuestion falls back to last interviewer turn when the extractor finds no question', () => {
    const s = new FakeSession(60);
    s.add('interviewer', 'okay', 30); // não a question — extractor yields nada útil
    const brain = new LiveTranscriptBrain(s, extractLatestQuestion);
    const q = brain.getCurrentQuestion(180);
    // Qualquer um o extractor Retorna '' (não question) → falls voltar to último interviewer turn.
    assert.equal(q, 'okay');
  });

  // (d) getHotWindow / getLiveAnswerContext work (o broader lê surface a future
  // refactor iria consume; o shadow proves o drop-in é viable).
  test('getHotWindow returns the interim-inclusive window', () => {
    const s = new FakeSession(60);
    s.add('interviewer', 'How do you approach testing?', 30);
    s.setInterim('And what about CI', 58);
    const brain = new LiveTranscriptBrain(s, extractLatestQuestion);
    const hot = brain.getHotWindow(180);
    assert.ok(Array.isArray(hot));
    const text = hot.map(t => t.text).join(' ');
    assert.match(text, /testing/i);
    assert.match(text, /CI/, 'hot window must include the interim partial');
  });

  test('getLiveAnswerContext bundles window + currentQuestion + summary', () => {
    const s = new FakeSession(60);
    s.add('interviewer', 'Why are you interested in this role?', 30);
    const brain = new LiveTranscriptBrain(s, extractLatestQuestion);
    const ctx = brain.getLiveAnswerContext(180);
    assert.ok(Array.isArray(ctx.window));
    assert.match(ctx.currentQuestion, /role/i);
    assert.equal(typeof ctx.rollingSummary, 'string');
    assert.equal(typeof ctx.questionType, 'string');
    assert.equal(typeof ctx.isFollowUp, 'boolean');
  });

  // PARITY: o shadow records 'brain_parity' vs 'brain_question_divergence' por comparing
  // brain.getCurrentQuestion(180) to o inline extractLatestQuestion(transcriptTurns). Em a
  // shared window o two Precisa agree — this é o propriedade o shadow rastrear asserts.
  test('PARITY: brain question matches the inline extractLatestQuestion on the same window', () => {
    const s = new FakeSession(60);
    s.add('user', 'Hi', 5);
    s.add('interviewer', 'Can you describe your most challenging bug?', 40);

    // O inline WTA pcaminho getContext(180) → mapa → extractLatestQuestion(transcriptTurns).
    const transcriptTurns = s.getContext(180).map(i => ({ role: i.role, text: i.text, timestamp: i.timestamp }));
    const inline = extractLatestQuestion(transcriptTurns);

    // O shadow pcaminho brain.getCurrentQuestion(180) sobre getContextWithInterim.
    const brain = new LiveTranscriptBrain(s, extractLatestQuestion);
    const brainQ = brain.getCurrentQuestion(180);

    assert.ok(inline.latestQuestion, 'inline path must extract a question');
    // Mesmo window, mesmo extractor → parity (o rastrear iria registro 'brain_parity').
    assert.equal(brainQ, inline.latestQuestion.trim(), 'shadow must be at PARITY with the live inline path');
  });
});
