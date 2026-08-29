const fs = require('fs');
const path = require('path');
const content = `// electron/rag/VectorStore.ts
// SQLite-based vector storage with native sqlite-vec search (fallback to JS cosine similarity)
// JS fallback is offloaded to a worker_threads Worker to avoid blocking the Electron main thread.

import Database from 'better-sqlite3';
import { Worker } from 'worker_threads';
import path from 'path';
import { Chunk } from './SemanticChunker';

export interface StoredChunk extends Chunk {
    id: number;
    embedding?: number[];
}

export interface ScoredChunk extends StoredChunk {
    similarity: number;
    finalScore?: number;
}

/**
 * VectorStore - SQLite-backed vector storage
 * 
 * Uses sqlite-vec extension for native vector similarity search (O(1) per query via ANN).
 * Falls back to pure JS cosine similarity if sqlite-vec is unavailable.
 */
export class VectorStore {
    private db: Database.Database;
    private useNativeVec: boolean;
    private worker: Worker | null = null;
    private requestId = 0;
    private pendingRequests = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void; timer: ReturnType<typeof setTimeout> }>();

    private static readonly WORKER_TIMEOUT_MS = 30_000; // 30s deadman switch

    constructor(db: Database.Database) {
        this.db = db;
        this.useNativeVec = this.detectVecSupport();
    }

    /**
     * Lazily initialize the worker thread for JS fallback searches.
     * The worker is reused across all search calls.
     */
    private getWorker(): Worker {
        if (!this.worker) {
            // Resolve the compiled worker script path (dist-electron output)
            const workerPath = path.join(__dirname, 'vectorSearchWorker.js');
            this.worker = new Worker(workerPath);

            this.worker.on('message', (msg: { type: string; requestId: number; data?: any; error?: string }) => {
                const pending = this.pendingRequests.get(msg.requestId);
                if (!pending) return;
                clearTimeout(pending.timer);
                this.pendingRequests.delete(msg.requestId);

                if (msg.type === 'error') {
                    pending.reject(new Error(msg.error || 'Worker error'));
                } else {
                    pending.resolve(msg.data);
                }
            });

            this.worker.on('error', (err) => {
                console.error('[VectorStore] Worker error:', err);
                this.rejectAllPending(err);
            });

            this.worker.on('exit', (code) => {
                if (code !== 0) {
                    console.warn(\`[VectorStore] Worker exited with code \${code}\`);
                }
                this.worker = null;
                this.rejectAllPending(new Error(\`Worker exited with code \${code}\`));
            });
        }
        return this.worker;
    }

    /**
     * Reject all pending requests (used on worker crash or exit).
     */
    private rejectAllPending(err: Error): void {
        for (const [id, pending] of this.pendingRequests) {
            clearTimeout(pending.timer);
            pending.reject(err);
        }
        this.pendingRequests.clear();
    }

    /**
     * Send a message to the worker with Transferable buffers.
     * Returns a Promise with a timeout deadman switch.
     */
    private postToWorker<T>(message: any, transferList: ArrayBuffer[] = []): Promise<T> {
        // Safe requestId wrap-around
        this.requestId = (this.requestId + 1) % Number.MAX_SAFE_INTEGER;
        const id = this.requestId;
        message.requestId = id;

        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(\`[VectorStore] Worker request \${id} timed out after \${VectorStore.WORKER_TIMEOUT_MS}ms\`));
            }, VectorStore.WORKER_TIMEOUT_MS);

            this.pendingRequests.set(id, { resolve, reject, timer });
            this.getWorker().postMessage(message, transferList);
        });
    }

    /**
     * Terminate the worker thread. Call this when the VectorStore is no longer needed.
     */
    async destroy(): Promise<void> {
        if (this.worker) {
            await this.worker.terminate();
            this.worker = null;
        }
        this.rejectAllPending(new Error('VectorStore destroyed'));
    }

    /**
     * Detect if sqlite-vec vec0 tables are available
     */
    private detectVecSupport(): boolean {
        try {
            this.db.prepare("SELECT count(*) as cnt FROM vec_chunks LIMIT 1").get();
            console.log('[VectorStore] Using native sqlite-vec for vector search');
            return true;
        } catch (e: any) {
            console.warn('[VectorStore] sqlite-vec not available, using JS cosine similarity fallback. Reason:', e.message);
            return false;
        }
    }

    /**
     * Save chunks to database (without embeddings)
     */
    saveChunks(chunks: Chunk[]): number[] {
        const insert = this.db.prepare(\`
            INSERT INTO chunks (meeting_id, chunk_index, speaker, start_timestamp_ms, end_timestamp_ms, cleaned_text, token_count)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        \`);

        const ids: number[] = [];

        const insertAll = this.db.transaction(() => {
            for (const chunk of chunks) {
                const result = insert.run(
                    chunk.meetingId,
                    chunk.chunkIndex,
                    chunk.speaker,
                    chunk.startMs,
                    chunk.endMs,
                    chunk.text,
                    chunk.tokenCount
                );
                ids.push(result.lastInsertRowid as number);
            }
        });

        insertAll();
        return ids;
    }

    /**
     * Store embedding for a chunk (dual-write: BLOB column + vec0 table)
     */
    storeEmbedding(chunkId: number, embedding: number[]): void {
        const blob = this.embeddingToBlob(embedding);
        this.db.prepare('UPDATE chunks SET embedding = ? WHERE id = ?').run(blob, chunkId);

        // Also insert into vec0 virtual table for native search
        if (this.useNativeVec) {
            try {
                // sqlite-vec requires primary key to be a strict integer
                this.db.prepare(
                    'INSERT OR REPLACE INTO vec_chunks(chunk_id, embedding) VALUES (?, ?)'
                ).run(BigInt(chunkId), blob);
            } catch (e) {
                console.warn('[VectorStore] Failed to insert into vec_chunks:', e);
            }
        }
    }

    /**
     * Get chunks without embeddings for a meeting
     */
    getChunksWithoutEmbeddings(meetingId: string): StoredChunk[] {
        const rows = this.db.prepare(\`
            SELECT * FROM chunks 
            WHERE meeting_id = ? AND embedding IS NULL
            ORDER BY chunk_index ASC
        \`).all(meetingId) as any[];

        return rows.map(r => this.rowToChunk(r));
    }

    /**
     * Get all chunks for a meeting
     */
    getChunksForMeeting(meetingId: string): StoredChunk[] {
        const rows = this.db.prepare(\`
            SELECT * FROM chunks 
            WHERE meeting_id = ?
            ORDER BY chunk_index ASC
        \`).all(meetingId) as any[];

        return rows.map(r => this.rowToChunk(r));
    }

    /**
     * Search for similar chunks using native sqlite-vec or JS fallback (worker thread)
     */
    async searchSimilar(
        queryEmbedding: number[],
        options: {
            meetingId?: string;
            limit?: number;
            minSimilarity?: number;
            providerName?: string;
        } = {}
    ): Promise<ScoredChunk[]> {
        const { meetingId, limit = 8, minSimilarity = 0.25, providerName } = options;

        if (this.useNativeVec) {
            return this.searchSimilarNative(queryEmbedding, meetingId, limit, minSimilarity, providerName);
        }
        return this.searchSimilarJSWorker(queryEmbedding, meetingId, limit, minSimilarity, providerName);
    }

    /**
     * Native vec0 search — pushes similarity math into SQLite's C layer
     */
    private async searchSimilarNative(
        queryEmbedding: number[],
        meetingId: string | undefined,
        limit: number,
        minSimilarity: number,
        providerName?: string
    ): Promise<ScoredChunk[]> {
        const queryBlob = this.embeddingToBlob(queryEmbedding);

        try {
            // Fetch top-K from vec0, then join with chunks for metadata
            // We fetch more than limit to allow post-filtering by meetingId, minSimilarity, and provider
            const fetchLimit = (meetingId || providerName) ? limit * 4 : limit;

            const vecRows = this.db.prepare(\`
                SELECT chunk_id, distance
                FROM vec_chunks
                WHERE embedding MATCH ?
                ORDER BY distance
                LIMIT ?
            \`).all(queryBlob, fetchLimit) as any[];

            if (vecRows.length === 0) return [];

            // Batch-fetch chunk metadata for matched IDs
            const chunkIds = vecRows.map(r => r.chunk_id);
            const placeholders = chunkIds.map(() => '?').join(',');

            let chunkQuery = \`
                SELECT c.* 
                FROM chunks c
                JOIN meetings m ON c.meeting_id = m.id
                WHERE c.id IN (\${placeholders})
            \`;
            const params: any[] = [...chunkIds];

            if (meetingId) {
                chunkQuery += ' AND c.meeting_id = ?';
                params.push(meetingId);
            }
            if (providerName) {
                chunkQuery += ' AND m.embedding_provider = ?';
                params.push(providerName);
            }

            const chunkRows = this.db.prepare(chunkQuery).all(...params) as any[];

            // Build a lookup map for chunk data
            const chunkMap = new Map<number, any>();
            for (const row of chunkRows) {
                chunkMap.set(row.id, row);
            }

            // Combine distance scores with chunk data
            const scored: ScoredChunk[] = [];
            for (const vecRow of vecRows) {
                const chunkData = chunkMap.get(vecRow.chunk_id);
                if (!chunkData) continue;

                const similarity = 1 - vecRow.distance;
                if (similarity >= minSimilarity) {
                    scored.push({
                        ...this.rowToChunk(chunkData),
                        similarity
                    });
                }
            }

            // Already ordered by distance (ascending = best first)
            return scored.slice(0, limit);

        } catch (e) {
            console.error('[VectorStore] Native vec search failed, falling back to JS:', e);
            return this.searchSimilarJSWorker(queryEmbedding, meetingId, limit, minSimilarity, providerName);
        }
    }

    /**
     * JS fallback — Offloaded to worker thread for performance
     */
    private async searchSimilarJSWorker(
        queryEmbedding: number[],
        meetingId: string | undefined,
        limit: number,
        minSimilarity: number,
        providerName?: string
    ): Promise<ScoredChunk[]> {
        let query = \`
            SELECT c.* 
            FROM chunks c
            JOIN meetings m ON c.meeting_id = m.id
            WHERE c.embedding IS NOT NULL
        \`;
        const params: any[] = [];

        if (meetingId) {
            query += ' AND c.meeting_id = ?';
            params.push(meetingId);
        }
        if (providerName) {
            query += ' AND m.embedding_provider = ?';
            params.push(providerName);
        }

        const rows = this.db.prepare(query).all(...params) as any[];
        if (rows.length === 0) return [];

        const dim = queryEmbedding.length;
        const expectedByteLength = dim * 4; // Float32 = 4 bytes

        const rowsWithEmbeddingBuffer = rows
            .filter(r => r.embedding)
            .map(r => ({ ...r, buffer: r.embedding as Buffer }))
            .filter(r => r.buffer.byteLength === expectedByteLength); // Drop chunks from providers with different dimensions

        if (rowsWithEmbeddingBuffer.length === 0) return [];

        // Pack all embeddings into a single flat Float32Array for zero-copy transfer
        const flatEmbeddings = new Float32Array(rowsWithEmbeddingBuffer.length * dim);
        for (let i = 0; i < rowsWithEmbeddingBuffer.length; i++) {
            const blob = rowsWithEmbeddingBuffer[i].buffer;
            for (let j = 0; j < dim; j++) {
                flatEmbeddings[i * dim + j] = blob.readFloatLE(j * 4);
            }
        }

        const rowMeta = rowsWithEmbeddingBuffer.map(r => ({
            id: r.id,
            meeting_id: r.meeting_id,
            chunk_index: r.chunk_index,
            speaker: r.speaker,
            start_timestamp_ms: r.start_timestamp_ms,
            end_timestamp_ms: r.end_timestamp_ms,
            cleaned_text: r.cleaned_text,
            token_count: r.token_count
        }));

        try {
            return await this.postToWorker<ScoredChunk[]>({
                type: 'searchChunks',
                queryEmbedding: new Float32Array(queryEmbedding),
                rowCount: rowsWithEmbeddingBuffer.length,
                embeddingDim: dim,
                embeddings: flatEmbeddings,
                rowMeta,
                minSimilarity,
                limit
            }, [flatEmbeddings.buffer]); // Transfer buffer to avoid copy
        } catch (e) {
            console.error('[VectorStore] JS worker search failed:', e);
            throw e;
        }
    }

    /**
     * Delete all chunks for a meeting
     */
    deleteChunksForMeeting(meetingId: string): void {
        // Delete from vec0 first (need to get IDs)
        if (this.useNativeVec) {
            try {
                const ids = this.db.prepare(
                    'SELECT id FROM chunks WHERE meeting_id = ?'
                ).all(meetingId) as any[];

                if (ids.length > 0) {
                    const placeholders = ids.map(() => '?').join(',');
                    this.db.prepare(
                        \`DELETE FROM vec_chunks WHERE chunk_id IN (\${placeholders})\`
                    ).run(...ids.map(r => r.id));
                }
            } catch (e) {
                console.warn('[VectorStore] Failed to delete from vec_chunks:', e);
            }
        }

        this.db.prepare('DELETE FROM chunks WHERE meeting_id = ?').run(meetingId);
    }

    /**
     * Check if meeting has embeddings
     */
    hasEmbeddings(meetingId: string): boolean {
        const row = this.db.prepare(\`
            SELECT COUNT(*) as count FROM chunks 
            WHERE meeting_id = ? AND embedding IS NOT NULL
        \`).get(meetingId) as any;

        return row.count > 0;
    }

    // ============================================
    // Summary Methods (for global search)
    // ============================================

    /**
     * Save or update meeting summary
     */
    saveSummary(meetingId: string, summaryText: string): void {
        this.db.prepare(\`
            INSERT OR REPLACE INTO chunk_summaries (meeting_id, summary_text)
            VALUES (?, ?)
        \`).run(meetingId, summaryText);
    }

    /**
     * Store embedding for meeting summary (dual-write: BLOB + vec0)
     */
    storeSummaryEmbedding(meetingId: string, embedding: number[]): void {
        const blob = this.embeddingToBlob(embedding);
        this.db.prepare('UPDATE chunk_summaries SET embedding = ? WHERE meeting_id = ?').run(blob, meetingId);

        // Also insert into vec0 virtual table
        if (this.useNativeVec) {
            try {
                // Get the summary's integer ID for vec0
                const row = this.db.prepare(
                    'SELECT id FROM chunk_summaries WHERE meeting_id = ?'
                ).get(meetingId) as any;

                if (row) {
                    // sqlite-vec requires primary key to be a strict integer
                    this.db.prepare(
                        'INSERT OR REPLACE INTO vec_summaries(summary_id, embedding) VALUES (?, ?)'
                    ).run(BigInt(row.id), blob);
                }
            } catch (e) {
                console.warn('[VectorStore] Failed to insert into vec_summaries:', e);
            }
        }
    }

    /**
     * Search summaries for global queries using native vec0 or JS fallback
     */
    async searchSummaries(
        queryEmbedding: number[],
        limit: number = 5,
        providerName?: string
    ): Promise<{ meetingId: string; summaryText: string; similarity: number }[]> {
        if (this.useNativeVec) {
            return this.searchSummariesNative(queryEmbedding, limit, providerName);
        }
        return this.searchSummariesJSWorker(queryEmbedding, limit, providerName);
    }

    /**
     * Native vec0 summary search
     */
    private async searchSummariesNative(
        queryEmbedding: number[],
        limit: number,
        providerName?: string
    ): Promise<{ meetingId: string; summaryText: string; similarity: number }[]> {
        const queryBlob = this.embeddingToBlob(queryEmbedding);

        try {
            const fetchLimit = providerName ? limit * 4 : limit;
            const vecRows = this.db.prepare(\`
                SELECT summary_id, distance
                FROM vec_summaries
                WHERE embedding MATCH ?
                ORDER BY distance
                LIMIT ?
            \`).all(queryBlob, fetchLimit) as any[];

            if (vecRows.length === 0) return [];

            const ids = vecRows.map(r => r.summary_id);
            const placeholders = ids.map(() => '?').join(',');

            let summaryQuery = \`
                SELECT s.* 
                FROM chunk_summaries s
                JOIN meetings m ON s.meeting_id = m.id
                WHERE s.id IN (\${placeholders})
            \`;
            const params: any[] = [...ids];

            if (providerName) {
                summaryQuery += ' AND m.embedding_provider = ?';
                params.push(providerName);
            }

            const summaryRows = this.db.prepare(summaryQuery).all(...params) as any[];

            const summaryMap = new Map<number, any>();
            for (const row of summaryRows) {
                summaryMap.set(row.id, row);
            }

            const results: { meetingId: string; summaryText: string; similarity: number }[] = [];
            for (const vecRow of vecRows) {
                const summaryData = summaryMap.get(vecRow.summary_id);
                if (!summaryData) continue;

                results.push({
                    meetingId: summaryData.meeting_id,
                    summaryText: summaryData.summary_text,
                    similarity: 1 - vecRow.distance
                });
            }

            return results.slice(0, limit);

        } catch (e) {
            console.error('[VectorStore] Native summary search failed, falling back to JS:', e);
            return this.searchSummariesJSWorker(queryEmbedding, limit, providerName);
        }
    }

    /**
     * JS fallback summary search (Worker)
     */
    private async searchSummariesJSWorker(
        queryEmbedding: number[],
        limit: number,
        providerName?: string
    ): Promise<{ meetingId: string; summaryText: string; similarity: number }[]> {
        let query = \`
            SELECT s.* 
            FROM chunk_summaries s
            JOIN meetings m ON s.meeting_id = m.id
            WHERE s.embedding IS NOT NULL
        \`;
        const params: any[] = [];
        
        if (providerName) {
            query += ' AND m.embedding_provider = ?';
            params.push(providerName);
        }

        const rows = this.db.prepare(query).all(...params) as any[];

        const dim = queryEmbedding.length;
        const expectedByteLength = dim * 4;

        const rowsWithEmbeddingBuffer = rows
            .filter(r => r.embedding)
            .map(r => ({ ...r, buffer: r.embedding as Buffer }))
            .filter(r => r.buffer.byteLength === expectedByteLength);

        if (rowsWithEmbeddingBuffer.length === 0) return [];

        const flatEmbeddings = new Float32Array(rowsWithEmbeddingBuffer.length * dim);
        for (let i = 0; i < rowsWithEmbeddingBuffer.length; i++) {
            const blob = rowsWithEmbeddingBuffer[i].buffer;
            for (let j = 0; j < dim; j++) {
                flatEmbeddings[i * dim + j] = blob.readFloatLE(j * 4);
            }
        }

        const rowMeta = rowsWithEmbeddingBuffer.map(r => ({
            id: r.id,
            meeting_id: r.meeting_id,
            summary_text: r.summary_text
        }));

        try {
            return await this.postToWorker<{ meetingId: string; summaryText: string; similarity: number }[]>({
                type: 'searchSummaries',
                queryEmbedding: new Float32Array(queryEmbedding),
                rowCount: rowsWithEmbeddingBuffer.length,
                embeddingDim: dim,
                embeddings: flatEmbeddings,
                rowMeta,
                limit
            }, [flatEmbeddings.buffer]);
        } catch (e) {
             console.error('[VectorStore] JS worker summary search failed:', e);
             throw e;
        }
    }

    // ============================================
    // Re-indexing Utilities
    // ============================================

    /**
     * Get count of meetings with incompatible embeddings
     */
    getIncompatibleMeetingsCount(providerName: string): number {
        const row = this.db.prepare(\`
            SELECT COUNT(*) as count FROM meetings 
            WHERE embedding_provider IS NOT NULL 
            AND embedding_provider != ?
            AND is_processed = 1
        \`).get(providerName) as any;

        return row.count || 0;
    }

    /**
     * Delete embeddings for meetings to prep for re-indexer
     */
    deleteEmbeddingsForMeetings(providerName: string): string[] {
        // Find incompatible meetings
        const rows = this.db.prepare(\`
            SELECT id FROM meetings 
            WHERE embedding_provider IS NOT NULL 
            AND embedding_provider != ?
            AND is_processed = 1
        \`).all(providerName) as any[];

        const meetingIds = rows.map(r => r.id);
        if (meetingIds.length === 0) return [];

        for (const id of meetingIds) {
            // Nullify embeddings
            this.db.prepare('UPDATE chunks SET embedding = NULL WHERE meeting_id = ?').run(id);
            this.db.prepare('UPDATE chunk_summaries SET embedding = NULL WHERE meeting_id = ?').run(id);
            this.db.prepare('UPDATE meetings SET embedding_provider = NULL, embedding_dimensions = NULL WHERE id = ?').run(id);

            // Delete from vec0 tables
            if (this.useNativeVec) {
                try {
                    const cIds = this.db.prepare('SELECT id FROM chunks WHERE meeting_id = ?').all(id) as any[];
                    if (cIds.length > 0) {
                        const placeholders = cIds.map(() => '?').join(',');
                        this.db.prepare(\`DELETE FROM vec_chunks WHERE chunk_id IN (\${placeholders})\`).run(...cIds.map(r => r.id));
                    }

                    const sIds = this.db.prepare('SELECT id FROM chunk_summaries WHERE meeting_id = ?').get(id) as any;
                    if (sIds) {
                         this.db.prepare(\`DELETE FROM vec_summaries WHERE summary_id = ?\`).run(sIds.id);
                    }
                } catch (e) {}
            }
        }
        return meetingIds;
    }


    // ============================================
    // Private Helpers
    // ============================================

    private rowToChunk(row: any): StoredChunk {
        return {
            id: row.id,
            meetingId: row.meeting_id,
            chunkIndex: row.chunk_index,
            speaker: row.speaker,
            startMs: row.start_timestamp_ms,
            endMs: row.end_timestamp_ms,
            text: row.cleaned_text,
            tokenCount: row.token_count,
            embedding: undefined // Explicitly avoiding buffer parsing unless needed
        };
    }

    /**
     * Convert embedding array to binary BLOB (Float32)
     */
    private embeddingToBlob(embedding: number[]): Buffer {
        const buffer = Buffer.alloc(embedding.length * 4);
        for (let i = 0; i < embedding.length; i++) {
            buffer.writeFloatLE(embedding[i], i * 4);
        }
        return buffer;
    }

}
`;

const outputPath = path.join(__dirname, '../electron/rag/VectorStore.ts');
fs.writeFileSync(outputPath, content, 'utf8');
console.log('[VectorStoreRebuild] Written to', outputPath);
