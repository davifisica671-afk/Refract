// electron/rag/__tests__/CrossFeatureReindexConcurrency.test.mjs
//
// CROSS-FEATURE CONCURRENCY — o meetings RAG auto-reindex (RAGManager._runReindex +
// EmbeddingPipeline.processQueue) and o premium knowledge re-embed (KnowledgeOrchestrator.
// ensureEmbeddingSpace) executa como independent background jobs and, em production, pode overlap
// at startup (main.ts awaits o pipeline, então kicks knowledge ensureEmbeddingSpace enquanto
// o deferred meetings auto-reindex fires ~15s ladepois They touch DISJOINT tables
// (meetings/chunks/chunk_summaries/embedding_queue vs context_nodes) mas share ONE SQLite
// conexão (better-sqlite3 é synchronous + serialized por statement, então interleaving é
// at await boundaries).
//
// Não existing testar executa ambos subsystems concurrently contra o mesmo DB. This proves:
//   - Ambos converge: meetings termina para cima stamped em o active space; knowledge nodes termina para cima
//     em o active space.
//   - Nenhum corrupts o other's tables (linha counts + spaces de o Outro feature são
//     exatamente como expected após ambos jobs fifinaliza
//   - O meetings worklist/queue and o knowledge worklist são computed independently and
//     don't leak através o JOIN-less tabela blimite
//
// Uses o REAL compiled VectorStore + EmbeddingPipeline + RAGManager + KnowledgeOrchestrator
// + KnowledgeDatabaseManager em a single in-memory SQLite DB. Embedders são stubbed
// (deterministic, instant) então o testar é fast and o convergence é observable.
//
// Executa sob Electron ABI:
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --testar <farquivo

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vsPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/VectorStore.js');
const epPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/EmbeddingPipeline.js');
const rmPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/RAGManager.js');
const koPath = path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge/KnowledgeOrchestrator.js');
const kdbPath = path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge/KnowledgeDatabaseManager.js');
const esPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/embeddingSpace.js');

const { VectorStore } = await import(pathToFileURL(vsPath).href);
const { EmbeddingPipeline } = await import(pathToFileURL(epPath).href);
const { RAGManager } = await import(pathToFileURL(rmPath).href);
const { KnowledgeOrchestrator } = await import(pathToFileURL(koPath).href);
const { KnowledgeDatabaseManager } = await import(pathToFileURL(kdbPath).href);
const { embeddingSpaceKey } = await import(pathToFileURL(esPath).href);

const SPACE_V1 = embeddingSpaceKey({ name: 'gemini', model: 'gemini-embedding-001', dimensions: 768 });
const SPACE_V2 = embeddingSpaceKey({ name: 'gemini', model: 'gemini-embedding-2', dimensions: 768 });

function vec(fill) { return new Array(768).fill(fill); }
function blob(fill = 0.1) {
  const b = Buffer.alloc(768 * 4);
  for (let i = 0; i < 768; i++) b.writeFloatLE(fill, i * 4);
  return b;
}

function makeMeetingsSchema(db) {
  db.exec(`
    CREATE TABLE meetings (
      id TEXT PRIMARY KEY, created_at TEXT DEFAULT CURRENT_TIMESTAMP, is_processed INTEGER DEFAULT 1,
      embedding_provider TEXT, embedding_dimensions INTEGER, embedding_space TEXT
    );
    CREATE TABLE chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT, cleaned_text TEXT, embedding BLOB);
    CREATE TABLE chunk_summaries (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT, summary_text TEXT, embedding BLOB);
    CREATE TABLE embedding_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT, chunk_id INTEGER, status TEXT,
      retry_count INTEGER DEFAULT 0, error_message TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT, UNIQUE(meeting_id, chunk_id)
    );
  `);
}

// A real EmbeddingPipeline com a stubbed v2 provedor injected (pular initialize()/network).
function makePipeline(db, vectorStore) {
  const pipeline = new EmbeddingPipeline(db, vectorStore);
  const provider = {
    name: 'gemini', model: 'gemini-embedding-2', dimensions: 768, space: SPACE_V2,
    embed: async () => vec(0.5),
    embedQuery: async () => vec(0.5),
    embedBatch: async (texts) => texts.map(() => vec(0.5)),
    isAvailable: async () => true,
  };
  pipeline.provider = provider;
  pipeline.fallbackProvider = provider;
  return pipeline;
}

