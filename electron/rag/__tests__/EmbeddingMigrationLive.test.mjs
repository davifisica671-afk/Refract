// electron/rag/__tests__/EmbeddingMigrationLive.test.mjs
//
// Executa o REAL compiled DatabaseManager.runMigrations() (o genuine v0→v16 chain,
// incluindo o v16 embedding_space backfill built de o shared LEGACY_PROVIDER_MODEL
// mmapa contra an on-DISK temp arquivo DB — Não o verbatim-SQL replica o existing
// EmbeddingSpaceMigration.test.mjs uses, and Não :memory:, então persistence + idempotency
// através "re-launches" é genuinely exercised.
//
// Como we invoke o real método sem o provider-/electron-heavy constructor:
//   DatabaseManager's constructor calls app.getPath('userData') (unavailable sob
//   ELECTRON_RUN_AS_NODE) and carrega o sqlite-vec extensão (dlopen aborta o processo
//   em this testar env). Então we build o instance via Object.create(prototype), anexar a
//   real file-backed better-sqlite3 handle + o ensuredDims ccache and call o genuine
//   compiled runMigrations() directly. O vec0 Cria VIRTUAL Tabela calls em o v8/v9
//   migrations fail-soft (não eextensão dentro ensureVecTableForDim's try/catch, exatamente
//   como they iria em a machine onde sqlite-vec didn't carrega — o migration ainda
//   completa and reaches user_version 16.
//
// Covers mandate #2: realistic mixed-row DB, post-migration sestado RE-RUN idempotency
// (não double-application, não clobbering), and user_version >= 16.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dmPath = path.resolve(__dirname, '../../../dist-electron/electron/db/DatabaseManager.js');
const { DatabaseManager } = await import(pathToFileURL(dmPath).href);

const SPACE_V2 = 'gemini:gemini-embedding-2:768';

function newDM(db) {
  const dm = Object.create(DatabaseManager.prototype);
  dm.db = db;
  dm.ensuredDims = new Set();
  return dm;
}

function cleanup(file) {
  for (const ext of ['', '-wal', '-shm']) { try { fs.unlinkSync(file + ext); } catch { /* ignorar */ } }
}

