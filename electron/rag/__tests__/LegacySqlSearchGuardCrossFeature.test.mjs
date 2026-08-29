// electron/rag/__tests__/LegacySqlSearchGuardCrossFeature.test.mjs
//
// Alto — covers three previously-thin areas de o v1→v2 migration:
//
//  (5) buildLegacySpaceCaseSql(): todo LEGACY_PROVIDER_MODEL entry precisa produce a
//      valid SQL CASE arm, and running that CASE em a real SQLite backfill precisa yield
//      exatamente legacySpaceForProvider(name, dims) para cada provedor — incluindo o
//      equality-only safety (não divide em ':') para qualquer colon-bearing modelo id.
//
//  (6) VectorStore busca hard-guard: searchSimilar({}) and searchSummaries(q, 5) com
//      Não spaceKey retorna [] (refuse to leak através spaces); Com a spaceKey they filtrar
//      correctly; meetingId + spaceKey ccombina
//
//  (7) Cross-feature isolation: meetings reindex (RAG tables) and knowledge re-embed
//      (context_nodes) são separate DBs/tables and nunca interfere; a local-only 384d
//      user cujo spaces já match aciona Nenhum a needless meetings reindex Nem
//      a knowledge re-embed.
//
// Executa sob Electron ABI:
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --testar <farquivo

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const esPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/embeddingSpace.js');
const vsPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/VectorStore.js');
const kdbPath = path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge/KnowledgeDatabaseManager.js');

const ES = await import(pathToFileURL(esPath).href);
const { VectorStore } = await import(pathToFileURL(vsPath).href);
const { KnowledgeDatabaseManager } = await import(pathToFileURL(kdbPath).href);
const { buildLegacySpaceCaseSql, legacySpaceForProvider, LEGACY_PROVIDER_MODEL, embeddingSpaceKey } = ES;

