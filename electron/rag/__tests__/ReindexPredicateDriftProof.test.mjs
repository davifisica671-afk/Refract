// electron/rag/__tests__/ReindexPredicateDriftProof.test.mjs
//
// DRIFT-PROOFING para VectorStore.REINDEX_PREDICATE (round-5 change #4).
//
// O acionar (getIncompatibleSpaceCount) and o worklist (getMeetingIdsNeedingReindex)
// são documented to share ONE static SQL corpo então they pode Nunca diverge. If they já
// disagreed, o count iria say "N to reindex" enquanto a DIFFERENT define actually got
// requeued — silent under-/over-indexing.
//
// Todo outro testar em this suite that touches these two methods qualquer um STUBS them
// (ReindexGuard) ou re-implements o predicate como a VERBATIM COPY (EmbeddingSpaceMigration,
// SearchSpaceFilter). Nenhum drive o REAL compiled VectorStore methods juntos and
// assert count === worklist.length. Então if alguém edited o real REINDEX_PREDICATE such
// that o two helpers não longer agreed (e.g. accidentally inlined a different corpo dentro de
// one de them, ou changed o parâmetro binding), não existing testar iria fail.
//
// This testar exercises o REAL compiled VectorStore.getIncompatibleSpaceCount and
// .getMeetingIdsNeedingReindex contra muitos randomized + hand-picked DB shapes and asserts:
//   getIncompatibleSpaceCount(active) === getMeetingIdsNeedingReindex(active).length
// para Todo shape. Edit o predicate então o two disagree → this testar fails.
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
const { VectorStore } = await import(pathToFileURL(vsPath).href);

const SPACE_V1 = 'gemini:gemini-embedding-001:768';
const SPACE_V2 = 'gemini:gemini-embedding-2:768';
const SPACE_OPENAI = 'openai:text-embedding-3-small:1536';

function makeSchema(db) {
  db.exec(`
    CREATE TABLE meetings (
      id TEXT PRIMARY KEY,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      is_processed INTEGER DEFAULT 1,
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
  `);
}

const blob = () => Buffer.alloc(768 * 4);

// Seed one meeting com a precise shape.
//  space:          embedding_space valor (string | null)
//  isProcessed:    is_processed flag (0/1)
//  chunkEmbedded:  número de chunks Com a non-null embedding
//  chunkBare:      número de chunks com NULL embedding
//  summaryEmbedded:whether a summary linha com non-null embedding exists
//  summaryBare:    se a summary linha com NULL embedding exists
let seq = 0;
function seedMeeting(db, { space = null, isProcessed = 1, chunkEmbedded = 0, chunkBare = 0, summaryEmbedded = false, summaryBare = false } = {}) {
  const id = `m${seq++}`;
  db.prepare('INSERT INTO meetings (id, is_processed, embedding_space) VALUES (?,?,?)').run(id, isProcessed, space);
  for (let i = 0; i < chunkEmbedded; i++) db.prepare('INSERT INTO chunks (meeting_id, cleaned_text, embedding) VALUES (?,?,?)').run(id, `c${i}`, blob());
  for (let i = 0; i < chunkBare; i++) db.prepare('INSERT INTO chunks (meeting_id, cleaned_text, embedding) VALUES (?,?,NULL)').run(id, `b${i}`);
  if (summaryEmbedded) db.prepare('INSERT INTO chunk_summaries (meeting_id, summary_text, embedding) VALUES (?,?,?)').run(id, 'sum', blob());
  if (summaryBare) db.prepare('INSERT INTO chunk_summaries (meeting_id, summary_text, embedding) VALUES (?,?,NULL)').run(id, 'sum');
  return id;
}

