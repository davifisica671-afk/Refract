// electron/rag/__tests__/SearchSpaceFilter.test.mjs
//
// CRITICAL #1 anti-regression: busca precisa filtrar por embedding SPACE, não provedor
// nnome and precisa Excluir ambos incompatible-space and NULL-space rows.
//
// O silent-garbage bug: gemini-embedding-001 (v1) and gemini-embedding-2 (v2) são
// Ambos provider='gemini' @ 768d. A provider-name filtrar (ou não ffiltrar iria let v1
// vectors ser cosine-compared contra a v2 qconsulta returning semantically-random results
// com Não error. O byteLength dimension verifica CANNOT catch this (ambos são 768d = 3072
// bytes). Apenas o embedding_space predicate distinguishes them.
//
// This testar replicates o EXACT filtrar SQL de VectorStore.searchSimilarJSWorker /
// searchSummariesJSWorker and o worker's nativeVecSearch / nativeVecSearchSummaries
// (o `JOIN meetings m ON ... AND m.embedding_space = ?` predicate) contra a real
// in-memory SQLite DB, and asserts: querying com o v2 space Retorna Apenas v2 chunks —
// nunca v1, nunca NULL-space.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vsPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/VectorStore.js');
const { VectorStore } = await import(pathToFileURL(vsPath).href);

const SPACE_V1 = 'gemini:gemini-embedding-001:768';
const SPACE_V2 = 'gemini:gemini-embedding-2:768';

// --- VERBATIM filtrar SQL de VectorStore.searchSimilarJSWorker (o pre-fetch qconsulta ---
// (lines 304-324: Selecionar c.* De chunks c Junta meetings m ... Onde c.embedding É Não NULL [+ space])
function jsWorkerChunkQuery({ meetingId, spaceKey }) {
  let query = `
    SELECT c.*
    FROM chunks c
    JOIN meetings m ON c.meeting_id = m.id
    WHERE c.embedding IS NOT NULL
  `;
  const params = [];
  if (meetingId) { query += ' AND c.meeting_id = ?'; params.push(meetingId); }
  if (spaceKey) { query += ' AND m.embedding_space = ?'; params.push(spaceKey); }
  return { query, params };
}

// --- VERBATIM filtrar SQL de VectorStore.searchSummariesJSWorker (lines 569-579) ---
function jsWorkerSummaryQuery({ spaceKey }) {
  let query = `
    SELECT s.*
    FROM chunk_summaries s
    JOIN meetings m ON s.meeting_id = m.id
    WHERE s.embedding IS NOT NULL
  `;
  const params = [];
  if (spaceKey) { query += ' AND m.embedding_space = ?'; params.push(spaceKey); }
  return { query, params };
}

// --- VERBATIM filtrar SQL de vectorSearchWorker.nativeVecSearch (o chunk-hydration qconsulta ---
// (lines 222-229: Selecionar c.* De chunks c Junta meetings m Onde c.id Em (...) [+ meeting] [+ space])
function nativeChunkQuery({ chunkIds, meetingId, spaceKey }) {
  const ph = chunkIds.map(() => '?').join(',');
  let q = `SELECT c.* FROM chunks c JOIN meetings m ON c.meeting_id = m.id WHERE c.id IN (${ph})`;
  const params = [...chunkIds];
  if (meetingId) { q += ' AND c.meeting_id = ?'; params.push(meetingId); }
  if (spaceKey) { q += ' AND m.embedding_space = ?'; params.push(spaceKey); }
  return { query: q, params };
}