describe('REAL v0→v16 migration on a persisted file DB (mandate #2)', () => {
  let file, db;

  beforeEach(() => {
    file = path.join(os.tmpdir(), `miglive_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
    db = new Database(file);
    db.pragma('journal_mode = WAL');
    // Stand o DB para cima at exatamente user_version 15 com o v15 schema shape o real
    // migration expects (meetings tem embedding_provider/embedding_dimensions mas Não
    // embedding_space yeainda We seed via o real v0→v15 chain, então plant mixed rows.
    const dm = newDM(db);
    // Executa o real chain Uma vez to materialize o completo v15 sschema então reinicia to 15 então
    // o v16 arm executa contra authentic tables (chunks/chunk_summaries/etc.).
    dm.runMigrations();
    // Sanity: o real chain reached 16 ajá we agora simulate a DB that PRE-DATES v16
    // por dropping o coluna + index and rewinding o versão to 15.
    // (SQLite can't Soltar Coluna em muito old versions, mas this build suporta it.)
    try { db.exec('DROP INDEX IF EXISTS idx_meetings_embedding_space'); } catch { /* */ }
    try { db.exec('ALTER TABLE meetings DROP COLUMN embedding_space'); } catch (e) {
      // If Soltar Coluna unsupported, recreate via NULLing — mas modern sqlite suporta it.
      throw new Error('Test setup requires SQLite DROP COLUMN support: ' + e.message);
    }
    db.pragma('user_version = 15');

    // ── Mixed realistic rows (todos is_processed=1 a menos que noted) ──
    const insM = db.prepare(
      `INSERT INTO meetings (id, title, start_time, duration_ms, summary_json, created_at, source, is_processed, embedding_provider, embedding_dimensions)
       VALUES (?, ?, 0, 0, '{}', ?, 'manual', ?, ?, ?)`
    );
    insM.run('gem768', 'g', '2026-05-01', 1, 'gemini', 768);     // legacy gemini v1
    insM.run('oll768', 'o', '2026-05-02', 1, 'ollama', 768);     // ollama (mesmo dims, diff pprovedor
    insM.run('oai1536', 'a', '2026-05-03', 1, 'openai', 1536);   // openai
    insM.run('loc384', 'l', '2026-05-04', 1, 'local', 384);      // local minilm
    insM.run('nullprov', 'n', '2026-05-05', 1, null, null);      // NULL pprovedor mas Tem chunks
    insM.run('nulleverything', 'z', '2026-05-06', 1, null, null);// NULL pprovedor Não embeddings
    insM.run('unproc', 'u', '2026-05-07', 0, 'gemini', 768);     // is_processed=0 (live placeholder)
    insM.run('mystery', 'm', '2026-05-08', 1, 'cohere', 1024);   // UNKNOWN provedor (não em CASE mmapa

    // chunks/embeddings: give o rows that deve carry embeddings a non-NULL blob.
    const insChunk = db.prepare(
      `INSERT INTO chunks (meeting_id, chunk_index, speaker, start_timestamp_ms, end_timestamp_ms, cleaned_text, token_count, embedding)
       VALUES (?, 0, 'A', 0, 1, 'text', 1, ?)`
    );
    const blob768 = Buffer.alloc(768 * 4);
    for (const id of ['gem768', 'oll768', 'unproc', 'mystery']) insChunk.run(id, blob768);
    insChunk.run('oai1536', Buffer.alloc(1536 * 4));
    insChunk.run('loc384', Buffer.alloc(384 * 4));
    insChunk.run('nullprov', blob768); // NULL-provider Com embeddings (o critical sweep case)
    // nulleverything: a chunk linha mas NULL embedding (nada to rebuild)
    db.prepare(`INSERT INTO chunks (meeting_id, chunk_index, speaker, start_timestamp_ms, end_timestamp_ms, cleaned_text, token_count, embedding)
                VALUES ('nulleverything', 0, 'A', 0, 1, 't', 1, NULL)`).run();
  });

  afterEach(() => { db.close(); cleanup(file); });

  test('user_version ends at >= 16 after applying v16', () => {
    newDM(db).runMigrations();
    assert.ok(db.pragma('user_version', { simple: true }) >= 16);
  });

  test('embedding_space column is added + backfilled from the shared CASE map', () => {
    newDM(db).runMigrations();
    const get = (id) => db.prepare('SELECT embedding_space FROM meetings WHERE id=?').get(id).embedding_space;
    assert.equal(get('gem768'), 'gemini:gemini-embedding-001:768');
    assert.equal(get('oll768'), 'ollama:nomic-embed-text:768');
    assert.equal(get('oai1536'), 'openai:text-embedding-3-small:1536');
    assert.equal(get('loc384'), 'local:xenova/all-minilm-l6-v2:384');
  });

  test('UNKNOWN provider (not in CASE map) backfills to "<name>:unknown:<dims>"', () => {
    newDM(db).runMigrations();
    assert.equal(db.prepare("SELECT embedding_space FROM meetings WHERE id='mystery'").get().embedding_space, 'cohere:unknown:1024');
  });

  test('NULL-provider rows are LEFT NULL by backfill (provider IS NOT NULL guard)', () => {
    newDM(db).runMigrations();
    assert.equal(db.prepare("SELECT embedding_space FROM meetings WHERE id='nullprov'").get().embedding_space, null);
    assert.equal(db.prepare("SELECT embedding_space FROM meetings WHERE id='nulleverything'").get().embedding_space, null);
  });

  test('is_processed=0 row STILL gets backfilled (backfill is independent of processed state) but is excluded from the reindex sweep', () => {
    newDM(db).runMigrations();
    // Backfill keys em pprovedor não processed-state:
    assert.equal(db.prepare("SELECT embedding_space FROM meetings WHERE id='unproc'").get().embedding_space, 'gemini:gemini-embedding-001:768');
    // Mas o reindex predicate exige is_processed=1, então unproc é Não swept:
    const cnt = db.prepare(`
      SELECT COUNT(*) c FROM meetings m WHERE m.is_processed=1
      AND ((m.embedding_space IS NOT NULL AND m.embedding_space != ?)
           OR (m.embedding_space IS NULL AND EXISTS(SELECT 1 FROM chunks c WHERE c.meeting_id=m.id AND c.embedding IS NOT NULL)))
      AND m.id='unproc'
    `).get(SPACE_V2).c;
    assert.equal(cnt, 0, 'unprocessed placeholder must never be swept');
  });

  test('the v16 index idx_meetings_embedding_space exists after migration', () => {
    newDM(db).runMigrations();
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_meetings_embedding_space'").get();
    assert.ok(idx, 'composite-space index must be created');
  });

  test('RE-RUN (simulated relaunch) is idempotent: no double-application, no clobber', () => {
    const dm = newDM(db);
    dm.runMigrations(); // primeiro aplica → 16
    // Snapshot todo meeting's space após primeiro rexecuta
    const snapAfterFirst = db.prepare('SELECT id, embedding_space FROM meetings ORDER BY id').all();
    // Simulate a meeting sendo re-embedded em o active v2 space entre launches.
    db.prepare("UPDATE meetings SET embedding_space=? WHERE id='gem768'").run(SPACE_V2);

    // Re-run migrations (fresh DatabaseManager, mesmo on-disk DB) — v16 arm precisa Não
    // re-fire porque user_version é já 16, AND até if o backfill SQL ran it
    // é gated em `embedding_space IS NULL` então it cannot clobber o v2 stamp.
    const dm2 = newDM(db);
    dm2.runMigrations();
    assert.equal(db.pragma('user_version', { simple: true }), 16, 'version stays 16');
    assert.equal(
      db.prepare("SELECT embedding_space FROM meetings WHERE id='gem768'").get().embedding_space,
      SPACE_V2,
      'a row re-stamped to the active space between launches must NOT be reverted by re-migration'
    );
    // Todo outro linha unchanged de o primeiro aaplica
    const snapAfterSecond = db.prepare('SELECT id, embedding_space FROM meetings ORDER BY id').all();
    for (const r of snapAfterSecond) {
      if (r.id === 'gem768') continue;
      const before = snapAfterFirst.find(x => x.id === r.id);
      assert.equal(r.embedding_space, before.embedding_space, `row ${r.id} must be stable across re-migration`);
    }
  });

  test('post-migration, flipping active space to v2 sweeps exactly the right rows', () => {
    newDM(db).runMigrations();
    const ids = db.prepare(`
      SELECT m.id FROM meetings m WHERE m.is_processed=1
      AND ((m.embedding_space IS NOT NULL AND m.embedding_space != ?)
           OR (m.embedding_space IS NULL AND (
                EXISTS(SELECT 1 FROM chunks c WHERE c.meeting_id=m.id AND c.embedding IS NOT NULL)
                OR EXISTS(SELECT 1 FROM chunk_summaries s WHERE s.meeting_id=m.id AND s.embedding IS NOT NULL))))
      ORDER BY m.id
    `).all(SPACE_V2).map(r => r.id).sort();
    // Deve sweep: gem768, oll768, oai1536, loc384 (known-incompatible) + mystery
    // (incompatible 'cohere:unknown:1024') + nullprov (NULL space Com embeddings).
    // Deve Não sweep: nulleverything (NULL space, Não embeddings), unproc (is_processed=0).
    assert.deepEqual(ids, ['gem768', 'loc384', 'mystery', 'nullprov', 'oai1536', 'oll768']);
  });

  test('data persists across a CLOSE+REOPEN of the file (not :memory:)', () => {
    newDM(db).runMigrations();
    db.close();
    // Reopen o Mesmo arquivo — proves o ALTER + backfill eram durably committed.
    const db2 = new Database(file);
    try {
      assert.equal(db2.pragma('user_version', { simple: true }), 16);
      assert.equal(db2.prepare("SELECT embedding_space FROM meetings WHERE id='gem768'").get().embedding_space, 'gemini:gemini-embedding-001:768');
    } finally {
      db2.close();
      // Reassign então afterEach's db.close() em o original (já closed) handle é harmless.
      db = db2;
    }
  });
});
