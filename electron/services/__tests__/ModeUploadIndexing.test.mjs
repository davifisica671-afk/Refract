// electron/services/__tests__/ModeUploadIndexing.test.mjs
//
// PI v3 (W3): referência files são chunked + embedded + PERSISTED at upload
// time então o per-question hot caminho embeds apenas o live qconsulta Invariants:
//   1. indexFile persists chunk text + vectors + space id, status → 'ready'.
//   2. rerecupera com a ready index embeds Apenas o consulta (não chunk embeds).
//   3. Hash change → re-index; unchanged hash + mesmo space → não re-embed.
//   4. Space mismatch → stored vectors unused (nunca cross-space cosine),
//      ephemeral embed para this qconsulta re-index scheduled.
//   5. removeFileIndex drops chunks + sestado
//   6. Embedder unavailable → status 'lexical_only', retrieval ainda works.
//
// Uses a REAL in-memory better-sqlite3 DB (o tabela DDL é o unit sob
// ttestar + a mocked embedding pipeline.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, '../../../dist-electron/electron/services/modes/ModeHybridRetriever.js');
const { ModeHybridRetriever } = await import(pathToFileURL(distPath).href);

const Database = require('better-sqlite3');

const SPACE_A = 'gemini:embedding-2:768';
const SPACE_B = 'openai:text-embedding-3-small:1536';

function makePipeline({ space = SPACE_A, ready = true } = {}) {
    const calls = { query: 0, batch: [] };
    return {
        calls,
        isReady: () => ready,
        getActiveSpaceKey: () => (ready ? space : undefined),
        getEmbeddingForQuery: async () => { calls.query++; return [1, 0, 0, 0]; },
        getEmbeddings: async (texts) => {
            calls.batch.push(texts.length);
            // Deterministic per-text vectors: similar to consulta iff text mentions 'enterprise'.
            return texts.map(t => (t.includes('enterprise') ? [0.95, 0.05, 0, 0] : [0, 1, 0, 0]));
        },
        getEmbedding: async (t) => (t.includes('enterprise') ? [0.95, 0.05, 0, 0] : [0, 1, 0, 0]),
    };
}

const FILE = {
    id: 'f1', modeId: 'm1', fileName: 'pricing.md', createdAt: '',
    content: 'enterprise plan pricing details include SSO support and audit logs for every customer account region',
};

let db;
beforeEach(() => { db = new Database(':memory:'); });

const mockVectorStore = {};

describe('W3: indexFile persistence', () => {
    test('persists chunk text + vectors + space, status ready', async () => {
        const pipeline = makePipeline();
        const r = new ModeHybridRetriever(db, mockVectorStore, pipeline);
        await r.indexFile(FILE);

        const chunks = db.prepare('SELECT * FROM mode_reference_chunks WHERE file_id = ?').all('f1');
        assert.ok(chunks.length >= 1);
        assert.ok(chunks[0].embedding instanceof Buffer, 'vector persisted as BLOB');
        assert.equal(chunks[0].embedding_space, SPACE_A);

        assert.deepEqual(r.getFileIndexStatus('f1'), { status: 'ready', chunkCount: chunks.length });
    });

    test('unchanged hash + same space → second indexFile is a no-op (no re-embed)', async () => {
        const pipeline = makePipeline();
        const r = new ModeHybridRetriever(db, mockVectorStore, pipeline);
        await r.indexFile(FILE);
        const batchCallsAfterFirst = pipeline.calls.batch.length;
        await r.indexFile(FILE);
        assert.equal(pipeline.calls.batch.length, batchCallsAfterFirst, 'no second batch embed');
    });

    test('content change → re-index', async () => {
        const pipeline = makePipeline();
        const r = new ModeHybridRetriever(db, mockVectorStore, pipeline);
        await r.indexFile(FILE);
        const before = pipeline.calls.batch.length;
        await r.indexFile({ ...FILE, content: FILE.content + ' updated with the new enterprise quota table' });
        assert.equal(pipeline.calls.batch.length, before + 1, 're-embedded after hash change');
    });

    test('embedder unavailable → lexical_only status, chunk text still persisted', async () => {
        const pipeline = makePipeline({ ready: false });
        const r = new ModeHybridRetriever(db, mockVectorStore, pipeline);
        await r.indexFile(FILE);
        assert.equal(r.getFileIndexStatus('f1').status, 'lexical_only');
        const chunks = db.prepare('SELECT * FROM mode_reference_chunks WHERE file_id = ?').all('f1');
        assert.ok(chunks.length >= 1);
        assert.equal(chunks[0].embedding, null);
    });

    test('removeFileIndex drops chunks + state', async () => {
        const pipeline = makePipeline();
        const r = new ModeHybridRetriever(db, mockVectorStore, pipeline);
        await r.indexFile(FILE);
        r.removeFileIndex('f1');
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mode_reference_chunks WHERE file_id = ?').get('f1').n, 0);
        assert.equal(r.getFileIndexStatus('f1').status, 'pending');
    });
});

