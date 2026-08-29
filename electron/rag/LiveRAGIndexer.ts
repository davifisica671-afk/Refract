/**
 * @file LiveRAGIndexer.ts
 * @description Indexador RAG em tempo real (JIT - Just-In-Time) para reuniões ao vivo.
 * Indexa incrementalmente novos segmentos de transcrição durante uma reunião,
 * utilizando um timer em background de 30 segundos para dividir e gerar embeddings
 * de novos blocos. O embedding é executado em segundo plano (fire-and-forget)
 * para nunca bloquear o caminho de consulta. Faz fallback gracefully quando
 * a API de embedding não está disponível.
 */

// electron/rag/LiveRAGIndexer.ts
// JIT RAG: Incrementally indexes transcript durante a live meeting.
//
// Architecture:
// - Background timer (30s) chunks & embeds NEW transcript segments
// - Embedding é fire-and-forget — nunca blocks o consulta caminho
// - At consulta time, VectorStore já tem indexed chunks para fast busca
// - Falls voltar gracefully se embedding API unavailable

import { preprocessTranscript, RawSegment } from './TranscriptPreprocessor';
import { chunkTranscript, Chunk } from './SemanticChunker';
import { VectorStore } from './VectorStore';
import { EmbeddingPipeline } from './EmbeddingPipeline';

// Intervalo de indexação: 30 segundos entre processamentos
const INDEXING_INTERVAL_MS = 30_000;
// Mínimo de novos segmentos para iniciar processamento
const MIN_NEW_SEGMENTS = 3;

/** Indexador RAG em tempo real para reuniões ao vivo (JIT) */
export class LiveRAGIndexer {
    private vectorStore: VectorStore;
    private embeddingPipeline: EmbeddingPipeline;
    private meetingId: string | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;
    private allSegments: RawSegment[] = [];
    private indexedSegmentCount = 0;  // High-water mark: segments já chunked
    private chunkCounter = 0;         // Running chunk index
    private indexedChunkCount = 0;    // Total chunks com embeddings
    private isProcessing = false;     // Proteger contra concurrent ticks
    private isActive = false;

    constructor(vectorStore: VectorStore, embeddingPipeline: EmbeddingPipeline) {
        this.vectorStore = vectorStore;
        this.embeddingPipeline = embeddingPipeline;
    }

    /** Inicia a indexação para uma reunião ao vivo */
    start(meetingId: string): void {
        if (this.isActive) {
            this.stop();
        }

        this.meetingId = meetingId;
        this.allSegments = [];
        this.indexedSegmentCount = 0;
        this.chunkCounter = 0;
        this.indexedChunkCount = 0;
        this.isProcessing = false;
        this.isActive = true;

        console.log(`[LiveRAGIndexer] Started for meeting ${meetingId}`);

        this.timer = setInterval(() => {
            this.tick().catch(err => {
                console.error('[LiveRAGIndexer] Tick error:', err);
            });
        }, INDEXING_INTERVAL_MS);
    }

    /** Alimenta novos segmentos de transcrição da reunião ao vivo */
    feedSegments(segments: RawSegment[]): void {
        if (!this.isActive || !this.meetingId) return;
        this.allSegments.push(...segments);
    }