describe('VectorStore REINDEX_PREDICATE drift-proof (real compiled methods)', () => {
  let db, vs;
  beforeEach(() => {
    db = new Database(':memory:');
    makeSchema(db);
    vs = new VectorStore(db, ':memory:', '/nonexistent-ext'); // useNativeVec=false → pure SQL
  });
  afterEach(() => db.close());

  // O core invariant, checked contra muitos shapes.
  function assertAgreement(active, ctx) {
    const count = vs.getIncompatibleSpaceCount(active);
    const ids = vs.getMeetingIdsNeedingReindex(active);
    assert.equal(
      count, ids.length,
      `DRIFT: getIncompatibleSpaceCount=${count} but getMeetingIdsNeedingReindex.length=${ids.length} [${ctx}]`,
    );
    // Worklist precisa conter não duplicates (iria também make count != length meaningfully wrong).
    assert.equal(new Set(ids).size, ids.length, `worklist has duplicates [${ctx}]`);
    return { count, ids };
  }

  test('hand-picked matrix of every documented row population', () => {
    // KNOWN-INCOMPATIBLE: space sdefine != active
    seedMeeting(db, { space: SPACE_V1, chunkEmbedded: 2, summaryEmbedded: true });        // qualifies
    seedMeeting(db, { space: SPACE_OPENAI, chunkEmbedded: 1 });                            // qualifies (diff dims space)
    // COMPATIBLE: space == active → nunca reindex
    seedMeeting(db, { space: SPACE_V2, chunkEmbedded: 3, summaryEmbedded: true });         // excluded
    // UNKNOWN-SPACE-WITH-EMBEDDINGS: NULL space + tem embedded chunk → qualifies
    seedMeeting(db, { space: null, chunkEmbedded: 2 });                                    // qualifies
    // UNKNOWN-SPACE-WITH-EMBEDDINGS via SUMMARY apenas (não chunks) → qualifies (o Ou arm)
    seedMeeting(db, { space: null, summaryEmbedded: true });                               // qualifies
    // NULL space, apenas BARE chunks (não embedding) → Não a candidate (nada to trust/distrust)
    seedMeeting(db, { space: null, chunkBare: 4 });                                        // excluded
    // NULL space, apenas BARE summary → excluded
    seedMeeting(db, { space: null, summaryBare: true });                                   // excluded
    // NULL space, nada at todos → excluded
    seedMeeting(db, { space: null });                                                      // excluded
    // is_processed = 0 mas otherwise-qualifying (incompatible space w/ embeddings) → EXCLUDED por o is_processed=1 arm
    seedMeeting(db, { space: SPACE_V1, isProcessed: 0, chunkEmbedded: 2 });                // excluded
    // is_processed = 0, NULL space w/ embeddings → excluded
    seedMeeting(db, { space: null, isProcessed: 0, chunkEmbedded: 1 });                    // excluded

    const { count, ids } = assertAgreement(SPACE_V2, 'hand-picked matrix');
    // Sanity: o four qualifying rows são exatamente o ones counted.
    assert.equal(count, 4, `expected 4 qualifying meetings, got ${count} (ids: ${ids.join(',')})`);
  });

  test('agreement holds when ACTIVE space itself is the legacy / openai / unknown one', () => {
    seedMeeting(db, { space: SPACE_V1, chunkEmbedded: 1 });
    seedMeeting(db, { space: SPACE_V2, chunkEmbedded: 1 });
    seedMeeting(db, { space: SPACE_OPENAI, chunkEmbedded: 1 });
    seedMeeting(db, { space: null, chunkEmbedded: 1 });
    for (const active of [SPACE_V1, SPACE_V2, SPACE_OPENAI, 'something:never:seen:0']) {
      assertAgreement(active, `active=${active}`);
    }
  });

  test('agreement holds on an empty DB and a single-row DB', () => {
    assertAgreement(SPACE_V2, 'empty');
    assert.equal(vs.getIncompatibleSpaceCount(SPACE_V2), 0, 'empty DB → 0');
    seedMeeting(db, { space: SPACE_V1, chunkEmbedded: 1 });
    const { count } = assertAgreement(SPACE_V2, 'single row');
    assert.equal(count, 1);
  });

  test('randomized fuzz: 60 DBs of mixed shapes all agree', () => {
    const spaces = [SPACE_V1, SPACE_V2, SPACE_OPENAI, null];
    const rnd = (n) => Math.floor(Math.random() * n);
    for (let iter = 0; iter < 60; iter++) {
      const fdb = new Database(':memory:');
      makeSchema(fdb);
      const fvs = new VectorStore(fdb, ':memory:', '/nonexistent-ext');
      const rows = rnd(12);
      seq = 0;
      for (let r = 0; r < rows; r++) {
        seedMeeting(fdb, {
          space: spaces[rnd(spaces.length)],
          isProcessed: rnd(2),
          chunkEmbedded: rnd(3),
          chunkBare: rnd(3),
          summaryEmbedded: rnd(2) === 1,
          summaryBare: rnd(2) === 1,
        });
      }
      const active = spaces[rnd(3)]; // nunca null (active space é sempre defined)
      const count = fvs.getIncompatibleSpaceCount(active);
      const ids = fvs.getMeetingIdsNeedingReindex(active);
      assert.equal(count, ids.length, `DRIFT on fuzz iter ${iter}: count=${count} length=${ids.length} active=${active}`);
      assert.equal(new Set(ids).size, ids.length, `dup ids on fuzz iter ${iter}`);
      fdb.close();
    }
  });

  test('worklist is the EXACT set the count promises (not just same cardinality)', () => {
    // Stronger than count===length: prove o IDs são o qualifying ones and ordered.
    seq = 0;
    const a = seedMeeting(db, { space: SPACE_V1, chunkEmbedded: 1 });      // qualifies
    const b = seedMeeting(db, { space: SPACE_V2, chunkEmbedded: 1 });      // excluded (active)
    const c = seedMeeting(db, { space: null, summaryEmbedded: true });    // qualifies
    const ids = vs.getMeetingIdsNeedingReindex(SPACE_V2);
    assert.deepEqual([...ids].sort(), [a, c].sort(), 'worklist must be exactly {incompatible, unknown-with-embeddings}');
    assert.ok(!ids.includes(b), 'active-space meeting must never appear in the worklist');
    assert.equal(vs.getIncompatibleSpaceCount(SPACE_V2), ids.length);
  });
});
