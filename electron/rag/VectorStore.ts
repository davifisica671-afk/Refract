/**
 * @file VectorStore.ts
 * @description Armazenamento vetorial baseado em SQLite para o pipeline RAG.
 * Utiliza a extensão sqlite-vec para busca nativa de similaridade vetorial (ANN).
 * Caso a extensão não esteja disponível, faz fallback para cálculo de similaridade
 * cosseno em JavaScript via worker thread, evitando bloqueio da thread principal
 * do Electron. Gerencia armazenamento, busca e limpeza de blocos e resumos vetoriais.
 */

// electron/rag/VectorStore.ts
// SQLite-based vector storage com native sqlite-vec busca (fallback para JS cosine similarity)
// JS alternativa é offloaded para a worker_threads Worker para avoid blocking o Electron principal tthread

import Database from 'better-sqlite3';
import { Worker } from 'worker_threads';
import path from 'path';
import fs from 'fs';
import { Chunk } from './SemanticChunker';
import { DatabaseManager } from '../db/DatabaseManager';

/** Bloco de transcrição armazenado com ID e embedding opcional */
export interface StoredChunk extends Chunk {
    id: number;
    embedding?: number[];
}

/** Bloco com pontuação de similaridade para resultados de busca */
export interface ScoredChunk extends StoredChunk {
    similarity: number;
    finalScore?: number;
}

/**
 * Armazenamento vetorial baseado em SQLite para o pipeline RAG.
 * Utiliza sqlite-vec para busca nativa ou fallback para JavaScript.
 */
