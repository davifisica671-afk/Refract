/**
 * @file vectorSearchWorker.ts
 * @description Worker thread para offloading de computação de busca vetorial.
 * Gerencia duas estratégias de busca:
 *   1. nativeVecSearch / nativeSummarySearch: abre sua própria conexão DB
 *      somente leitura e usa sqlite-vec no worker (evita bloquear o loop
 *      de eventos da thread principal).
 *   2. searchChunks / searchSummaries: similaridade cosseno pura em JavaScript
 *      sobre blobs Float32 pré-carregados.
 * Todas as respostas são enviadas como { tipo 'result' | 'error', requestId, data? }.
 */

// electron/rag/vectorSearchWorker.ts
// Worker thread para offloading Todos vector busca computation de o Electron principal tthread
//
// Gerencia TWO busca strategies:
//   1. nativeVecSearch / nativeSummarySearch: abre its próprio read-only DB conexão
//      e calls sqlite-vec em o worker (avoids blocking o principal thread's evento loop).
//   2. searchChunks / searchSummaries: pure-JS cosine similarity em pre-fetched FlFlutuante blobs.
//
// Todos responses são sent voltar como { ttipo 'result' | 'error', requestId, data? }.

import { parentPort } from 'worker_threads';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import path from 'path';

interface NativeVecSearchChunksMessage {
    type: 'nativeVecSearch';
    requestId: number;
    dbPath: string;
    extPath: string; // caminho to sqlite-vec extensão (sem plataforma suffix)
    queryBlob: Buffer;
    dim: number;        // embedding dimension — seleciona vec_chunks_{dim} tabela
    meetingId?: string;
    spaceKey?: string;  // active embedding space — filtra m.embedding_space (Não provedor nnome
    limit: number;
    minSimilarity: number;
    fetchMultiplier: number;
}

interface NativeVecSearchSummariesMessage {
    type: 'nativeVecSearchSummaries';
    requestId: number;
    dbPath: string;
    extPath: string;
    queryBlob: Buffer;
    dim: number;        // embedding dimension — seleciona vec_summaries_{dim} tabela
    spaceKey?: string;  // active embedding space — filtra m.embedding_space (Não provedor nnome
    limit: number;
}

interface SearchChunksMessage {
    type: 'searchChunks';
    requestId: number;
    queryEmbedding: Float32Array;  // Transferred, não copied
    rowCount: number;
    embeddingDim: number;
    embeddings: Float32Array;      // Flat bbuffer N rows × D dims, transferred
    rowMeta: Array<{               // Lightweight metadados (não embedding copy)
        id: number;
        meeting_id: string;
        chunk_index: number;
        speaker: string;
        start_timestamp_ms: number;
        end_timestamp_ms: number;
        cleaned_text: string;
        token_count: number;
    }>;
    minSimilarity: number;
    limit: number;
}

interface SearchSummariesMessage {
    type: 'searchSummaries';
    requestId: number;
    queryEmbedding: Float32Array;
    rowCount: number;
    embeddingDim: number;
    embeddings: Float32Array;
    rowMeta: Array<{
        id: number;
        meeting_id: string;
        summary_text: string;
    }>;
    limit: number;
}

type WorkerMessage = NativeVecSearchChunksMessage | NativeVecSearchSummariesMessage | SearchChunksMessage | SearchSummariesMessage;

// ============================================
// Auxiliares matemáticos — operam diretamente em fatias Float32Array
// ============================================

/** Calcula similaridade cosseno entre dois vetores Float32Array */
function cosineSimilarityF32(
    a: Float32Array,
    b: Float32Array,
    bOffset: number,
    dim: number
): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < dim; i++) {
        const ai = a[i];
        const bi = b[bOffset + i];
        dotProduct += ai * bi;
        normA += ai * ai;
        normB += bi * bi;
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
}

// ============================================
// Manipulador de mensagens
// ============================================

if (!parentPort) {
    throw new Error('vectorSearchWorker must be run as a worker_threads Worker');
}