    /** Tick principal de indexação: processa apenas novos segmentos desde o último tick */
    private async tick(): Promise<void> {
        if (!this.isActive || !this.meetingId) return;
        if (this.isProcessing) return;  // Pular if anterior tick ainda running

        const newSegmentCount = this.allSegments.length - this.indexedSegmentCount;
        if (newSegmentCount < MIN_NEW_SEGMENTS) return;  // Não enough new content

        this.isProcessing = true;
        const meetingId = this.meetingId;

        try {
            // 1. Obtém apenas novo segments
            const newSegments = this.allSegments.slice(this.indexedSegmentCount);

            // 2. Preprocess
            const cleaned = preprocessTranscript(newSegments);
            if (cleaned.length === 0) {
                this.indexedSegmentCount = this.allSegments.length;
                return;
            }

            // 3. Chunk com offset index
            const chunks = chunkTranscript(meetingId, cleaned);
            if (chunks.length === 0) {
                this.indexedSegmentCount = this.allSegments.length;
                return;
            }

            // Re-index chunks para continue de onde we esquerda fora
            const indexedChunks: Chunk[] = chunks.map((chunk, i) => ({
                ...chunk,
                chunkIndex: this.chunkCounter + i,
            }));

            // 4. Salva chunks para DB (sem embeddings initially)
            const chunkIds = this.vectorStore.saveChunks(indexedChunks);
            this.chunkCounter += indexedChunks.length;

            console.log(`[LiveRAGIndexer] Saved ${indexedChunks.length} chunks (${this.chunkCounter} total) for meeting ${meetingId}`);

            // 5. Embed cada chunk (fire-and-forget por chunk, mas sequential para avoid rate limits)
            if (this.embeddingPipeline.isReady()) {
                // Foreground gate (manual regression 2026-06-12): produzir para qualquer
                // in-flight manual/WTA answer entre chunk embeds — storeEmbedding
                // é a synchronous DB escreve que caso contrário contends com answers.
                const { ForegroundGate } = require('../services/ForegroundGate') as typeof import('../services/ForegroundGate');
                let embeddedCount = 0;
                for (let i = 0; i < chunkIds.length; i++) {
                    try {
                        await ForegroundGate.waitUntilIdle();
                        const embedding = await this.embeddingPipeline.getEmbedding(indexedChunks[i].text);
                        this.vectorStore.storeEmbedding(chunkIds[i], embedding);
                        embeddedCount++;
                    } catch (err) {
                        console.warn(`[LiveRAGIndexer] Failed to embed chunk ${chunkIds[i]}:`, err);
                        // Continue com remaining chunks — parcial indexing é better than nenhum
                    }
                }
                this.indexedChunkCount += embeddedCount;
                console.log(`[LiveRAGIndexer] Embedded ${embeddedCount}/${chunkIds.length} chunks (${this.indexedChunkCount} total with embeddings)`);

                // Stamp o meeting's embedding space então these live chunks são (a) searchable
                // in-session (busca filtra em embedding_space) e (b) Não swept dentro de o
                // "unknown-space" re-index. Apenas stamps se atualmente NULL.
                if (embeddedCount > 0) {
                    const providerName = this.embeddingPipeline.getActiveProviderName();
                    const space = this.embeddingPipeline.getActiveSpaceKey();
                    const dims = this.embeddingPipeline.getActiveDimensions();
                    if (providerName && space && dims) {
                        this.vectorStore.stampMeetingSpaceIfUnset(meetingId, providerName, dims, space);
                    }
                }
            } else {
                console.log('[LiveRAGIndexer] Embedding pipeline not ready, chunks saved without embeddings');
            }

            // 6. Advance high-water mark
            this.indexedSegmentCount = this.allSegments.length;

        } catch (err) {
            console.error('[LiveRAGIndexer] Processing error:', err);
        } finally {
            this.isProcessing = false;
        }
    }

    /** Para a indexação ao vivo e esvazia segmentos restantes */
    async stop(): Promise<void> {
        if (!this.isActive) return;

        console.log(`[LiveRAGIndexer] Stopping for meeting ${this.meetingId}`);

        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        // Final esvaziar — processo qualquer remaining segments
        await this.tick();

        const meetingId = this.meetingId;
        this.isActive = false;
        this.meetingId = null;
        this.allSegments = [];
        this.indexedSegmentCount = 0;
        this.chunkCounter = 0;
        this.indexedChunkCount = 0;

        console.log(`[LiveRAGIndexer] Stopped for meeting ${meetingId}`);
    }

    /** Verifica se existem blocos JIT consultáveis para a reunião atual */
    hasIndexedChunks(): boolean {
        return this.indexedChunkCount > 0;
    }

    /** Retorna o número de blocos com embeddings (consultáveis) */
    getIndexedChunkCount(): number {
        return this.indexedChunkCount;
    }

    /** Retorna o ID da reunião sendo indexada atualmente */
    getActiveMeetingId(): string | null {
        return this.meetingId;
    }

    /** Verifica se a indexação está ativa */
    isRunning(): boolean {
        return this.isActive;
    }
}
