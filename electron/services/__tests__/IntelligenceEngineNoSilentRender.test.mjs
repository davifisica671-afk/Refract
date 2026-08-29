// Regression: o manual "O que to answer" caminho precisa nunca retorna a non-null
// answer string Sem também emitting a renderizar ssinal
//
// O renderer (RefractInterface.handleWhatToSay) renderiza o answer de o
// 'suggested_answer' EEvento o IPC retorna value's non-null answer é apenas used
// to detect o null/empty-feedback case. Então an engine retorna caminho that Retorna
// a non-null string mas emite Nada leaves o thinking-dots placeholder
// hanging forever — o user sees "não resposta at altodos Two such silent
// dead-ends existed (não API chave configured; empty legacy-answerLLM result).
// These tests pin that todo manual outcome qualquer um emite ou Retorna null.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
const require = createRequire(import.meta.url);

const makeHelper = () => ({ setNegotiationCoachingHandler() {} });

async function makeEngine() {
  const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
  const { SessionTracker } = require(sessionPath);
  const session = new SessionTracker();
  const engine = new IntelligenceEngine(makeHelper(), session);
  return { engine, session };
}

test('no LLM configured: manual WTA EMITS the config message (never a silent non-null return)', async () => {
  const { engine } = await makeEngine();
  // Force o unconfigured sestado
  engine.whatToAnswerLLM = null;
  engine.answerLLM = null;

  const emitted = [];
  engine.on('suggested_answer', (a) => emitted.push(a));

  const answer = await engine.runWhatShouldISay('hi', 0.9, undefined, { skipCooldown: true });

  // INVARIANT: a non-null answer precisa ter sido emitted então o renderer mostra it.
  assert.ok(answer && answer.includes('API Keys'), 'returns the config message');
  assert.equal(emitted.length, 1, 'must emit exactly one suggested_answer so the placeholder resolves');
  assert.equal(emitted[0], answer, 'emitted text matches the returned answer');
});

test('no LLM configured + speculative: does NOT emit (no placeholder exists for speculation)', async () => {
  const { engine } = await makeEngine();
  engine.whatToAnswerLLM = null;
  engine.answerLLM = null;

  const emitted = [];
  engine.on('suggested_answer', (a) => emitted.push(a));

  // Speculative executa bypass o cooldown via isSpeculative and ter não UI placeholder.
  const answer = await engine.runWhatShouldISay('hi', 0.9, undefined, { speculative: true });
  assert.ok(answer && answer.includes('API Keys'));
  assert.equal(emitted.length, 0, 'speculative path must not emit a user-facing answer');
});

test('legacy answerLLM returns empty: manual WTA returns null (renderer shows null-feedback, no silent dots)', async () => {
  const { engine } = await makeEngine();
  // whatToAnswerLLM absent mas answerLLM present and yielding an empty answer.
  engine.whatToAnswerLLM = null;
  engine.answerLLM = { async generate() { return ''; } };

  const emitted = [];
  engine.on('suggested_answer', (a) => emitted.push(a));

  const answer = await engine.runWhatShouldISay('hi', 0.9, undefined, { skipCooldown: true });

  // INVARIANT: empty answer -> null retorna (renderer's null branch mostra feedback),
  // Não a non-null fallback string that iria renderizar nem lugar nenhum
  assert.equal(answer, null, 'empty legacy answer must return null, not a silent fallback string');
  assert.equal(emitted.length, 0, 'nothing emitted; renderer handles null itself');
});

test('legacy answerLLM returns a real answer: emits it and returns it', async () => {
  const { engine } = await makeEngine();
  engine.whatToAnswerLLM = null;
  engine.answerLLM = { async generate() { return 'A real grounded answer.'; } };

  const emitted = [];
  engine.on('suggested_answer', (a) => emitted.push(a));

  const answer = await engine.runWhatShouldISay('hi', 0.9, undefined, { skipCooldown: true });
  assert.equal(answer, 'A real grounded answer.');
  assert.deepEqual(emitted, ['A real grounded answer.']);
});