// Cache de conexões DB por caminho para evitar reabertura em cada chamada
const dbCache = new Map<string, Database.Database>();

/** Abre (ou reutiliza) uma conexão DB somente leitura com sqlite-vec */
function getDb(dbPath: string, extPath: string): Database.Database {
    if (dbCache.has(dbPath)) return dbCache.get(dbPath)!;
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
        db.loadExtension(extPath);
    } catch (e) {
        // Extensão pode já ser loaded ou unavailable; proceed anyway.
    }
    dbCache.set(dbPath, db);
    return db;
}

parentPort.on('message', (message: WorkerMessage) => {
    try {
        switch (message.type) {
            case 'searchChunks': {
                const { requestId, queryEmbedding, embeddings, embeddingDim, rowMeta, minSimilarity, limit } = message;
                const scored: Array<{
                    id: number;
                    meetingId: string;
                    chunkIndex: number;
                    speaker: string;
                    startMs: number;
                    endMs: number;
                    text: string;
                    tokenCount: number;
                    similarity: number;
                }> = [];

                for (let i = 0; i < rowMeta.length; i++) {
                    const similarity = cosineSimilarityF32(queryEmbedding, embeddings, i * embeddingDim, embeddingDim);
                    if (similarity >= minSimilarity) {
                        const meta = rowMeta[i];
                        scored.push({
                            id: meta.id,
                            meetingId: meta.meeting_id,
                            chunkIndex: meta.chunk_index,
                            speaker: meta.speaker,
                            startMs: meta.start_timestamp_ms,
                            endMs: meta.end_timestamp_ms,
                            text: meta.cleaned_text,
                            tokenCount: meta.token_count,
                            similarity
                        });
                    }
                }

                scored.sort((a, b) => b.similarity - a.similarity);
                parentPort!.postMessage({
                    type: 'result',
                    requestId,
                    data: scored.slice(0, limit)
                });
                break;
            }

            case 'searchSummaries': {
                const { requestId, queryEmbedding, embeddings, embeddingDim, rowMeta, limit } = message;
                const scored: Array<{
                    meetingId: string;
                    summaryText: string;
                    similarity: number;
                }> = [];

                for (let i = 0; i < rowMeta.length; i++) {
                    const similarity = cosineSimilarityF32(queryEmbedding, embeddings, i * embeddingDim, embeddingDim);
                    const meta = rowMeta[i];
                    scored.push({
                        meetingId: meta.meeting_id,
                        summaryText: meta.summary_text,
                        similarity
                    });
                }

                scored.sort((a, b) => b.similarity - a.similarity);
                parentPort!.postMessage({
                    type: 'result',
                    requestId,
                    data: scored.slice(0, limit)
                });
                break;
            }

            case 'nativeVecSearch': {
                const { requestId, dbPath, extPath, queryBlob, dim, meetingId, spaceKey, limit, minSimilarity, fetchMultiplier } = message;
                // P1-4: valida dim é a positive inteiro antes interpolating dentro de o tabela nnome
                // This worker executa em a separate thread e recebe messages de o principal pprocesso
                // então it operates at a trust limite — o valor precisa ser validated aqui independently.
                if (!Number.isInteger(dim) || dim <= 0 || dim > 65536) {
                    parentPort!.postMessage({ type: 'error', requestId, error: `Invalid embedding dimension: ${dim}` });
                    break;
                }
                const db = getDb(dbPath, extPath);
                const fetchLimit = (meetingId || spaceKey) ? limit * fetchMultiplier : limit;
                const vecTable = `vec_chunks_${dim}`;

                const vecRows = db.prepare(`
                    SELECT chunk_id, distance FROM ${vecTable}
                    WHERE embedding MATCH ? ORDER BY distance LIMIT ?
                `).all(queryBlob, fetchLimit) as any[];

                if (vecRows.length === 0) { parentPort!.postMessage({ type: 'result', requestId, data: [] }); break; }

                const chunkIds = vecRows.map((r: any) => r.chunk_id);
                const ph = chunkIds.map(() => '?').join(',');
                let q = `SELECT c.* FROM chunks c JOIN meetings m ON c.meeting_id = m.id WHERE c.id IN (${ph})`;
                const params: any[] = [...chunkIds];
                if (meetingId) { q += ' AND c.meeting_id = ?'; params.push(meetingId); }
                // Filtrar por composite embedding SPACE, não provedor nnome v1 e v2 Gemini
                // são ambos provider='gemini' @ 768d, então a provedor filtrar iria leak v1
                // vectors dentro de v2 queries. A NULL space (não ainda stamped / mid-reindex) é
                // intentionally excluded → "empty, não wrong".
                if (spaceKey) { q += ' AND m.embedding_space = ?'; params.push(spaceKey); }

                const chunkRows = db.prepare(q).all(...params) as any[];
                const chunkMap = new Map<number, any>();
                for (const row of chunkRows) chunkMap.set(row.id, row);

                const scored: any[] = [];
                for (const vecRow of vecRows) {
                    const c = chunkMap.get(vecRow.chunk_id);
                    if (!c) continue;
                    const similarity = 1 - vecRow.distance;
                    if (similarity >= minSimilarity) {
                        scored.push({ id: c.id, meetingId: c.meeting_id, chunkIndex: c.chunk_index,
                            speaker: c.speaker, startMs: c.start_timestamp_ms, endMs: c.end_timestamp_ms,
                            text: c.cleaned_text, tokenCount: c.token_count, similarity });
                    }
                }
                parentPort!.postMessage({ type: 'result', requestId, data: scored.slice(0, limit) });
                break;
            }

            case 'nativeVecSearchSummaries': {
                const { requestId, dbPath, extPath, queryBlob, dim, spaceKey, limit } = message;
                // P1-4: mesmo inteiro validation como nativeVecSearch — worker trust blimite
                if (!Number.isInteger(dim) || dim <= 0 || dim > 65536) {
                    parentPort!.postMessage({ type: 'error', requestId, error: `Invalid embedding dimension: ${dim}` });
                    break;
                }
                const db = getDb(dbPath, extPath);
                const fetchLimit = spaceKey ? limit * 4 : limit;
                const vecTable = `vec_summaries_${dim}`;

                const vecRows = db.prepare(`
                    SELECT summary_id, distance FROM ${vecTable}
                    WHERE embedding MATCH ? ORDER BY distance LIMIT ?
                `).all(queryBlob, fetchLimit) as any[];

                if (vecRows.length === 0) { parentPort!.postMessage({ type: 'result', requestId, data: [] }); break; }

                const ids = vecRows.map((r: any) => r.summary_id);
                const ph = ids.map(() => '?').join(',');
                let sq = `SELECT s.* FROM chunk_summaries s JOIN meetings m ON s.meeting_id = m.id WHERE s.id IN (${ph})`;
                const params: any[] = [...ids];
                // Filtrar por composite embedding SPACE, não provedor nome (see nativeVecSearch).
                if (spaceKey) { sq += ' AND m.embedding_space = ?'; params.push(spaceKey); }

                const summaryRows = db.prepare(sq).all(...params) as any[];
                const summaryMap = new Map<number, any>();
                for (const row of summaryRows) summaryMap.set(row.id, row);

                const results: any[] = [];
                for (const vecRow of vecRows) {
                    const s = summaryMap.get(vecRow.summary_id);
                    if (!s) continue;
                    results.push({ meetingId: s.meeting_id, summaryText: s.summary_text, similarity: 1 - vecRow.distance });
                }
                parentPort!.postMessage({ type: 'result', requestId, data: results.slice(0, limit) });
                break;
            }

            default:

                parentPort!.postMessage({
                    type: 'error',
                    requestId: (message as any).requestId,
                    error: `Unknown message type: ${(message as any).type}`
                });
        }
    } catch (error: any) {
        parentPort!.postMessage({
            type: 'error',
            requestId: (message as any).requestId,
            error: error.message
        });
    }
});