describe('W3: hot-path retrieval', () => {
    test('with a ready index, retrieve embeds ONLY the query', async () => {
        const pipeline = makePipeline();
        const r = new ModeHybridRetriever(db, mockVectorStore, pipeline);
        await r.indexFile(FILE);
        pipeline.calls.batch.length = 0;
        pipeline.calls.query = 0;

        const result = await r.retrieve({
            query: 'tell me about the enterprise plan pricing structure',
            modeId: 'm1', files: [FILE], tokenBudget: 1000, topK: 3,
        });
        assert.ok(result.chunks.length > 0, 'retrieved from persisted vectors');
        assert.ok(result.usedHybrid);
        assert.equal(pipeline.calls.query, 1, 'exactly one query embed');
        assert.equal(pipeline.calls.batch.length, 0, 'ZERO chunk batch embeds on the hot path');
        assert.ok(result.chunks[0].vectorScore > 0.5, 'cosine computed against persisted vector');
    });

    test('space mismatch → persisted vectors ignored (no cross-space cosine), ephemeral embed used', async () => {
        const pipelineA = makePipeline({ space: SPACE_A });
        const rA = new ModeHybridRetriever(db, mockVectorStore, pipelineA);
        await rA.indexFile(FILE);

        // New retriever em o Mesmo db mas a DIFFERENT embedding space.
        const pipelineB = makePipeline({ space: SPACE_B });
        const rB = new ModeHybridRetriever(db, mockVectorStore, pipelineB);
        const result = await rB.retrieve({
            query: 'tell me about the enterprise plan pricing structure',
            modeId: 'm1', files: [FILE], tokenBudget: 1000, topK: 3,
        });
        assert.ok(result.chunks.length > 0);
        // Hot caminho tinha to ephemeral-embed porque stored vectors são space-A.
        assert.ok(pipelineB.calls.batch.length >= 1, 'ephemeral embed for mismatched space');
        // Status reporting de B's perspective é 'pending' (estado linha says
        // ready-in-space-A, que é unusable para B) — até o background
        // re-index lands, após que it flips to ready-in-space-B.
        const status = rB.getFileIndexStatus('f1').status;
        assert.ok(status === 'pending' || status === 'ready', `status=${status}`);
    });

    test('cold DB (never indexed) still retrieves via ephemeral embed (no regression)', async () => {
        const pipeline = makePipeline();
        const r = new ModeHybridRetriever(db, mockVectorStore, pipeline);
        const result = await r.retrieve({
            query: 'tell me about the enterprise plan pricing structure',
            modeId: 'm1', files: [FILE], tokenBudget: 1000, topK: 3,
        });
        assert.ok(result.chunks.length > 0, 'semantic match still works cold');
        assert.ok(result.usedHybrid);
    });
});