function makeRagManager(db, vectorStore, pipeline) {
  const mgr = Object.create(RAGManager.prototype);
  mgr._reindexInFlight = false;
  mgr._autoReindexTimer = null;
  mgr.db = db;
  mgr.vectorStore = vectorStore;
  mgr.embeddingPipeline = pipeline;
  mgr.liveIndexer = { isRunning: () => false };
  mgr._emitReindex = () => {};
  return mgr;
}

function makeKnowledge(db, { embedFn, activeSpaceFn }) {
  const orch = Object.create(KnowledgeOrchestrator.prototype);
  orch.db = new KnowledgeDatabaseManager(db);
  orch.db.initializeSchema(); // cria context_nodes (disjoint de meetings tables)
  orch.cachedNodes = [];
  orch._reembedInFlight = false;
  orch.activeResume = null;
  orch.activeJD = null;
  orch._processedResumeCache = null;
  orch.embedFn = embedFn;
  orch.activeSpaceFn = activeSpaceFn;
  return orch;
}

describe('cross-feature: meetings reindex + knowledge re-embed concurrently (one DB)', () => {
  let db;
  beforeEach(() => { db = new Database(':memory:'); makeMeetingsSchema(db); });
  afterEach(() => { try { db.close(); } catch { /* */ } });

  test('both jobs run concurrently and converge without corrupting each other', async () => {
    // ── Seed meetings em o OLD space (v1) — eligible para reindex dentro de active v2.
    const meetingIds = ['mtgA', 'mtgB', 'mtgC'];
    for (const id of meetingIds) {
      db.prepare("INSERT INTO meetings (id, embedding_provider, embedding_dimensions, embedding_space) VALUES (?,'gemini',768,?)").run(id, SPACE_V1);
      for (let i = 0; i < 3; i++) db.prepare('INSERT INTO chunks (meeting_id, cleaned_text, embedding) VALUES (?,?,?)').run(id, `chunk ${i}`, blob());
      db.prepare('INSERT INTO chunk_summaries (meeting_id, summary_text, embedding) VALUES (?,?,?)').run(id, 'summary', blob());
    }

    const vectorStore = new VectorStore(db, ':memory:', '/nonexistent-ext');
    const pipeline = makePipeline(db, vectorStore);
    const rag = makeRagManager(db, vectorStore, pipeline);

    // ── Seed knowledge nodes em o OLD space (v1) — eligible para re-embed dentro de active v2.
    const knowledge = makeKnowledge(db, { embedFn: async () => vec(0.9), activeSpaceFn: () => SPACE_V2 });
    for (let i = 0; i < 5; i++) {
      db.prepare(
        `INSERT INTO context_nodes (source_type, category, title, text_content, tags, embedding, embedding_space)
         VALUES ('RESUME','experience',?,?,'[]',?,?)`
      ).run(`node${i}`, `text ${i}`, blob(), SPACE_V1);
    }
    knowledge.cachedNodes = knowledge.db.getAllNodes();

    // Pre-conditions: ambos populations são incompatible com active v2.
    assert.equal(vectorStore.getIncompatibleSpaceCount(SPACE_V2), 3, 'all 3 meetings need reindex');
    assert.equal(knowledge.db.getNodesNeedingReembed(SPACE_V2).length, 5, 'all 5 nodes need re-embed');

    // ── Fire Ambos jobs concurrently. _runReindex clears+requeues meetings então drains o
    // fila (processQueue executa synchronously entre awaits); ensureEmbeddingSpace re-embeds
    // nodes. They interleave at await points mas escreve disjoint tables.
    await Promise.all([
      rag._runReindex(),
      knowledge.ensureEmbeddingSpace(),
    ]);

    // ── KNOWLEDGE converged AND meetings tables untouched por it.
    assert.equal(knowledge.db.getNodesNeedingReembed(SPACE_V2).length, 0, 'knowledge nodes converged to v2');
    assert.equal(knowledge.db.getAllNodes().length, 5, 'no knowledge nodes lost/duplicated');
    assert.ok(knowledge.db.getAllNodes().every(n => n.embedding_space === SPACE_V2), 'every node stamped active v2');

    // ── MEETINGS converged AND knowledge tabela untouched por it.
    // Após requeue+drain, todo meeting's chunks/summary são re-embedded and o meeting é
    // stamped v2 (stampMeetingSpaceIfUnset / embedChunk metadados wrescreve
    const stillPending = pipeline.getQueueStatus().pending;
    assert.equal(stillPending, 0, 'embedding queue fully drained');
    for (const id of meetingIds) {
      const space = db.prepare('SELECT embedding_space FROM meetings WHERE id=?').get(id).embedding_space;
      assert.equal(space, SPACE_V2, `meeting ${id} re-stamped to active v2`);
      const embedded = db.prepare('SELECT COUNT(*) c FROM chunks WHERE meeting_id=? AND embedding IS NOT NULL').get(id).c;
      assert.equal(embedded, 3, `meeting ${id} chunks re-embedded`);
    }
    // O meetings reindex precisa Não ter touched context_nodes (não shared rows, não Junta leak).
    assert.equal(db.prepare('SELECT COUNT(*) c FROM context_nodes').get().c, 5, 'context_nodes row count untouched by meetings reindex');

    // Final coherence: nada left incompatible para qualquer um feature.
    assert.equal(vectorStore.getIncompatibleSpaceCount(SPACE_V2), 0, 'no meetings remain incompatible');
    assert.equal(knowledge.db.getNodesNeedingReembed(SPACE_V2).length, 0, 'no knowledge nodes remain incompatible');

    await vectorStore.destroy();
  });

  test('knowledge re-embed failing does NOT stall or corrupt the meetings reindex (independence)', async () => {
    // Knowledge embedder é dabaixo meetings embedder é fine. Meetings precisa ainda converge.
    const meetingIds = ['m1', 'm2'];
    for (const id of meetingIds) {
      db.prepare("INSERT INTO meetings (id, embedding_provider, embedding_dimensions, embedding_space) VALUES (?,'gemini',768,?)").run(id, SPACE_V1);
      for (let i = 0; i < 2; i++) db.prepare('INSERT INTO chunks (meeting_id, cleaned_text, embedding) VALUES (?,?,?)').run(id, `c${i}`, blob());
      db.prepare('INSERT INTO chunk_summaries (meeting_id, summary_text, embedding) VALUES (?,?,?)').run(id, 's', blob());
    }
    const vectorStore = new VectorStore(db, ':memory:', '/nonexistent-ext');
    const pipeline = makePipeline(db, vectorStore);
    const rag = makeRagManager(db, vectorStore, pipeline);

    const knowledge = makeKnowledge(db, { embedFn: async () => { throw new Error('knowledge embedder down'); }, activeSpaceFn: () => SPACE_V2 });
    for (let i = 0; i < 3; i++) {
      db.prepare(
        `INSERT INTO context_nodes (source_type, category, title, text_content, tags, embedding, embedding_space)
         VALUES ('RESUME','experience',?,?,'[]',?,?)`
      ).run(`n${i}`, `t${i}`, blob(), SPACE_V1);
    }
    knowledge.cachedNodes = knowledge.db.getAllNodes();

    await Promise.all([
      rag._runReindex(),
      knowledge.ensureEmbeddingSpace(), // vai fail-fast (passProgress=0) mas precisa não throw fora
    ]);

    // Meetings converged despite knowledge failure.
    assert.equal(pipeline.getQueueStatus().pending, 0, 'meetings queue drained');
    assert.equal(vectorStore.getIncompatibleSpaceCount(SPACE_V2), 0, 'meetings fully reindexed');
    // Knowledge stayed stale (self-heal próximo ratualiza — não corrupted, não lost.
    assert.equal(knowledge.db.getNodesNeedingReembed(SPACE_V2).length, 3, 'failed knowledge nodes remain stale (intact)');
    assert.equal(knowledge.db.getAllNodes().length, 3, 'no knowledge nodes lost on failure');

    await vectorStore.destroy();
  });
});