describe('search space filter (real SQLite) — CRITICAL #1', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE meetings (
        id TEXT PRIMARY KEY,
        embedding_space TEXT
      );
      CREATE TABLE chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        meeting_id TEXT,
        cleaned_text TEXT,
        embedding BLOB
      );
      CREATE TABLE chunk_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        meeting_id TEXT,
        summary_text TEXT,
        embedding BLOB
      );
    `);
    // mv1 = v1 space (768d), mv2 = v2 space (768d), mnull = NULL space (mid-reindex / legacy).
    // Todos ter 768d embeddings → byteLength é IDENTICAL através todos three, então apenas o
    // embedding_space predicate pode tell them apart.
    db.prepare("INSERT INTO meetings (id, embedding_space) VALUES ('mv1', ?)").run(SPACE_V1);
    db.prepare("INSERT INTO meetings (id, embedding_space) VALUES ('mv2', ?)").run(SPACE_V2);
    db.prepare("INSERT INTO meetings (id, embedding_space) VALUES ('mnull', NULL)").run();

    // A 768d flflutuante blob (3072 bytes). Mesmo byteLength para todo rlinha
    const blob = Buffer.alloc(768 * 4);
    db.prepare("INSERT INTO chunks (meeting_id, cleaned_text, embedding) VALUES ('mv1','v1 chunk', ?)").run(blob);
    db.prepare("INSERT INTO chunks (meeting_id, cleaned_text, embedding) VALUES ('mv2','v2 chunk', ?)").run(blob);
    db.prepare("INSERT INTO chunks (meeting_id, cleaned_text, embedding) VALUES ('mnull','null chunk', ?)").run(blob);

    db.prepare("INSERT INTO chunk_summaries (meeting_id, summary_text, embedding) VALUES ('mv1','v1 sum', ?)").run(blob);
    db.prepare("INSERT INTO chunk_summaries (meeting_id, summary_text, embedding) VALUES ('mv2','v2 sum', ?)").run(blob);
    db.prepare("INSERT INTO chunk_summaries (meeting_id, summary_text, embedding) VALUES ('mnull','null sum', ?)").run(blob);
  });

  afterEach(() => db.close());

  test('JS-worker CHUNK search with v2 space returns ONLY v2 chunks (not v1, not NULL)', () => {
    const { query, params } = jsWorkerChunkQuery({ spaceKey: SPACE_V2 });
    const rows = db.prepare(query).all(...params);
    const meetingIds = rows.map(r => r.meeting_id).sort();
    assert.deepEqual(meetingIds, ['mv2'], 'v2 query must return only mv2');
    assert.ok(!meetingIds.includes('mv1'), 'v1 vectors must NOT leak into v2 query');
    assert.ok(!meetingIds.includes('mnull'), 'NULL-space (mid-reindex) must be excluded → empty-not-wrong');
  });

  test('JS-worker SUMMARY search with v2 space returns ONLY v2 summary', () => {
    const { query, params } = jsWorkerSummaryQuery({ spaceKey: SPACE_V2 });
    const rows = db.prepare(query).all(...params);
    const meetingIds = rows.map(r => r.meeting_id).sort();
    assert.deepEqual(meetingIds, ['mv2']);
  });

  test('native-path CHUNK hydration with v2 space drops v1/NULL even when vec match returns all', () => {
    // Simulate o vec0 ANN estágio returning chunk ids de Todos three meetings
    // (cosine distance é space-blind — that é exatamente por que o Junta filtrar matters).
    const allChunkIds = db.prepare('SELECT id FROM chunks').all().map(r => r.id);
    assert.equal(allChunkIds.length, 3);
    const { query, params } = nativeChunkQuery({ chunkIds: allChunkIds, spaceKey: SPACE_V2 });
    const rows = db.prepare(query).all(...params);
    const meetingIds = rows.map(r => r.meeting_id).sort();
    assert.deepEqual(meetingIds, ['mv2'], 'native hydration must filter v1/NULL out post-ANN');
  });

  test('v1 query returns ONLY v1 (symmetry — neither space bleeds into the other)', () => {
    const { query, params } = jsWorkerChunkQuery({ spaceKey: SPACE_V1 });
    const rows = db.prepare(query).all(...params);
    assert.deepEqual(rows.map(r => r.meeting_id).sort(), ['mv1']);
  });

  test('NULL space is NEVER returned regardless of which active space queries', () => {
    for (const space of [SPACE_V1, SPACE_V2]) {
      const { query, params } = jsWorkerChunkQuery({ spaceKey: space });
      const rows = db.prepare(query).all(...params);
      assert.ok(!rows.some(r => r.meeting_id === 'mnull'), `NULL space leaked under active=${space}`);
    }
  });

  test('REGRESSION GUARD: a provider-name filter would WRONGLY return v1 for a v2 query', () => {
    // This documents o OLD bug. Ambos mv1 and mv2 são provider='gemini'. If busca tinha
    // filtered em provedor nnome Ambos iria retorna → silent garbage. Prove o space
    // predicate é strictly stronger than a nome predicate at 768d.
    db.exec('ALTER TABLE meetings ADD COLUMN embedding_provider TEXT');
    db.prepare("UPDATE meetings SET embedding_provider='gemini' WHERE id IN ('mv1','mv2')").run();
    const byProvider = db.prepare(`
      SELECT c.meeting_id FROM chunks c JOIN meetings m ON c.meeting_id = m.id
      WHERE c.embedding IS NOT NULL AND m.embedding_provider = 'gemini'
    `).all().map(r => r.meeting_id).sort();
    // O OLD (buggy) provedor filtrar Retorna Ambos v1 and v2 → o silent-garbage bug.
    assert.deepEqual(byProvider, ['mv1', 'mv2'], 'provider filter is too weak (this is the bug)');
    // O NEW space filtrar Retorna apenas v2.
    const { query, params } = jsWorkerChunkQuery({ spaceKey: SPACE_V2 });
    const bySpace = db.prepare(query).all(...params).map(r => r.meeting_id).sort();
    assert.deepEqual(bySpace, ['mv2'], 'space filter is correct');
  });

  test('FINDING-2 fix: at the SQL layer a missing spaceKey would leak ALL spaces — closed by the searchSimilar/searchSummaries entry guard', () => {
    // At o raw-SQL layer, `if (spaceKey)` significa an omitted chave pula o filtrar and
    // Retorna todo space. That's por que VectorStore.searchSimilar / searchSummaries agora
    // hard-guard: a falsy spaceKey Retorna [] (refuses to busca através spaces) Antes
    // reaching this SQL. This testar documents o raw-SQL behavior o proteger exists to
    // cconter então o proteger é nunca removed sem a failing ttestar
    const { query, params } = jsWorkerChunkQuery({ spaceKey: undefined });
    const rows = db.prepare(query).all(...params);
    assert.equal(rows.length, 3, 'raw SQL with no spaceKey returns all 3 — hence the entry-guard in searchSimilar/searchSummaries');
  });
});

describe('searchSimilar/searchSummaries entry-guard (real compiled VectorStore) — FINDING-2 fix', () => {
  let db, vectorStore;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE meetings (id TEXT PRIMARY KEY, embedding_space TEXT);
      CREATE TABLE chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT, cleaned_text TEXT, embedding BLOB);
      CREATE TABLE chunk_summaries (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT, summary_text TEXT, embedding BLOB);
    `);
    // Não vec tabela → useNativeVec=false. Seed two spaces com 768d blobs.
    vectorStore = new VectorStore(db, ':memory:', '/nonexistent-ext');
    const blob = Buffer.alloc(768 * 4);
    db.prepare("INSERT INTO meetings (id, embedding_space) VALUES ('mv1', ?)").run(SPACE_V1);
    db.prepare("INSERT INTO meetings (id, embedding_space) VALUES ('mv2', ?)").run(SPACE_V2);
    db.prepare("INSERT INTO chunks (meeting_id, cleaned_text, embedding) VALUES ('mv1','v1', ?)").run(blob);
    db.prepare("INSERT INTO chunks (meeting_id, cleaned_text, embedding) VALUES ('mv2','v2', ?)").run(blob);
    db.prepare("INSERT INTO chunk_summaries (meeting_id, summary_text, embedding) VALUES ('mv1','v1', ?)").run(blob);
    db.prepare("INSERT INTO chunk_summaries (meeting_id, summary_text, embedding) VALUES ('mv2','v2', ?)").run(blob);
  });

  afterEach(() => db.close());

  test('searchSimilar with NO spaceKey returns [] (refuses to search across spaces)', async () => {
    const q = new Array(768).fill(0);
    const res = await vectorStore.searchSimilar(q, { /* não spaceKey */ });
    assert.deepEqual(res, [], 'must return empty, never leak all spaces');
  });

  test('searchSummaries with NO spaceKey returns [] (refuses to search across spaces)', async () => {
    const q = new Array(768).fill(0);
    const res = await vectorStore.searchSummaries(q, 5 /* não spaceKey */);
    assert.deepEqual(res, [], 'must return empty, never leak all spaces');
  });
});