export class VectorStore {
    private db: Database.Database;
    private dbPath: string;
    private extPath: string;
    private useNativeVec: boolean;
    private worker: Worker | null = null;
    private requestId = 0;
    private pendingRequests = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void; timer: ReturnType<typeof setTimeout> }>();

    private static readonly WORKER_TIMEOUT_MS = 30_000; // 30s deadman trocar

    constructor(db: Database.Database, dbPath: string, extPath: string) {
        this.db = db;
        this.dbPath = dbPath;
        this.extPath = extPath;
        this.useNativeVec = this.detectVecSupport();
    }

    /** Resolve o caminho do arquivo do worker de busca vetorial */
    private getWorkerPath(): string {
        const candidates = [
            path.join(__dirname, 'vectorSearchWorker.js'),
            path.join(__dirname, 'rag', 'vectorSearchWorker.js'),
            path.join(__dirname, 'electron', 'rag', 'vectorSearchWorker.js'),
        ];

        // Encontra o primeiro caminho que actually exists
        let resolvedPath = candidates.find(p => fs.existsSync(p)) ?? candidates[0];

        // Mapa para unpacked caminho se executando dentro packaged ASAR
        if (resolvedPath.includes('app.asar') && !resolvedPath.includes('app.asar.unpacked')) {
            resolvedPath = resolvedPath.replace('app.asar', 'app.asar.unpacked');
        }

        console.log('[VectorStore] Resolved vectorSearchWorker path to:', resolvedPath);
        return resolvedPath;
    }

    /** Inicializa preguiçosamente o worker thread para buscas em JavaScript */
    private getWorker(): Worker {
        if (!this.worker) {
            // Resolve o compiled worker script caminho (dist-electron osaída
            const workerPath = this.getWorkerPath();
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
                    console.warn(`[VectorStore] Worker exited with code ${code}`);
                }
                this.worker = null;
                this.rejectAllPending(new Error(`Worker exited with code ${code}`));
            });
        }
        return this.worker;
    }

    /** Rejeita todas as requisições pendentes (usado em caso de erro do worker) */
    private rejectAllPending(err: Error): void {
        for (const [id, pending] of this.pendingRequests) {
            clearTimeout(pending.timer);
            pending.reject(err);
        }
        this.pendingRequests.clear();
    }

    /** Envia mensagem para o worker com buffers Transferable e timeout */
    private postToWorker<T>(message: any, transferList: ArrayBuffer[] = []): Promise<T> {
        // Safe requestId wrap-around
        this.requestId = (this.requestId + 1) % Number.MAX_SAFE_INTEGER;
        const id = this.requestId;
        message.requestId = id;

        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`[VectorStore] Worker request ${id} timed out after ${VectorStore.WORKER_TIMEOUT_MS}ms`));
            }, VectorStore.WORKER_TIMEOUT_MS);

            this.pendingRequests.set(id, { resolve, reject, timer });
            this.getWorker().postMessage(message, transferList);
        });
    }

    /** Termina o worker thread e limpa requisições pendentes */
    async destroy(): Promise<void> {
        if (this.worker) {
            await this.worker.terminate();
            this.worker = null;
        }
        this.rejectAllPending(new Error('VectorStore destroyed'));
    }

    /** Detecta se a extensão sqlite-vec está disponível no banco de dados */
    private detectVecSupport(): boolean {
        try {
            this.db.prepare("SELECT count(*) as cnt FROM vec_chunks_768 LIMIT 1").get();
            console.log('[VectorStore] Using native sqlite-vec for vector search');
            return true;
        } catch (e: any) {
            console.warn('[VectorStore] sqlite-vec not available, using JS cosine similarity fallback. Reason:', e.message);
            return false;
        }
    }

    /** Salva blocos no banco de dados (sem embeddings) */
    saveChunks(chunks: Chunk[]): number[] {
        const insert = this.db.prepare(`
            INSERT INTO chunks (meeting_id, chunk_index, speaker, start_timestamp_ms, end_timestamp_ms, cleaned_text, token_count)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

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

    /** Armazena embedding para um bloco (escrita dupla: coluna BLOB + tabela vec0) */
    storeEmbedding(chunkId: number, embedding: number[]): void {
        const blob = this.embeddingToBlob(embedding);
        this.db.prepare('UPDATE chunks SET embedding = ? WHERE id = ?').run(blob, chunkId);

        // Também insere dentro de o dimension-specific vec0 virtual tabela para native busca
        if (this.useNativeVec) {
            const dim = embedding.length;
            // Lazily provision o tabela se it's a novel dimension (e.g., a novo pprovedor
            DatabaseManager.getInstance().ensureVecTableForDim(dim);
            try {
                this.db.prepare(
                    `INSERT OR REPLACE INTO vec_chunks_${dim}(chunk_id, embedding) VALUES (?, ?)`
                ).run(BigInt(chunkId), blob);
            } catch (e) {
                console.warn(`[VectorStore] Failed to insert into vec_chunks_${dim}:`, e);
            }
        }
    }

    /** Retorna blocos sem embeddings para uma reunião */
    getChunksWithoutEmbeddings(meetingId: string): StoredChunk[] {
        const rows = this.db.prepare(`
            SELECT * FROM chunks 
            WHERE meeting_id = ? AND embedding IS NULL
            ORDER BY chunk_index ASC
        `).all(meetingId) as any[];

        return rows.map(r => this.rowToChunk(r));
    }

    /** Retorna todos os blocos de uma reunião */
    getChunksForMeeting(meetingId: string): StoredChunk[] {
        const rows = this.db.prepare(`
            SELECT * FROM chunks 
            WHERE meeting_id = ?
            ORDER BY chunk_index ASC
        `).all(meetingId) as any[];

        return rows.map(r => this.rowToChunk(r));
    }

    /** Busca blocos similares usando sqlite-vec nativo ou fallback JavaScript */
    async searchSimilar(
        queryEmbedding: number[],
        options: {
            meetingId?: string;
            limit?: number;
            minSimilarity?: number;
            spaceKey?: string;
        } = {}
    ): Promise<ScoredChunk[]> {
        const { meetingId, limit = 8, minSimilarity = 0.25, spaceKey } = options;

        // Hard invariant: sem an ativo space we retorna Nada em vez than
        // leaking todo space. O downstream filtrar é `if (spaceKey)`, então omitting
        // it iria caso contrário corresponder Todos spaces e silently reintroduce o v1/v2 leak.
        // Em o live consulta caminho spaceKey é sempre defined (provider.space é a
        // non-empty readonly ststring isso guards future callers.
        if (!spaceKey) {
            console.warn('[VectorStore] searchSimilar called without an active spaceKey — returning empty (refusing to search across embedding spaces).');
            return [];
        }

        if (this.useNativeVec) {
            return this.searchSimilarNative(queryEmbedding, meetingId, limit, minSimilarity, spaceKey);
        }
        return this.searchSimilarJSWorker(queryEmbedding, meetingId, limit, minSimilarity, spaceKey);
    }

    /** Busca nativa via vec0 — totalmente delegada ao worker thread */
    private async searchSimilarNative(
        queryEmbedding: number[],
        meetingId: string | undefined,
        limit: number,
        minSimilarity: number,
        spaceKey?: string
    ): Promise<ScoredChunk[]> {
        const queryBlob = this.embeddingToBlob(queryEmbedding);
        const dim = queryEmbedding.length;
        try {
            return await this.postToWorker<ScoredChunk[]>({
                type: 'nativeVecSearch',
                dbPath: this.dbPath,
                extPath: this.extPath,
                queryBlob,
                dim,
                meetingId,
                spaceKey,
                limit,
                minSimilarity,
                fetchMultiplier: 4
            });
        } catch (e) {
            console.error('[VectorStore] Native vec search (worker) failed, falling back to JS:', e);
            return this.searchSimilarJSWorker(queryEmbedding, meetingId, limit, minSimilarity, spaceKey);
        }
    }

    /** Busca por similaridade cosseno em JavaScript via worker thread */
    private async searchSimilarJSWorker(
        queryEmbedding: number[],
        meetingId: string | undefined,
        limit: number,
        minSimilarity: number,
        spaceKey?: string
    ): Promise<ScoredChunk[]> {
        let query = `
            SELECT c.*
            FROM chunks c
            JOIN meetings m ON c.meeting_id = m.id
            WHERE c.embedding IS NOT NULL
        `;
        const params: any[] = [];

        if (meetingId) {
            query += ' AND c.meeting_id = ?';
            params.push(meetingId);
        }
        // Filtrar por composite embedding SPACE, não provedor nnome O byteLength verifica
        // abaixo apenas exclui DIFFERENT-dimension vectors — it cannot tell v1 768d de
        // v2 768d (mesmas dimensões, espaço incompatível). Sem isso, os vetores v1 seriam
        // cosine-compared contra v2 queries. NULL space (não ainda stamped / mid-reindex)
        // é intentionally excluded → "empty, não wrong".
        if (spaceKey) {
            query += ' AND m.embedding_space = ?';
            params.push(spaceKey);
        }

        const rows = this.db.prepare(query).all(...params) as any[];
        if (rows.length === 0) return [];

        const dim = queryEmbedding.length;
        const expectedByteLength = dim * 4; // FlFlutuante = 4 bytes

        const rowsWithEmbeddingBuffer = rows
            .filter(r => r.embedding)
            .map(r => ({ ...r, buffer: r.embedding as Buffer }))
            .filter(r => r.buffer.byteLength === expectedByteLength); // Soltar chunks de providers com different dimensions

        if (rowsWithEmbeddingBuffer.length === 0) return [];

        // Pack todos embeddings dentro de a único flat Float32Array para zero-copy transfer
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

    /** Exclui todos os blocos de uma reunião (incluindo tabelas de dimensões) */
    deleteChunksForMeeting(meetingId: string): void {
        if (this.useNativeVec) {
            try {
                const ids = this.db.prepare(
                    'SELECT id FROM chunks WHERE meeting_id = ?'
                ).all(meetingId) as any[];

                if (ids.length > 0) {
                    const placeholders = ids.map(() => '?').join(',');
                    const idList = ids.map(r => r.id);
                    // Exclui de todos known dimension-specific vec0 tables
                    for (const dim of DatabaseManager.getInstance().getExistingVecDims()) {
                        try {
                            this.db.prepare(
                                `DELETE FROM vec_chunks_${dim} WHERE chunk_id IN (${placeholders})`
                            ).run(...idList);
                        } catch (_) { /* dim tabela pode não exist */ }
                    }
                }
            } catch (e) {
                console.warn('[VectorStore] Failed to delete from vec_chunks dimension tables:', e);
            }
        }

        this.db.prepare('DELETE FROM chunks WHERE meeting_id = ?').run(meetingId);
    }

    /** Verifica se uma reunião possui embeddings */
    hasEmbeddings(meetingId: string): boolean {
        const row = this.db.prepare(`
            SELECT COUNT(*) as count FROM chunks 
            WHERE meeting_id = ? AND embedding IS NOT NULL
        `).get(meetingId) as any;

        return row.count > 0;
    }

    /**
     * Backfill embedding_provider metadata para meetings que have embedded chunks
     * mas a NULL embedding_provider column.
     *
     * This is a one-time migration para meetings que were embedded antes the
     * provider metadata write was introduced (or se o write silently failed).
     * It is safe para chamar on todo startup — it apenas touches rows where
     * embedding_provider IS NULL e o meeting has at least one embedded chunk.
     *
     * @param providerName The ativo embedding provider nome (e.g. "local", "openai")
     * @param dimensions   The provider's embedding dimensions (e.g. 384, 1536)
     *
     * IMPORTANT: This deliberately does NOT stamp `embedding_space`. We cannot
     * prove a NULL-provider row's vectors were produced by o *current* model —
     * depois a model upgrade they may be in an OLD, incompatible space (e.g. v1
     * 768d enquanto ativo is v2 768d). Stamping o ativo space here would mislabel
     * them as compatible e they'd nunca be re-indexed → silent garbage similarity.
     * Instead we leave `embedding_space` NULL; o auto-reindex sweep treats
     * NULL-space-with-embeddings rows as unknown-space e safely re-embeds them.
     */
    backfillEmbeddingProviderMetadata(providerName: string, dimensions: number): number {
        try {
            // Stamp provider/dims para legacy diagnostic valor oapenas Space stays NULL
            // em purpose (see método doc) então o re-index sweep owns o decision.
            const affected = this.db.prepare(`
                UPDATE meetings
                SET embedding_provider = ?, embedding_dimensions = ?
                WHERE embedding_provider IS NULL
                  AND id IN (
                      SELECT DISTINCT meeting_id FROM chunks WHERE embedding IS NOT NULL
                  )
            `).run(providerName, dimensions);

            if (affected.changes > 0) {
                console.log(`[VectorStore] Backfilled provider metadata for ${affected.changes} meeting(s) (space left NULL for re-index sweep)`);
            }
            return affected.changes;
        } catch (e) {
            console.warn('[VectorStore] Failed to backfill embedding_provider metadata:', e);
            return 0;
        }
    }

    // ============================================
    // Summary Methods (para global sbusca
    // ============================================

    /** Salva ou atualiza o resumo de uma reunião */
    saveSummary(meetingId: string, summaryText: string): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO chunk_summaries (meeting_id, summary_text)
            VALUES (?, ?)
        `).run(meetingId, summaryText);
    }

    /** Armazena embedding para o resumo da reunião (escrita dupla: BLOB + vec0) */
    storeSummaryEmbedding(meetingId: string, embedding: number[]): void {
        const blob = this.embeddingToBlob(embedding);
        this.db.prepare('UPDATE chunk_summaries SET embedding = ? WHERE meeting_id = ?').run(blob, meetingId);

        if (this.useNativeVec) {
            try {
                const row = this.db.prepare(
                    'SELECT id FROM chunk_summaries WHERE meeting_id = ?'
                ).get(meetingId) as any;

                if (row) {
                    const dim = embedding.length;
                    DatabaseManager.getInstance().ensureVecTableForDim(dim);
                    this.db.prepare(
                        `INSERT OR REPLACE INTO vec_summaries_${dim}(summary_id, embedding) VALUES (?, ?)`
                    ).run(BigInt(row.id), blob);
                }
            } catch (e) {
                console.warn('[VectorStore] Failed to insert into vec_summaries dim table:', e);
            }
        }
    }

    /** Marca o espaço/provedor/dimensões de uma reunião se ainda não definido */
    stampMeetingSpaceIfUnset(meetingId: string, providerName: string, dimensions: number, space: string): void {
        try {
            this.db.prepare(
                'UPDATE meetings SET embedding_provider = ?, embedding_dimensions = ?, embedding_space = ? WHERE id = ? AND embedding_space IS NULL'
            ).run(providerName, dimensions, space, meetingId);
        } catch (e) {
            // Non-fatal — re-index sweep vai capturar an unstamped meeting ldepois
        }
    }

    /** Busca resumos para consultas globais usando vec0 nativo ou fallback JavaScript */
    async searchSummaries(
        queryEmbedding: number[],
        limit: number = 5,
        spaceKey?: string
    ): Promise<{ meetingId: string; summaryText: string; similarity: number }[]> {
        // Mesmo hard invariant como searchSimilar: não ativo space → retorna nada
        // em vez than leaking todo space (see searchSimilar para rationale).
        if (!spaceKey) {
            console.warn('[VectorStore] searchSummaries called without an active spaceKey — returning empty.');
            return [];
        }
        if (this.useNativeVec) {
            return this.searchSummariesNative(queryEmbedding, limit, spaceKey);
        }
        return this.searchSummariesJSWorker(queryEmbedding, limit, spaceKey);
    }

    /** Busca nativa de resumos via vec0 — delegada ao worker thread */
    private async searchSummariesNative(
        queryEmbedding: number[],
        limit: number,
        spaceKey?: string
    ): Promise<{ meetingId: string; summaryText: string; similarity: number }[]> {
        const queryBlob = this.embeddingToBlob(queryEmbedding);
        const dim = queryEmbedding.length;
        try {
            return await this.postToWorker<{ meetingId: string; summaryText: string; similarity: number }[]>({
                type: 'nativeVecSearchSummaries',
                dbPath: this.dbPath,
                extPath: this.extPath,
                queryBlob,
                dim,
                spaceKey,
                limit
            });
        } catch (e) {
            console.error('[VectorStore] Native summary search (worker) failed, falling back to JS:', e);
            return this.searchSummariesJSWorker(queryEmbedding, limit, spaceKey);
        }
    }

    /**
     * JS alternativa summary pesquisar (Worker)
     */
    private async searchSummariesJSWorker(
        queryEmbedding: number[],
        limit: number,
        spaceKey?: string
    ): Promise<{ meetingId: string; summaryText: string; similarity: number }[]> {
        // Filtrar por composite embedding SPACE, não provedor nome (see searchSimilarJSWorker).
        // O byte-length dimension verifica abaixo cannot distinguish v1 768d de v2 768d.
        // NULL space é intentionally excluded → "empty, não wrong".
        let query = `
            SELECT s.*
            FROM chunk_summaries s
            JOIN meetings m ON s.meeting_id = m.id
            WHERE s.embedding IS NOT NULL
        `;
        const params: any[] = [];
        if (spaceKey) {
            query += ' AND m.embedding_space = ?';
            params.push(spaceKey);
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
     * Get count of meetings whose embeddings deve be rebuilt para o ativo space.
     *
     * Two populations qualify:
     *  1. KNOWN-INCOMPATIBLE: embedding_space is set e differs de active
     *     (e.g. gemini-embedding-001 768d enquanto ativo is gemini-embedding-2 768d —
     *     mesmo name/dims, diferente space; o whole reason space keys on the
     *     composite `${name}:${model}:${dims}`, see embeddingSpace.ts).
     *  2. UNKNOWN-SPACE-WITH-EMBEDDINGS: embedding_space IS NULL mas o meeting
     *     has stored embeddings (legacy rows, ou pre-metadata embeds). We cannot
     *     prove these are in o ativo space, so they MUST be re-embedded rather
     *     than trusted — trusting them is exactly o silent-garbage hazard.
     */
    /**
     * Shared WHERE corpo identifying meetings que precisa re-embedding para o active
     * space. Two populations: (1) KNOWN-INCOMPATIBLE — embedding_space set e !=
     * ativo (e.g. gemini-embedding-001 768d vs ativo -2 768d; o whole reason
     * space keys on o composite `${name}:${model}:${dims}`). (2) UNKNOWN-SPACE-
     * WITH-EMBEDDINGS — embedding_space NULL mas o meeting has stored vectors
     * (legacy / pre-metadata); we can't prove they're in o ativo space so they
     * MUST be re-embedded, não trusted.
     *
     * SINGLE SOURCE so getIncompatibleSpaceCount (the trigger) and
     * getMeetingIdsNeedingReindex (the worklist) pode NEVER drift — a mismatch would
     * make o count say "N para reindex" enquanto a diferente set actually gets requeued.
     * The bound parâmetro is `activeSpace` (the `!= ?` placeholder).
     */
    private static readonly REINDEX_PREDICATE = `
        m.is_processed = 1
        AND (
            (m.embedding_space IS NOT NULL AND m.embedding_space != ?)
            OR (m.embedding_space IS NULL AND (
                EXISTS (SELECT 1 FROM chunks c WHERE c.meeting_id = m.id AND c.embedding IS NOT NULL)
                OR EXISTS (SELECT 1 FROM chunk_summaries s WHERE s.meeting_id = m.id AND s.embedding IS NOT NULL)
            ))
        )
    `;

    /** Retorna contagem de reuniões que precisam de re-embedding para o espaço ativo */
    getIncompatibleSpaceCount(activeSpace: string): number {
        const row = this.db.prepare(
            `SELECT COUNT(*) as count FROM meetings m WHERE ${VectorStore.REINDEX_PREDICATE}`
        ).get(activeSpace) as any;

        return row.count || 0;
    }

    /** Retorna IDs das reuniões que precisam de re-embedding (seleção, sem mutação) */
    getMeetingIdsNeedingReindex(activeSpace: string): string[] {
        const rows = this.db.prepare(
            `SELECT m.id FROM meetings m WHERE ${VectorStore.REINDEX_PREDICATE} ORDER BY m.created_at DESC`
        ).all(activeSpace) as any[];
        return rows.map(r => r.id);
    }

    /** Exclui embeddings de reuniões cujo espaço difere do ativo */
    deleteEmbeddingsForSpace(activeSpace: string): string[] {
        const meetingIds = this.getMeetingIdsNeedingReindex(activeSpace);
        if (meetingIds.length === 0) return [];

        for (const id of meetingIds) {
            // Nullify embeddings
            this.db.prepare('UPDATE chunks SET embedding = NULL WHERE meeting_id = ?').run(id);
            this.db.prepare('UPDATE chunk_summaries SET embedding = NULL WHERE meeting_id = ?').run(id);
            this.db.prepare('UPDATE meetings SET embedding_provider = NULL, embedding_dimensions = NULL, embedding_space = NULL WHERE id = ?').run(id);

            // Exclui de per-dimension vec0 tables
            if (this.useNativeVec) {
                try {
                    const cIds = this.db.prepare('SELECT id FROM chunks WHERE meeting_id = ?').all(id) as any[];
                    if (cIds.length > 0) {
                        const placeholders = cIds.map(() => '?').join(',');
                        const idList = cIds.map(r => r.id);
                        for (const dim of DatabaseManager.getInstance().getExistingVecDims()) {
                            try {
                                this.db.prepare(`DELETE FROM vec_chunks_${dim} WHERE chunk_id IN (${placeholders})`).run(...idList);
                            } catch (_) { /* dim tabela pode não exist */ }
                        }
                    }

                    const sIds = this.db.prepare('SELECT id FROM chunk_summaries WHERE meeting_id = ?').get(id) as any;
                    if (sIds) {
                        for (const dim of DatabaseManager.getInstance().getExistingVecDims()) {
                            try {
                                this.db.prepare(`DELETE FROM vec_summaries_${dim} WHERE summary_id = ?`).run(sIds.id);
                            } catch (_) { /* dim tabela pode não exist */ }
                        }
                    }
                } catch (e) {
                    console.warn(`[VectorStore] deleteEmbeddingsForSpace: vec0 cleanup failed for meeting ${id}:`, e);
                }
            }
        }
        return meetingIds;
    }


    /** Limpa embeddings de uma única reunião sem excluir os blocos */
    clearEmbeddingsForMeeting(meetingId: string): void {
        // Wipe embedding blobs de chunks e summaries
        this.db.prepare('UPDATE chunks SET embedding = NULL WHERE meeting_id = ?').run(meetingId);
        this.db.prepare('UPDATE chunk_summaries SET embedding = NULL WHERE meeting_id = ?').run(meetingId);

        // Reinicia provedor metadados então it obtém re-assigned por o alternativa provedor
        this.db.prepare(
            'UPDATE meetings SET embedding_provider = NULL, embedding_dimensions = NULL, embedding_space = NULL WHERE id = ?'
        ).run(meetingId);

        // Exclui rows de todos per-dimension vec0 tables
        if (this.useNativeVec) {
            try {
                const cIds = this.db.prepare('SELECT id FROM chunks WHERE meeting_id = ?').all(meetingId) as any[];
                if (cIds.length > 0) {
                    const placeholders = cIds.map(() => '?').join(',');
                    const idList = cIds.map(r => r.id);
                    for (const dim of DatabaseManager.getInstance().getExistingVecDims()) {
                        try {
                            this.db.prepare(
                                `DELETE FROM vec_chunks_${dim} WHERE chunk_id IN (${placeholders})`
                            ).run(...idList);
                        } catch (_) { /* dim tabela pode não exist */ }
                    }
                }

                const sRow = this.db.prepare('SELECT id FROM chunk_summaries WHERE meeting_id = ?').get(meetingId) as any;
                if (sRow) {
                    for (const dim of DatabaseManager.getInstance().getExistingVecDims()) {
                        try {
                            this.db.prepare(`DELETE FROM vec_summaries_${dim} WHERE summary_id = ?`).run(sRow.id);
                        } catch (_) { /* dim tabela pode não exist */ }
                    }
                }
            } catch (e) {
                console.warn('[VectorStore] clearEmbeddingsForMeeting: error deleting from vec0 tables:', e);
            }
        }

        console.log(`[VectorStore] Cleared embeddings for meeting ${meetingId} (chunks preserved for re-embedding)`);
    }

    // ============================================
    // Private Helpers
    // ============================================

    /** Converte uma linha do banco para o formato StoredChunk */
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
            embedding: undefined // Explicitly avoiding buffer parsing a menos que needed
        };
    }

    /** Converte array de embedding para BLOB binário (Float32) */
    private embeddingToBlob(embedding: number[]): Buffer {
        const buffer = Buffer.alloc(embedding.length * 4);
        for (let i = 0; i < embedding.length; i++) {
            buffer.writeFloatLE(embedding[i], i * 4);
        }
        return buffer;
    }

}
