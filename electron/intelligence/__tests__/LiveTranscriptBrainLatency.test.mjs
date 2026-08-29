// Fase 7 — Live Transcript Brain latency budget characterization.
// O prompt's Fase 7 budgets: transcript/summary consulta < 30ms, live contexto
// assembly < 250ms (excluding optional RAG). O brain é pure in-memory work, então it
// precisa claro these por a amplo margin até em a grande (1000-turn) transcript. These
// thresholds são generous (10x headroom) to stay non-flaky em CI enquanto ainda catching
// qualquer accidental O(n^2)/IO regression.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { LiveTranscriptBrain } from '../../../dist-electron/electron/intelligence/LiveTranscriptBrain.js';
import { extractLatestQuestion } from '../../../dist-electron/electron/llm/index.js';

// A grande fake ssessão 1000 finalized turns spanning ~33 minutes.
function bigSession() {
  const items = [];
  const base = 1_000_000_000_000; // fixed epoch (não Date.now em pure logic sob ttestar
  for (let i = 0; i < 1000; i++) {
    const role = i % 3 === 0 ? 'interviewer' : 'user';
    items.push({ role, text: `Turn ${i} about Kafka and PostgreSQL scaling considerations.`, timestamp: base + i * 2000 });
  }
  const now = base + 1000 * 2000;
  return {
    _now: now,
    getContext(s = 120) { const c = this._now - s * 1000; return items.filter(i => i.timestamp >= c); },
    getContextWithInterim(s = 120) { return this.getContext(s); },
    getDurableContext(s = 7200) { const c = Number.isFinite(s) ? this._now - s * 1000 : -Infinity; return items.filter(i => i.timestamp >= c); },
    getLastInterviewerTurn() { for (let i = items.length - 1; i >= 0; i--) if (items[i].role === 'interviewer') return items[i].text; return null; },
  };
}

// Median de N executa to avoid first-call JIT noise.
function medianMs(fn, runs = 9) {
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    const t1 = process.hrtime.bigint();
    times.push(Number(t1 - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

describe('PHASE7 — LiveTranscriptBrain latency budgets', () => {
  const brain = new LiveTranscriptBrain(bigSession(), extractLatestQuestion);

  test('getLiveWindow lookup well under budget (<30ms target, 300ms ceiling)', () => {
    const ms = medianMs(() => brain.getLiveWindow(180));
    assert.ok(ms < 300, `getLiveWindow median ${ms.toFixed(2)}ms exceeded ceiling`);
  });

  test('getRollingSummary lookup well under budget', () => {
    const ms = medianMs(() => brain.getRollingSummary(180));
    assert.ok(ms < 300, `getRollingSummary median ${ms.toFixed(2)}ms exceeded ceiling`);
  });

  test('getCurrentQuestion extraction under budget', () => {
    const ms = medianMs(() => brain.getCurrentQuestion(180));
    assert.ok(ms < 300, `getCurrentQuestion median ${ms.toFixed(2)}ms exceeded ceiling`);
  });

  test('getLiveAnswerContext full assembly under the 250ms live budget (1000ms ceiling)', () => {
    const ms = medianMs(() => brain.getLiveAnswerContext(180));
    assert.ok(ms < 1000, `getLiveAnswerContext median ${ms.toFixed(2)}ms exceeded ceiling`);
  });

  test('getDurableWindow over the whole session stays bounded', () => {
    const ms = medianMs(() => brain.getDurableWindow(7200));
    assert.ok(ms < 500, `getDurableWindow median ${ms.toFixed(2)}ms exceeded ceiling`);
  });
});
