// electron/services/__tests__/ModeRagFallbackTelemetry.test.mjs
//
// Regression para FIX-007: quando o retriever falls voltar to lexical-only
// (embedding provedor unavailable, hybrid caminho throws, ou DB unavailable),
// it precisa emitir a `rag_lexical_fallback` telemetry evento em addition to o
// existing console.warn. O evento precisa ser throttled (≤1 por (modeId,
// reason) por 60s) então a 1-hour meeting can't produce thousands de identical
// registrar lines.
//
// We observe o JSONL registrar o bundled instance actually escreve (cada
// dist-electron entry-point tem its próprio bundled telemetry singleton —
// stubbing o standalone one doesn't reach o retriever's bundle). To
// avoid cross-test interference we define REFRACT_TELEMETRY_TEST_RUN_ID
// antes importing o bundle; o retriever stamps that id para todo
// fallback evento and o testar filtra por it.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Stamp this executa Antes importing o bundled retriever então o env-var lê
// dentro o bundle sees o id.
const RUN_ID = `test-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
process.env.REFRACT_TELEMETRY_TEST_RUN_ID = RUN_ID;

const hybridMod = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/services/modes/ModeHybridRetriever.js')).href
);
const { ModeHybridRetriever } = hybridMod;

const TELEMETRY_LOG = path.join(process.cwd(), 'logs', 'telemetry.jsonl');

function readNewLines(startOffset) {
  if (!fs.existsSync(TELEMETRY_LOG)) return [];
  const buf = fs.readFileSync(TELEMETRY_LOG);
  if (buf.length <= startOffset) return [];
  return buf
    .subarray(startOffset)
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function fallbackEventsSinceOffset(startOffset) {
  return readNewLines(startOffset).filter(e =>
    e?.name === 'rag_lexical_fallback' && e?.properties?.testRunId === RUN_ID
  );
}

let logOffset = 0;
beforeEach(() => {
  logOffset = fs.existsSync(TELEMETRY_LOG) ? fs.statSync(TELEMETRY_LOG).size : 0;
  // Reinicia o static throttle cache entre tests então cada testar inicia clean.
  ModeHybridRetriever.__resetFallbackThrottleForTests();
});

function makeRetriever({ embeddingReady = false, throwOnEmbed = false } = {}) {
  const db = {
    exec: () => {},
    prepare: () => ({ get: () => null, run: () => {}, all: () => [] }),
  };
  const vectorStore = {};
  const embeddingPipeline = {
    isReady: () => embeddingReady,
    getEmbedding: async () => { if (throwOnEmbed) throw new Error('synthetic embedding failure'); return [0, 0, 0]; },
    getEmbeddingForQuery: async () => { if (throwOnEmbed) throw new Error('synthetic query embedding failure'); return [0, 0, 0]; },
  };
  return new ModeHybridRetriever(db, vectorStore, embeddingPipeline);
}

const FILES = [
  {
    id: 'ref_1',
    modeId: 'mode_x',
    fileName: 'doc.md',
    content: 'Sarah owns the launch checklist and must deliver it by Friday.',
    createdAt: '2026-05-15T00:00:00.000Z',
  },
];

describe('FIX-007: Lexical-fallback telemetry', () => {
  test("emits 'rag_lexical_fallback' with reason=embedding_unavailable when provider not ready", async () => {
    const retriever = makeRetriever({ embeddingReady: false });
    await retriever.retrieve({
      query: 'who owns the launch checklist',
      modeId: 'mode_x',
      files: FILES,
    });
    const events = fallbackEventsSinceOffset(logOffset);
    assert.equal(events.length, 1);
    assert.equal(events[0].modeId, 'mode_x');
    assert.equal(events[0].properties.reason, 'embedding_unavailable');
    assert.equal(typeof events[0].properties.candidateCount, 'number');
    assert.equal(typeof events[0].properties.queryTokenCount, 'number');
  });

  test("emits 'rag_lexical_fallback' with reason=hybrid_threw when embedding pipeline throws", async () => {
    const retriever = makeRetriever({ embeddingReady: true, throwOnEmbed: true });
    await retriever.retrieve({
      query: 'who owns the launch checklist',
      modeId: 'mode_x',
      files: FILES,
    });
    const events = fallbackEventsSinceOffset(logOffset);
    assert.equal(events.length, 1);
    assert.equal(events[0].properties.reason, 'hybrid_threw');
    assert.equal(typeof events[0].properties.errorClass, 'string');
  });

  test('does not emit fallback telemetry on the happy path', async () => {
    const retriever = makeRetriever({ embeddingReady: true, throwOnEmbed: false });
    await retriever.retrieve({
      query: 'who owns the launch checklist',
      modeId: 'mode_x',
      files: FILES,
    });
    const events = fallbackEventsSinceOffset(logOffset);
    assert.equal(events.length, 0);
  });

  test('throttle: 100 rapid fallback calls emit at most 1 event per (modeId, reason)', async () => {
    const retriever = makeRetriever({ embeddingReady: false });
    for (let i = 0; i < 100; i++) {
      await retriever.retrieve({
        query: 'who owns the launch checklist',
        modeId: 'mode_x',
        files: FILES,
      });
    }
    const events = fallbackEventsSinceOffset(logOffset);
    assert.equal(events.length, 1, `Throttle must collapse 100 calls into 1 event. Got ${events.length}.`);
  });

  test('static helper: db_unavailable path is throttled the same way', () => {
    const before = fs.existsSync(TELEMETRY_LOG) ? fs.statSync(TELEMETRY_LOG).size : 0;
    for (let i = 0; i < 50; i++) {
      ModeHybridRetriever.emitFallbackTelemetryStatic({
        reason: 'db_unavailable',
        modeId: 'mode_db_throttle',
      });
    }
    const events = readNewLines(before).filter(
      e => e?.name === 'rag_lexical_fallback' &&
           e?.properties?.testRunId === RUN_ID &&
           e?.modeId === 'mode_db_throttle' &&
           e?.properties?.reason === 'db_unavailable'
    );
    assert.equal(events.length, 1, `db_unavailable static emitter must throttle. Got ${events.length} events for 50 calls.`);
  });

  test('throttle keys on (modeId, reason): different modeIds emit independently', async () => {
    const retriever = makeRetriever({ embeddingReady: false });
    for (const id of ['mode_a', 'mode_b', 'mode_a', 'mode_b']) {
      await retriever.retrieve({ query: 'who owns', modeId: id, files: FILES });
    }
    const events = fallbackEventsSinceOffset(logOffset);
    assert.equal(events.length, 2, 'Throttle must allow one event per distinct modeId');
    const modeIds = new Set(events.map(e => e.modeId));
    assert.deepEqual([...modeIds].sort(), ['mode_a', 'mode_b']);
  });

  test('telemetry payload carries no raw query / chunk / transcript content (redaction guard)', async () => {
    const retriever = makeRetriever({ embeddingReady: false });
    await retriever.retrieve({
      query: 'secret-customer-Acme target $185k base salary BATNA',
      modeId: 'mode_x',
      files: FILES,
    });
    const events = fallbackEventsSinceOffset(logOffset);
    assert.equal(events.length, 1);
    const serialized = JSON.stringify(events[0]);
    assert.ok(!serialized.includes('Acme'), `Telemetry must not carry customer name. Got:\n${serialized}`);
    assert.ok(!serialized.includes('BATNA'), 'Telemetry must not carry negotiation context');
    assert.ok(!serialized.includes('Sarah'), 'Telemetry must not carry chunk content');
  });

  test('redaction: extended SENSITIVE_KEY_RE drops query / chunk / userInput / errorMessage values', async () => {
    // We exercise TelemetryService directly to confirm o regex changes.
    // We fazer Não uso o bundled instance aqui porque o assertion é em
    // o redactor isi mesmo não o retriever pcaminho
    const tmod = await import(
      pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/services/telemetry/TelemetryService.js')).href
    );
    const { telemetryService } = tmod;
    const offsetBefore = fs.existsSync(TELEMETRY_LOG) ? fs.statSync(TELEMETRY_LOG).size : 0;
    telemetryService.track({
      name: 'rag_lexical_fallback',
      modeId: 'mode_redact',
      properties: {
        testRunId: RUN_ID,
        query: 'should NOT be present in log',
        queryText: 'should NOT be present',
        userInput: 'should NOT be present',
        chunkText: 'should NOT be present',
        snippetText: 'should NOT be present',
        errorMessage: 'sensitive error: should NOT be present',
        userMessage: 'should NOT be present',
      },
    });
    const newEvents = readNewLines(offsetBefore).filter(e => e?.modeId === 'mode_redact');
    assert.equal(newEvents.length, 1);
    const serialized = JSON.stringify(newEvents[0]);
    assert.ok(!serialized.includes('should NOT be present'),
      `Redactor must remove query/userInput/chunk/snippet/errorMessage values. Got:\n${serialized}`);
  });
});