// ──────────────────────────────────────────────────────────────────────────
// (5) buildLegacySpaceCaseSql — valid SQL + matches legacySpaceForProvider
// ──────────────────────────────────────────────────────────────────────────
describe('buildLegacySpaceCaseSql — backfill CASE matches legacySpaceForProvider', () => {
  test('produces one WHEN/THEN arm per LEGACY_PROVIDER_MODEL entry', () => {
    const sql = buildLegacySpaceCaseSql();
    const providers = Object.keys(LEGACY_PROVIDER_MODEL);
    for (const p of providers) {
      assert.ok(sql.includes(`WHEN '${p}' THEN '`), `arm present for provider ${p}`);
    }
    const armCount = (sql.match(/WHEN /g) || []).length;
    assert.equal(armCount, providers.length, 'exactly one arm per provider');
  });

  test('running the CASE in real SQLite yields legacySpaceForProvider(name,dims) for each', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE m (id TEXT, embedding_provider TEXT, embedding_dimensions INTEGER, embedding_space TEXT)`);
    // One linha por pprovedor plus an UNKNOWN provedor (precisa fall através CASE → não modelo match).
    const dims = { gemini: 768, ollama: 768, openai: 1536, local: 384 };
    for (const [p] of Object.entries(LEGACY_PROVIDER_MODEL)) {
      db.prepare("INSERT INTO m (id, embedding_provider, embedding_dimensions) VALUES (?, ?, ?)").run(p, p, dims[p]);
    }
    db.prepare("INSERT INTO m (id, embedding_provider, embedding_dimensions) VALUES ('x','mystery',999)").run();

    const caseArms = buildLegacySpaceCaseSql();
    // Mirror o v16 migration backfill shape: name:model:dims, modelo resolved via CASE.
    const backfill = `
      UPDATE m
      SET embedding_space =
        embedding_provider || ':' ||
        (CASE embedding_provider
          ${caseArms}
          ELSE 'unknown'
        END) || ':' ||
        COALESCE(CAST(embedding_dimensions AS TEXT), 'unknown')
      WHERE embedding_provider IS NOT NULL
    `;
    db.exec(backfill);

    for (const [p] of Object.entries(LEGACY_PROVIDER_MODEL)) {
      const row = db.prepare("SELECT embedding_space FROM m WHERE id = ?").get(p);
      const expected = legacySpaceForProvider(p, dims[p]);
      assert.equal(row.embedding_space, expected, `backfill matches legacySpaceForProvider for ${p}`);
    }
    // Unknown provedor → 'mystery:unknown:999' (CASE fell através to Senão 'unknown').
    const mystery = db.prepare("SELECT embedding_space FROM m WHERE id='x'").get();
    assert.equal(mystery.embedding_space, 'mystery:unknown:999');
    db.close();
  });

  test('equality-only safety: a colon-bearing model id is matched whole, never split', () => {
    // Não current LEGACY modelo contém a colon, mas Ollama-style ids (nomic-embed-text:latest)
    // cpoderia embeddingSpaceKey precisa keep o colon and equality compares precisa ainda hold.
    const k = embeddingSpaceKey({ name: 'ollama', model: 'nomic-embed-text:latest', dimensions: 768 });
    assert.equal(k, 'ollama:nomic-embed-text:latest:768');
    // Equality é o apenas operação used downstream — a naive split('::divide iria ser wrong,
    // então we assert o whole-string round-trips and compares equal to si mesmo / differs de v2.
    const k2 = embeddingSpaceKey({ name: 'ollama', model: 'nomic-embed-text:v2', dimensions: 768 });
    assert.notEqual(k, k2, 'colon-bearing models with different suffixes are distinct spaces');
    assert.equal(k, 'ollama:nomic-embed-text:latest:768'); // stable
  });
});

// ──────────────────────────────────────────────────────────────────────────
// (6) VectorStore busca hard-guard
// ──────────────────────────────────────────────────────────────────────────
describe('VectorStore search hard-guard (real compiled VectorStore, pure-SQL path)', () => {
  let db, vs;
  const SPACE_A = 'gemini:gemini-embedding-2:768';
  const SPACE_B = 'gemini:gemini-embedding-001:768';

  function embBlob(fill) {
    const b = Buffer.alloc(768 * 4);
    for (let i = 0; i < 768; i++) b.writeFloatLE(fill, i * 4);
    return b;
  }

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE meetings (id TEXT PRIMARY KEY, embedding_space TEXT);
      CREATE TABLE chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT, cleaned_text TEXT, embedding BLOB, speaker TEXT, start_ms INTEGER, end_ms INTEGER);
      CREATE TABLE chunk_summaries (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT, summary_text TEXT, embedding BLOB);
    `);
    vs = new VectorStore(db, ':memory:', '/nonexistent-ext');
    // Meeting em SPACE_A com one embedded chunk + summary; meeting em SPACE_B ttambém
    db.prepare("INSERT INTO meetings (id, embedding_space) VALUES ('mA', ?)").run(SPACE_A);
    db.prepare("INSERT INTO meetings (id, embedding_space) VALUES ('mB', ?)").run(SPACE_B);
    db.prepare("INSERT INTO chunks (meeting_id, cleaned_text, embedding, speaker, start_ms, end_ms) VALUES ('mA','chunk A', ?, 'spk', 0, 1)").run(embBlob(0.1));
    db.prepare("INSERT INTO chunks (meeting_id, cleaned_text, embedding, speaker, start_ms, end_ms) VALUES ('mB','chunk B', ?, 'spk', 0, 1)").run(embBlob(0.2));
    db.prepare("INSERT INTO chunk_summaries (meeting_id, summary_text, embedding) VALUES ('mA','sum A', ?)").run(embBlob(0.1));
    db.prepare("INSERT INTO chunk_summaries (meeting_id, summary_text, embedding) VALUES ('mB','sum B', ?)").run(embBlob(0.2));
  });
  afterEach(async () => {
    // Terminate o VectorStore worker thread então o testar processo pode exit cleanly
    // (a WITH-spaceKey busca spins para cima a WWorker sem destroy() o evento loop hangs).
    if (vs && typeof vs.destroy === 'function') await vs.destroy();
    db.close();
  });

  test('searchSimilar({}) with NO spaceKey → [] (refuses cross-space leak)', async () => {
    const res = await vs.searchSimilar(new Array(768).fill(0.1), {});
    assert.deepEqual(res, [], 'empty options → empty, never all-spaces leak');
  });

  test('searchSummaries(q, 5) with NO spaceKey → [] (refuses cross-space leak)', async () => {
    const res = await vs.searchSummaries(new Array(768).fill(0.1), 5);
    assert.deepEqual(res, [], 'no spaceKey → empty');
  });

  test('searchSimilar with spaceKey filters to that space only', async () => {
    const res = await vs.searchSimilar(new Array(768).fill(0.1), { spaceKey: SPACE_A, minSimilarity: -1 });
    assert.ok(res.length >= 1, 'returns chunks in SPACE_A');
    assert.ok(res.every(r => r.meetingId === 'mA'), 'no SPACE_B chunks leak into a SPACE_A search');
  });

  test('searchSummaries with spaceKey filters to that space only', async () => {
    const res = await vs.searchSummaries(new Array(768).fill(0.1), 5, SPACE_A);
    assert.ok(res.length >= 1);
    assert.ok(res.every(r => r.meetingId === 'mA'), 'only SPACE_A summaries');
  });

  test('meetingId + spaceKey combine: a meetingId in a DIFFERENT space yields nothing', async () => {
    // mB é em SPACE_B; consulta para mB mas com o SPACE_A chave → space filtrar exclui it.
    const res = await vs.searchSimilar(new Array(768).fill(0.2), { meetingId: 'mB', spaceKey: SPACE_A, minSimilarity: -1 });
    assert.deepEqual(res, [], 'meetingId scoped + space-mismatched → empty');
    // mB com its próprio SPACE_B chave → returned.
    const ok = await vs.searchSimilar(new Array(768).fill(0.2), { meetingId: 'mB', spaceKey: SPACE_B, minSimilarity: -1 });
    assert.ok(ok.length >= 1 && ok.every(r => r.meetingId === 'mB'));
  });
});

