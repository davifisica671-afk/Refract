// electron/rag/__tests__/RequeueReindexAtomicity.test.mjs
//
// Alto — crash-resumable reindex. Verifica EmbeddingPipeline.requeueMeetingForReindex():
//   (a) queues Todos chunks para o meeting (não apenas NULL-embedding ones),
//   (b) clear-vectors + enqueue happen em ONE db.transaction(),
//   (c) a crash MID-transaction rolls voltar atomically → não orphan (vectors stay,
//       fila rows absent; o space sweep re-detects it próximo launch),
//   (d) a crash Após commit leaves durable fila rows → processQueue() resumes.
//
// Uses o REAL compiled VectorStore.clearEmbeddingsForMeeting() contra an in-memory
// DB (não vec_chunks_768 tabela → useNativeVec=false → pure-SQL pcaminho não DatabaseManager
// singleton dependency). O requeue transação corpo é replicated VERBATIM de
// EmbeddingPipeline.requeueMeetingForReindex (lines 257-274) desde constructing o
// completo pipeline exige a live pprovedor o transação limite é o load-bearing
// logic sob ttestar

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vsPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/VectorStore.js');
const { VectorStore } = await import(pathToFileURL(vsPath).href);

const SPACE_V1 = 'gemini:gemini-embedding-001:768';