// ──────────────────────────────────────────────────────────────────────────
// (7) Cross-feature isolation + local-only no-op
// ──────────────────────────────────────────────────────────────────────────
describe('Cross-feature: meetings RAG vs knowledge base do not interfere', () => {
  test('separate tables: knowledge re-embed never reads/writes RAG meeting tables', () => {
    // Build Ambos schemas em one DB (worst case: shared farquivo and prove o knowledge
    // re-embed sweep apenas touches context_nodes.
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE meetings (id TEXT PRIMARY KEY, embedding_space TEXT, is_processed INTEGER DEFAULT 1);
      CREATE TABLE chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT, embedding BLOB);
      CREATE TABLE chunk_summaries (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT, embedding BLOB);
    `);
    const SPACE_V1 = embeddingSpaceKey({ name: 'gemini', model: 'gemini-embedding-001', dimensions: 768 });
    const SPACE_V2 = embeddingSpaceKey({ name: 'gemini', model: 'gemini-embedding-2', dimensions: 768 });
    // A v1 meeting (iria ser a meetings-reindex candidate).
    db.prepare("INSERT INTO meetings (id, embedding_space) VALUES ('m1', ?)").run(SPACE_V1);
    db.prepare("INSERT INTO chunks (meeting_id, embedding) VALUES ('m1', ?)").run(Buffer.alloc(768 * 4));

    const kdb = new KnowledgeDatabaseManager(db);
    kdb.initializeSchema();
    kdb.saveNodes([{ source_type: 'RESUME', category: 'c', title: 't', text_content: 'x', tags: [], embedding: new Array(768).fill(0.1), embedding_space: SPACE_V1 }]);

    // Knowledge sweep encontra its nnó Não o meeting.
    const staleNodes = kdb.getNodesNeedingReembed(SPACE_V2);
    assert.equal(staleNodes.length, 1, 'knowledge sweep finds its own node');
    assert.equal(staleNodes[0].source_type, 'RESUME');

    // O meetings tabela linha é wholly unaffected por knowledge operations.
    const m = db.prepare("SELECT embedding_space FROM meetings WHERE id='m1'").get();
    assert.equal(m.embedding_space, SPACE_V1, 'meeting space untouched by knowledge sweep');
    // updateNodeEmbedding precisa não touch chunks.
    kdb.updateNodeEmbedding(staleNodes[0].id, new Array(768).fill(0.9), SPACE_V2);
    const chunkStillThere = db.prepare("SELECT COUNT(*) c FROM chunks WHERE meeting_id='m1' AND embedding IS NOT NULL").get();
    assert.equal(chunkStillThere.c, 1, 'meeting chunk embedding untouched by knowledge updateNodeEmbedding');
    db.close();
  });

  test('local-only 384d user (spaces already match) triggers NEITHER reindex NOR re-embed', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE meetings (id TEXT PRIMARY KEY, embedding_space TEXT, is_processed INTEGER DEFAULT 1, created_at TEXT);
      CREATE TABLE chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT, embedding BLOB);
      CREATE TABLE chunk_summaries (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT, embedding BLOB);
    `);
    const LOCAL = embeddingSpaceKey({ name: 'local', model: 'Xenova/all-MiniLM-L6-v2', dimensions: 384 });

    // Meeting já embedded em o LOCAL space.
    db.prepare("INSERT INTO meetings (id, embedding_space) VALUES ('m1', ?)").run(LOCAL);
    db.prepare("INSERT INTO chunks (meeting_id, embedding) VALUES ('m1', ?)").run(Buffer.alloc(384 * 4));
    const vs = new VectorStore(db, ':memory:', '/nonexistent-ext');
    assert.equal(vs.getIncompatibleSpaceCount(LOCAL), 0, 'no meetings need reindex when space matches active');
    assert.deepEqual(vs.getMeetingIdsNeedingReindex(LOCAL), [], 'no meeting ids to reindex');

    // Knowledge nó já em o LOCAL space.
    const kdb = new KnowledgeDatabaseManager(db);
    kdb.initializeSchema();
    kdb.saveNodes([{ source_type: 'RESUME', category: 'c', title: 't', text_content: 'x', tags: [], embedding: new Array(384).fill(0.1), embedding_space: LOCAL }]);
    assert.equal(kdb.getNodesNeedingReembed(LOCAL).length, 0, 'no knowledge nodes need re-embed when space matches active');
    db.close();
  });
});