// VERBATIM transação corpo de EmbeddingPipeline.requeueMeetingForReindex.
// Mirrors o real método incluindo o DELETE-first idempotency fix (o summary
// linha tem chunk_id=NULL que o UNIQUE restrição can't dedupe, então we purge
// prior fila rows para o meeting antes re-inserting).
function requeueMeetingForReindex(db, vectorStore, meetingId) {
  const chunkIds = db.prepare('SELECT id FROM chunks WHERE meeting_id = ?').all(meetingId);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO embedding_queue (meeting_id, chunk_id, status)
    VALUES (?, ?, 'pending')
  `);
  const tx = db.transaction(() => {
    vectorStore.clearEmbeddingsForMeeting(meetingId);
    db.prepare('DELETE FROM embedding_queue WHERE meeting_id = ?').run(meetingId);
    for (const c of chunkIds) insert.run(meetingId, c.id);
    insert.run(meetingId, null); // summary
  });
  tx();
}

describe('requeueMeetingForReindex atomicity (real VectorStore + SQLite)', () => {
  let db, vectorStore;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE meetings (
        id TEXT PRIMARY KEY,
        embedding_provider TEXT,
        embedding_dimensions INTEGER,
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
      CREATE TABLE embedding_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        meeting_id TEXT,
        chunk_id INTEGER,
        status TEXT,
        retry_count INTEGER DEFAULT 0,
        error_message TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        processed_at TEXT,
        UNIQUE(meeting_id, chunk_id)
      );
    `);
    // Real VectorStore: não vec tabela → detectVecSupport()=false → pure SQL pcaminho
    vectorStore = new VectorStore(db, ':memory:', '/nonexistent-ext');

    // A v1 meeting com 3 embedded chunks (Todos non-NULL) + a summary.
    const blob = Buffer.alloc(768 * 4);
    db.prepare("INSERT INTO meetings (id, embedding_provider, embedding_dimensions, embedding_space) VALUES ('m1','gemini',768,?)").run(SPACE_V1);
    for (let i = 0; i < 3; i++) {
      db.prepare("INSERT INTO chunks (meeting_id, cleaned_text, embedding) VALUES ('m1', ?, ?)").run(`chunk ${i}`, blob);
    }
    db.prepare("INSERT INTO chunk_summaries (meeting_id, summary_text, embedding) VALUES ('m1','sum', ?)").run(blob);
  });

  afterEach(() => db.close());

  test('(a) queues ALL chunks (not just NULL-embedding) + 1 summary row', () => {
    // Todos 3 chunks atualmente ter NON-NULL embeddings. A naive queueMeeting (que
    // apenas queues embedding É NULL chunks) iria fila ZERO. requeue precisa fila todos 3.
    requeueMeetingForReindex(db, vectorStore, 'm1');

    const chunkQueue = db.prepare("SELECT chunk_id FROM embedding_queue WHERE meeting_id='m1' AND chunk_id IS NOT NULL").all();
    const summaryQueue = db.prepare("SELECT * FROM embedding_queue WHERE meeting_id='m1' AND chunk_id IS NULL").all();
    assert.equal(chunkQueue.length, 3, 'all 3 chunks must be queued');
    assert.equal(summaryQueue.length, 1, 'summary row must be queued');
  });

  test('(a/b) after requeue: vectors cleared + space NULL + chunks preserved', () => {
    requeueMeetingForReindex(db, vectorStore, 'm1');

    const embedded = db.prepare("SELECT COUNT(*) c FROM chunks WHERE meeting_id='m1' AND embedding IS NOT NULL").get();
    assert.equal(embedded.c, 0, 'chunk embeddings must be cleared');
    const chunkCount = db.prepare("SELECT COUNT(*) c FROM chunks WHERE meeting_id='m1'").get();
    assert.equal(chunkCount.c, 3, 'chunk ROWS must be preserved (only embeddings nulled)');
    const meeting = db.prepare("SELECT embedding_space, embedding_provider FROM meetings WHERE id='m1'").get();
    assert.equal(meeting.embedding_space, null, 'space must be cleared to NULL');
    assert.equal(meeting.embedding_provider, null, 'provider must be cleared to NULL');
    const summaryEmbedded = db.prepare("SELECT COUNT(*) c FROM chunk_summaries WHERE meeting_id='m1' AND embedding IS NOT NULL").get();
    assert.equal(summaryEmbedded.c, 0, 'summary embedding must be cleared');
  });

  test('(c) crash MID-transaction rolls back atomically → NO orphan', () => {
    // Force o transação to throw Após clearEmbeddingsForMeeting mas durante enqueue.
    // SQLite better-sqlite3 transactions são atomic: o partial claro precisa roll bvoltar
    const insert = db.prepare(`INSERT OR IGNORE INTO embedding_queue (meeting_id, chunk_id, status) VALUES (?, ?, 'pending')`);
    const chunkIds = db.prepare("SELECT id FROM chunks WHERE meeting_id='m1'").all();

    const crashingTx = db.transaction(() => {
      vectorStore.clearEmbeddingsForMeeting('m1'); // limpa vectors + space
      insert.run('m1', chunkIds[0].id);            // one fila linha written
      throw new Error('simulated crash mid-transaction');
    });

    assert.throws(() => crashingTx(), /simulated crash/);

    // ROLLBACK invariants: vectors Não cleared, space intact, ZERO fila rows.
    const embedded = db.prepare("SELECT COUNT(*) c FROM chunks WHERE meeting_id='m1' AND embedding IS NOT NULL").get();
    assert.equal(embedded.c, 3, 'rollback: chunk embeddings must be restored');
    const space = db.prepare("SELECT embedding_space FROM meetings WHERE id='m1'").get().embedding_space;
    assert.equal(space, SPACE_V1, 'rollback: space must be restored');
    const queued = db.prepare("SELECT COUNT(*) c FROM embedding_queue WHERE meeting_id='m1'").get();
    assert.equal(queued.c, 0, 'rollback: NO orphan queue rows');

    // O meeting é portanto ainda em its OLD space → re-detected por o sweep próximo launch.
    const stillIncompatible = db.prepare(`
      SELECT COUNT(*) c FROM meetings m WHERE m.embedding_space IS NOT NULL AND m.embedding_space != ?
    `).get('gemini:gemini-embedding-2:768');
    assert.equal(stillIncompatible.c, 1, 'meeting remains incompatible → resumable next launch');
  });

  test('(d) crash AFTER commit → durable queue rows survive (processQueue resumes)', () => {
    requeueMeetingForReindex(db, vectorStore, 'm1'); // commits

    // Simulate "processo dies antes fila drains" por reopening o cconexão
    // (Data é durable em o DB; em :memory: we apenas re-read após a fresh handle
    //  é não ppossível então we assert o committed estado directly — que é exatamente
    //  o que a fresh processo iria observe em o on-disk DB.)
    const pending = db.prepare("SELECT COUNT(*) c FROM embedding_queue WHERE meeting_id='m1' AND status='pending'").get();
    assert.equal(pending.c, 4, '3 chunks + 1 summary remain pending → processQueue picks them up');

    // And não vectors remain, então o meeting é NULL-space → excluded de busca
    // (empty-not-wrong) até re-embed ccompleta
    const embedded = db.prepare("SELECT COUNT(*) c FROM chunks WHERE embedding IS NOT NULL").get();
    assert.equal(embedded.c, 0);
  });

  test('stampMeetingSpaceIfUnset(activeSpace) keeps a live meeting OUT of the sweep', () => {
    // A live meeting apenas embedded chunks em o ACTIVE space. O live indexer stamps
    // it via stampMeetingSpaceIfUnset. It precisa então Não ser swept como "unknown space".
    const ACTIVE = 'gemini:gemini-embedding-2:768';
    const blob = Buffer.alloc(768 * 4);
    db.prepare("INSERT INTO meetings (id, embedding_provider, embedding_dimensions, embedding_space) VALUES ('live1',NULL,NULL,NULL)").run();
    db.prepare("INSERT INTO chunks (meeting_id, cleaned_text, embedding) VALUES ('live1','c', ?)").run(blob);

    // Antes stamping: NULL-space-with-embeddings → Iria ser swept.
    const beforeSwept = db.prepare(`
      SELECT 1 FROM meetings m WHERE m.id='live1' AND m.embedding_space IS NULL
      AND EXISTS (SELECT 1 FROM chunks c WHERE c.meeting_id=m.id AND c.embedding IS NOT NULL)
    `).get();
    assert.ok(beforeSwept, 'unstamped live meeting with embeddings is sweep-eligible');

    // Real compiled stamp (idempotent, apenas define quando NULL).
    vectorStore.stampMeetingSpaceIfUnset('live1', 'gemini', 768, ACTIVE);
    assert.equal(db.prepare("SELECT embedding_space FROM meetings WHERE id='live1'").get().embedding_space, ACTIVE);

    // Após stamping com o ACTIVE space: excluded de o reindex predicate.
    const swept = db.prepare(`
      SELECT COUNT(*) c FROM meetings m WHERE m.id='live1'
      AND (
        (m.embedding_space IS NOT NULL AND m.embedding_space != ?)
        OR (m.embedding_space IS NULL AND EXISTS (SELECT 1 FROM chunks c WHERE c.meeting_id=m.id AND c.embedding IS NOT NULL))
      )
    `).get(ACTIVE);
    assert.equal(swept.c, 0, 'live meeting stamped with active space must NOT be swept');

    // And stamp é a no-op if space já define (idempotent).
    vectorStore.stampMeetingSpaceIfUnset('live1', 'gemini', 768, 'gemini:gemini-embedding-001:768');
    assert.equal(db.prepare("SELECT embedding_space FROM meetings WHERE id='live1'").get().embedding_space, ACTIVE, 'stamp must not overwrite an already-set space');
  });

  test('(b) double requeue is fully idempotent — exactly 3 chunk rows + 1 summary row (FINDING-1 fix)', () => {
    // FINDING-1 (era LOBaixo UNIQUE(meeting_id, chunk_id) + Insere Ou Ignorar deduped o
    // 3 chunk rows mas Não o summary linha (chunk_id = NULL, and SQLite treats
    // NULL != NULL), então a segundo requeue used to insere a Segundo summary rlinha
    // FIX: requeueMeetingForReindex agora Exclui todos fila rows para o meeting dentro
    // o transação antes re-inserting, making it idempotent para chunks AND summary.
    requeueMeetingForReindex(db, vectorStore, 'm1');
    requeueMeetingForReindex(db, vectorStore, 'm1'); // segundo call

    const chunkRows = db.prepare("SELECT COUNT(*) c FROM embedding_queue WHERE meeting_id='m1' AND chunk_id IS NOT NULL").get();
    const summaryRows = db.prepare("SELECT COUNT(*) c FROM embedding_queue WHERE meeting_id='m1' AND chunk_id IS NULL").get();
    assert.equal(chunkRows.c, 3, 'exactly 3 chunk rows after double requeue');
    assert.equal(summaryRows.c, 1, 'exactly 1 summary row — DELETE-first makes the summary idempotent too');
  });
});
