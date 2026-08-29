/**
 * =============================================================================
 * RAGManager.ts — ORQUESTRADOR DO PIPELINE RAG
 * =============================================================================
 * 
 * DESCRIÇÃO:
 * RAG = Retrieval-Augmented Generation (Geração Aumentada por Recuperação).
 * Este é o sistema que permite ao app BUSCAR em reuniões anteriores para
 * fornecer contexto melhor às respostas de IA.
 * 
 * FLUXO COMPLETO DO RAG:
 * 
 * 1. PÓS-REUNIÃO (processamento em background):
 *    a. Transcrição bruta → TranscriptPreprocessor (limpeza)
 *    b. Transcrição limpa → SemanticChunker (divisão em blocos semânticos)
 *    c. Blocos → EmbeddingPipeline (conversão em vetores numéricos)
 *    d. Vetores → VectorStore (armazenamento no SQLite com sqlite-vec)
 * 
 * 2. CONSULTA (quando usuário pergunta algo):
 *    a. Pergunta → EmbeddingPipeline (conversão em vetor)
 *    b. Vetor → VectorStore (busca por similaridade coseno)
 *    c. Blocos similares → RAGRetriever (re-ranking e seleção)
 *    d. Contexto recuperado → LLMHelper (geração de resposta)
 * 
 * PROVEDORES DE EMBEDDING (em cascata):
 *    1. OpenAI (text-embedding-3-small) — melhor qualidade
 *    2. Gemini (gemini-embedding-001) — alternativa
 *    3. Ollama (nomic-embed-text) — local, gratuito
 *    4. MiniLM (embutido) — fallback final, ~10ms
 * 
 * FUNCIONALIDADES:
 * - Indexação automática de reuniões
 * - Re-indexação automática quando modelo de embedding muda
 * - Busca em reunião específica OU global (todas)
 * - Busca ao vivo (durante reunião em andamento)
 * - Retry de embeddings que falharam
 * - Limpeza automática de itens obsoletos da fila
 * =============================================================================
 */

// electron/rag/RAGManager.ts
// Central orchestrator para RAG pipeline
// Coordinates preprocessing, chunking, embedding, e retrieval

import Database from 'better-sqlite3';
import { LLMHelper } from '../LLMHelper';
import { preprocessTranscript, RawSegment } from './TranscriptPreprocessor';
import { chunkTranscript } from './SemanticChunker';
import { VectorStore } from './VectorStore';
import { EmbeddingPipeline } from './EmbeddingPipeline';
import { RAGRetriever } from './RAGRetriever';
import { LiveRAGIndexer } from './LiveRAGIndexer';
import { buildRAGPrompt, NO_CONTEXT_FALLBACK, NO_GLOBAL_CONTEXT_FALLBACK } from './prompts';
import type { ProviderDataScopePolicy } from '../llm/ProviderRouter';

/** Configuração necessária para inicializar o RAGManager */
export interface RAGManagerConfig {
    db: Database.Database;
    dbPath: string;       // Passed to VectorStore então worker pode abrir its próprio read-only conexão
    extPath: string;      // Resolved sqlite-vec extensão caminho (não plataforma suffix)
    openaiKey?: string;
    geminiKey?: string;
    ollamaUrl?: string;
    providerDataScopes?: ProviderDataScopePolicy;
}

/**
 * RAGManager - Central orchestrator para RAG operations
 * 
 * Lifecycle:
 * 1. Inicializa com banco de dados e API chave
 * 2. Quando meeting etermina processMeeting() -> chunks + fila embeddings
 * 3. Quando user queries: quconsulta -> recupera + stream resposta
 */
/**
 * Classe principal que orquestra todas as operações RAG.
 * Coordena o fluxo completo de processamento, indexação e consulta.
 */
export class RAGManager {
    private db: Database.Database;
    private vectorStore: VectorStore;
    private embeddingPipeline: EmbeddingPipeline;
    private retriever: RAGRetriever;
    private llmHelper: LLMHelper | null = null;
    private liveIndexer: LiveRAGIndexer;
    /** Guards contra concurrent reprocessMeeting() calls para o mesmo meeting ID. */
    private _reprocessInFlight = new Set<string>();

    constructor(config: RAGManagerConfig) {
        this.db = config.db;
        this.vectorStore = new VectorStore(config.db, config.dbPath, config.extPath);
        this.embeddingPipeline = new EmbeddingPipeline(config.db, this.vectorStore);
        this.retriever = new RAGRetriever(this.vectorStore, this.embeddingPipeline);
        this.liveIndexer = new LiveRAGIndexer(this.vectorStore, this.embeddingPipeline);

        this.embeddingPipeline.initialize({
            openaiKey: config.openaiKey,
            geminiKey: config.geminiKey,
            ollamaUrl: config.ollamaUrl,
            providerDataScopes: config.providerDataScopes
        }).then(() => {
            // Backfill provedor metadados para meetings que eram embedded antes o
            // embedding_provider coluna era written (ou onde o escreve falhou silently).
            this._backfillEmbeddingProviderMetadata();
            // Auto-reindex meetings esquerda em an incompatible embedding space (e.g. após
            // a Gemini embedding-model bump). No-op quando tudo já matches.
            this.scheduleAutoReindex();
        }).catch(() => { /* non-critical, suprimir */ });
    }

    /**
     * Set LLM helper para generating responses
     */
    /** Define o helper LLM para geração de respostas */
    setLLMHelper(llmHelper: LLMHelper): void {
        this.llmHelper = llmHelper;
    }

    /** Retorna a instância do pipeline de embeddings */
    getEmbeddingPipeline(): EmbeddingPipeline {
        return this.embeddingPipeline;
    }

    /** Inicializa os embeddings com as chaves de API fornecidas */
    initializeEmbeddings(keys: { openaiKey?: string, geminiKey?: string, ollamaUrl?: string, providerDataScopes?: ProviderDataScopePolicy }): void {
        const initPromise = this.embeddingPipeline.initialize(keys);
        // Após init, backfill embedding_provider em meetings que ter embedded chunks
        // mas a NULL metadados coluna (common para meetings embedded antes isso metadados
        // escreve era introduced, ou onde o escreve silently failed).
        if (initPromise && typeof initPromise.then === 'function') {
            initPromise.then(() => {
                this._backfillEmbeddingProviderMetadata();
                this.scheduleAutoReindex();
            }).catch(() => { /* silent — backfill é non-critical */ });
        } else {
            // Synchronous caminho (shouldn't happen mas ser safe)
            this._backfillEmbeddingProviderMetadata();
            this.scheduleAutoReindex();
        }
    }

    /** Preenche metadados do provedor de embedding para reuniões legadas */
    private _backfillEmbeddingProviderMetadata(): void {
        const providerName = this.embeddingPipeline.getActiveProviderName();
        const dimensions = this.embeddingPipeline.getActiveDimensions();
        if (providerName && dimensions) {
            // Stamps provider/dims apenas — Não embedding_space. Space é owned por o
            // re-index sweep então a NULL-space legacy linha can't ser mislabeled como o
            // ativo space (que iria pular re-index → silent garbage).
            this.vectorStore.backfillEmbeddingProviderMetadata(providerName, dimensions);
        }
    }

    /**
     * Check se RAG is pronto para queries
     */
    /** Verifica se o RAG está pronto para receber consultas */
    isReady(): boolean {
        return this.embeddingPipeline.isReady() && this.llmHelper !== null;
    }

    /**
     * Process a meeting depois it ends
     * Creates chunks e queues them para embedding
     */
    /** Processa uma reunião após seu término: cria blocos e enfileira para embedding */
    async processMeeting(
        meetingId: string,
        transcript: RawSegment[],
        summary?: string
    ): Promise<{ chunkCount: number }> {
        console.log(`[RAGManager] Processing meeting ${meetingId} with ${transcript.length} segments`);

        // 1. Preprocess transcript
        const cleaned = preprocessTranscript(transcript);
        console.log(`[RAGManager] Preprocessed to ${cleaned.length} cleaned segments`);

        // 2. Chunk o transcript
        const chunks = chunkTranscript(meetingId, cleaned);
        console.log(`[RAGManager] Created ${chunks.length} chunks`);

        if (chunks.length === 0) {
            console.log(`[RAGManager] No chunks to save for meeting ${meetingId}`);
            return { chunkCount: 0 };
        }

        // 3. Salva chunks para banco de dados
        this.vectorStore.saveChunks(chunks);

        // 4. Salva summary se provided
        if (summary) {
            this.vectorStore.saveSummary(meetingId, summary);
        }

        // 5. Fila para embedding (background processing)
        if (this.embeddingPipeline.isReady()) {
            await this.embeddingPipeline.queueMeeting(meetingId);
        } else {
            console.log(`[RAGManager] Embeddings not ready, chunks saved without embeddings`);
        }

        return { chunkCount: chunks.length };
    }

    /**
     * Query meeting com RAG
     * Returns streaming generator para response
     */
    /** Consulta uma reunião específica usando RAG, retorna resposta em streaming */
    async *queryMeeting(
        meetingId: string,
        query: string,
        abortSignal?: AbortSignal
    ): AsyncGenerator<string, void, unknown> {
        if (!this.llmHelper) {
            throw new Error('LLM helper not initialized');
        }

        // Verifica se meeting tem embeddings (post-meeting RAG)
        const hasEmbeddings = this.vectorStore.hasEmbeddings(meetingId);

        if (!hasEmbeddings) {
            // JIT RAG: Verifica se live indexer tem chunks para isso meeting
            const isLiveMeeting = this.liveIndexer.getActiveMeetingId() === meetingId;
            if (isLiveMeeting && this.liveIndexer.hasIndexedChunks()) {
                console.log(`[RAGManager] Using JIT RAG for live meeting ${meetingId} (${this.liveIndexer.getIndexedChunkCount()} chunks)`);
                // Fall através para retrieval — VectorStore já tem o JIT chunks
            } else {
                // Não embeddings at todos — acionar wrapper fallback
                throw new Error('NO_MEETING_EMBEDDINGS');
            }
        }

        // Recupera relevant contexto
        const context = await this.retriever.retrieve(query, { meetingId });

        if (context.chunks.length === 0) {
            // Não contexto relevant para consulta - acionar wrapper alternativa para uso contexto window
            throw new Error('NO_RELEVANT_CONTEXT_FOUND');
        }

        // Build prompt com intent hint
        const prompt = buildRAGPrompt(query, context.formattedContext, 'meeting', context.intent);

        // Stream resposta
        const stream = this.llmHelper.streamChatWithGemini(prompt, undefined, undefined, true);

        for await (const chunk of stream) {
            if (abortSignal?.aborted) break;
            yield chunk;
        }
    }

    /**
     * Query across todos meetings (global search)
     */
    /** Consulta globalmente em todas as reuniões */
    async *queryGlobal(
        query: string,
        abortSignal?: AbortSignal
    ): AsyncGenerator<string, void, unknown> {
        if (!this.llmHelper) {
            throw new Error('LLM helper not initialized');
        }

        // Recupera de todos meetings
        const context = await this.retriever.retrieveGlobal(query);

        if (context.chunks.length === 0) {
            yield NO_GLOBAL_CONTEXT_FALLBACK;
            return;
        }

        // Build prompt com intent hint
        const prompt = buildRAGPrompt(query, context.formattedContext, 'global', context.intent);

        // Stream resposta
        const stream = this.llmHelper.streamChatWithGemini(prompt, undefined, undefined, true);

        for await (const chunk of stream) {
            if (abortSignal?.aborted) break;
            yield chunk;
        }
    }

    /**
     * Smart query - auto-detects scope
     */
    /** Consulta inteligente que detecta automaticamente o escopo (reunião ou global) */
    async *query(
        query: string,
        currentMeetingId?: string,
        abortSignal?: AbortSignal
    ): AsyncGenerator<string, void, unknown> {
        const scope = this.retriever.detectScope(query, currentMeetingId);

        if (scope === 'meeting' && currentMeetingId) {
            yield* this.queryMeeting(currentMeetingId, query, abortSignal);
        } else {
            yield* this.queryGlobal(query, abortSignal);
        }
    }

    /**
     * Get embedding fila status
     */
    /** Retorna o status da fila de embeddings */
    getQueueStatus(): { pending: number; processing: number; completed: number; failed: number } {
        return this.embeddingPipeline.getQueueStatus();
    }

    /**
     * Retry pendente embeddings
     */
    /** Retenta processar embeddings pendentes na fila */
    async retryPendingEmbeddings(): Promise<void> {
        await this.embeddingPipeline.processQueue();
    }

    /**
     * Check se a meeting has been processed para RAG
     */
    /** Verifica se uma reunião já foi processada para RAG */
    isMeetingProcessed(meetingId: string): boolean {
        return this.vectorStore.hasEmbeddings(meetingId);
    }

    // ─── JIT RAG: Live Meeting Indexing ──────────────────────────────

    /**
     * Start JIT indexing para a live meeting.
     * Call quando a meeting session begins.
     */
    /** Inicia indexação JIT para uma reunião ao vivo */
    startLiveIndexing(meetingId: string): void {
        if (!this.embeddingPipeline.isReady()) {
            console.log('[RAGManager] Embedding pipeline not ready, skipping live indexing');
            return;
        }
        
        // Garante meeting linha exists em DB para satisfy foreign chave constraints para chunks
        try {
            this.db.prepare(`
                INSERT OR IGNORE INTO meetings (id, title, start_time, duration_ms, summary_json, created_at, source, is_processed)
                VALUES (?, 'Live Meeting', ?, 0, '{}', ?, 'manual', 0)
            `).run(meetingId, Date.now(), new Date().toISOString());
        } catch (e) {
            console.warn('[RAGManager] Failed to create transient meeting row for live indexing', e);
        }

        this.liveIndexer.start(meetingId);
    }

    /**
     * Feed novo transcript segments para o live indexer.
     * Call whenever novo transcript arrives during o meeting.
     */
    /** Alimenta novos segmentos de transcrição para o indexador ao vivo */
    feedLiveTranscript(segments: RawSegment[]): void {
        this.liveIndexer.feedSegments(segments);
    }

    /**
     * Stop JIT indexing (flushes remaining segments).
     * Call quando o meeting session ends.
     * NOTE: The post-meeting processMeeting() vai later substituir JIT chunks
     * com o complete, properly indexed version.
     */
    /** Para a indexação JIT (esvazia segmentos restantes) */
    async stopLiveIndexing(): Promise<void> {
        await this.liveIndexer.stop();
    }

    /**
     * Check se JIT indexing is ativo para a meeting.
     */
    /** Verifica se a indexação JIT está ativa para uma reunião */
    isLiveIndexingActive(meetingId?: string): boolean {
        if (meetingId) {
            return this.liveIndexer.getActiveMeetingId() === meetingId;
        }
        return this.liveIndexer.isRunning();
    }

    /**
     * Check se JIT indexing has produced at least one queryable (embedded) chunk.
     * Prevents wasted queryMeeting() calls que immediately lançar NO_MEETING_EMBEDDINGS.
     */
    /** Verifica se a indexação JIT produziu pelo menos um bloco consultável */
    hasLiveChunks(): boolean {
        return this.liveIndexer.hasIndexedChunks();
    }

    /**
     * Delete RAG dados para a meeting
     */
    /** Exclui todos os dados RAG de uma reunião */
    deleteMeetingData(meetingId: string): void {
        // 1. Exclui de vector armazenamento (chunks e summaries)
        this.vectorStore.deleteChunksForMeeting(meetingId);
        
        // 2. Limpa embedding fila para isso meeting para prevenir "Chunk não found" errors em re-processing
        try {
            const info = this.db.prepare('DELETE FROM embedding_queue WHERE meeting_id = ?').run(meetingId);
            if (info.changes > 0) {
                console.log(`[RAGManager] Cleared ${info.changes} items from embedding_queue for meeting ${meetingId}`);
            }
        } catch (e) {
            console.warn(`[RAGManager] Failed to clear embedding_queue for meeting ${meetingId}`, e);
        }
        
        // 3. Clean para cima transient meeting linha se it era a live sessão
        try {
            if (meetingId === 'live-meeting-current') {
                this.db.prepare('DELETE FROM meetings WHERE id = ?').run(meetingId);
            }
        } catch (e) {
            console.warn('[RAGManager] Failed to delete transient meeting row', e);
        }
    }

    /**
     * Manually acionar processing para a meeting
     * Useful para demo meetings ou reprocessing falhou ones
     */
    /** Reprocessa manualmente uma reunião (exclui dados existentes e recria) */
    async reprocessMeeting(meetingId: string): Promise<void> {
        // GProteger se isso meeting é já sendo reprocessed, pular para prevenir
        // concurrent executa de clearing cada other's fila work.
        if (this._reprocessInFlight.has(meetingId)) {
            console.log(`[RAGManager] Reprocessing already in-flight for ${meetingId}, skipping duplicate call`);
            return;
        }
        this._reprocessInFlight.add(meetingId);

        console.log(`[RAGManager] Reprocessing meeting ${meetingId}`);

        try {
            // exclui existing RAG dados primeiro para avoid duplicates
            this.deleteMeetingData(meetingId);

            // Busca meeting details de DB
            const { DatabaseManager } = require('../db/DatabaseManager');
            const meeting = DatabaseManager.getInstance().getMeetingDetails(meetingId);

            if (!meeting) {
                console.error(`[RAGManager] Meeting ${meetingId} not found for reprocessing`);
                return;
            }

            if (!meeting.transcript || meeting.transcript.length === 0) {
                console.log(`[RAGManager] Meeting ${meetingId} has no transcript, skipping`);
                return;
            }

            // Converte para RawSegment formata
            const segments = meeting.transcript.map((t: any) => ({
                speaker: t.speaker,
                text: t.text,
                timestamp: t.timestamp
            }));

            // Obtém summary se available
            let summary: string | undefined;
            if (meeting.detailedSummary) {
                summary = [
                    ...(meeting.detailedSummary.overview ? [meeting.detailedSummary.overview] : []),
                    ...(meeting.detailedSummary.keyPoints || []),
                    ...(meeting.detailedSummary.actionItems || []).map((a: any) => `Action: ${a}`)
                ].join('. ');
            } else if (meeting.summary) {
                summary = meeting.summary;
            }

            await this.processMeeting(meetingId, segments, summary);
        } finally {
            this._reprocessInFlight.delete(meetingId);
        }
    }

    /**
     * Ensure demo meeting is processed
     * Checks se demo meeting exists mas has não chunks, então processes it
     */
    /** Garante que a reunião de demonstração seja processada */
    async ensureDemoMeetingProcessed(): Promise<void> {
        const demoId = 'demo-meeting'; // Corrected ID to match DatabaseManager

        // Verifica se demo meeting exists em DB
        const { DatabaseManager } = require('../db/DatabaseManager');
        const meeting = DatabaseManager.getInstance().getMeetingDetails(demoId);

        if (!meeting) {
            // console.log('[RAGManager] Demonstração meeting não found em DB, skipping RAG processing');
            return;
        }

        // Verifica se já processed (tem embeddings)
        if (this.isMeetingProcessed(demoId)) {
            // console.log('[RAGManager] Demonstração meeting já processed');
            return;
        }

        // GProteger também verifica o in-flight define — reprocessMeeting() si mesmo é guarded,
        // mas checking aqui avoids até printing o "Processing now.agora registrar redundantly.
        if (this._reprocessInFlight.has(demoId)) {
            console.log(`[RAGManager] Demonstração meeting reprocessing already in-flight, skipping`);
            return;
        }

        console.log('[RAGManager] Demonstração meeting found but not processed. Processing now...');
        await this.reprocessMeeting(demoId);
    }

    /**
     * Cleanup stale fila items para meetings que não longer exist
     */
    /** Remove itens órfãos da fila de embeddings para reuniões que não existem mais */
    public cleanupStaleQueueItems(): void {
        try {
            const info = this.db.prepare(`
                DELETE FROM embedding_queue 
                WHERE meeting_id NOT IN (SELECT id FROM meetings)
            `).run();
            if (info.changes > 0) {
                console.log(`[RAGManager] Cleaned up ${info.changes} stale queue items`);
            }
        } catch (error) {
            console.error('[RAGManager] Failed to cleanup stale queue items:', error);
        }
    }

    /**
     * Manual re-index entry point (settings botão / IPC). Delegates para o same
     * guarded routine as o automatic caminho so o two can't executar concurrently and
     * double-clear/double-queue.
     */
    /** Ponto de entrada manual para re-indexação (botão de configurações / IPC) */
    async reindexIncompatibleMeetings(): Promise<void> {
        await this._runReindex();
    }

    /**
     * Automatically re-index meetings whose embedding space differs de the
     * ativo one (e.g. depois o gemini-embedding-001 → gemini-embedding-2 bump).
     *
     * Design:
     *  - Triggered off o incompatible COUNT (not lastSpace != activeSpace) so a
     *    crash mid-reindex resumes próximo launch.
     *  - Each meeting is cleared AND queued in ONE transaction (requeueMeetingForReindex)
     *    so a crash pode nunca orphan a meeting (cleared vectors mas não fila rows).
     *    The durable embedding_queue + o pipeline's startup queue-flush is the
     *    resume mechanism.
     *  - Deferred ~15s so it doesn't compete com cold-start UI/STT.
     *  - Paused enquanto a live meeting indexes (live > backfill), mas o pause is
     *    CAPPED so a back-to-back-meetings session can't strand o in-flight flag
     *    ou leave o progresso notificação spinning forever; it bails e retries próximo launch.
     *  - Idempotent: a second chamar (auto ou manual) enquanto one is in flight is a no-op.
     *  - Search during re-index is empty-not-wrong: a cleared, not-yet-re-embedded
     *    meeting has NULL space e is excluded by o space-filtered search.
     */
    private _reindexInFlight = false;
    private _autoReindexTimer: ReturnType<typeof setTimeout> | null = null;
    private static readonly AUTO_REINDEX_DEFER_MS = 15_000;
    private static readonly REINDEX_LIVE_RECHECK_MS = 30_000;
    private static readonly REINDEX_MAX_LIVE_WAITS = 20; // ~10 min cap, então bail + tentar novamente próximo launch
    private static readonly REINDEX_DRAIN_POLL_MS = 2_000;
    private static readonly REINDEX_MAX_DRAIN_POLLS = 900; // ~30 min cap em progress polling

    /** Agenda re-indexação automática para reuniões com espaço de embedding incompatível */
    scheduleAutoReindex(): void {
        const activeSpace = this.embeddingPipeline.getActiveSpaceKey();
        if (!activeSpace) return;
        if (this.vectorStore.getIncompatibleSpaceCount(activeSpace) === 0) return;
        // Defer o kickoff então launch isn't slowed; _runReindex owns o in-flight gproteger
        // Track o timer então a re-init (settings change) doesn't pilha duplicate timers
        // e então it pode ser cancelled em teardown.
        if (this._autoReindexTimer) clearTimeout(this._autoReindexTimer);
        this._autoReindexTimer = setTimeout(() => {
            this._autoReindexTimer = null;
            this._runReindex().catch(err => {
                console.error('[RAGManager] Auto-reindex failed (will retry next launch):', err);
            });
        }, RAGManager.AUTO_REINDEX_DEFER_MS);
    }

    /** Cancelar qualquer pendente deferred auto-reindex (call em teardown/quit). */
    /** Cancela qualquer re-indexação automática pendente (chamar ao encerrar) */
    cancelPendingReindex(): void {
        if (this._autoReindexTimer) {
            clearTimeout(this._autoReindexTimer);
            this._autoReindexTimer = null;
        }
    }

    /**
     * Teardown hook para app shutdown: cancels o deferred auto-reindex timer (which
     * could otherwise disparar up para ~15s — ou o ~30min drenar poll — depois quit) and
     * terminates o VectorStore worker thread. Call de o before-quit handler.
     */
    /** Finaliza o RAGManager: cancela re-indexação e destrói o worker do VectorStore */
    async dispose(): Promise<void> {
        this.cancelPendingReindex();
        try { await this.vectorStore.destroy(); } catch (e) {
            console.warn('[RAGManager] dispose: vectorStore.destroy failed (non-fatal):', e);
        }
    }

    /** Shared guarded re-index routine para ambos o auto e manual paths. */
    private async _runReindex(): Promise<void> {
        if (this._reindexInFlight) {
            console.log('[RAGManager] Re-index already in flight — skipping duplicate trigger.');
            return;
        }
        const activeSpace = this.embeddingPipeline.getActiveSpaceKey();
        if (!activeSpace) {
            console.error('[RAGManager] Cannot re-index: no active embedding provider.');
            return;
        }
        const count = this.vectorStore.getIncompatibleSpaceCount(activeSpace);
        if (count === 0) {
            console.log('[RAGManager] No incompatible meetings to re-index.');
            return;
        }

        this._reindexInFlight = true;
        this._emitReindex('embedding:reindex-started', { count, space: activeSpace });
        console.log(`[RAGManager] Re-indexing ${count} meeting(s) into space ${activeSpace}...`);

        try {
            // ── Fase 1: requeue ── snapshot o worklist; clear+queue cada meeting atomically.
            const meetingIds = this.vectorStore.getMeetingIdsNeedingReindex(activeSpace);
            const total = meetingIds.length;

            for (const meetingId of meetingIds) {
                // Pausar (capped) se a live meeting é indexing — live work tem priority.
                let waits = 0;
                while (this.liveIndexer.isRunning()) {
                    if (waits >= RAGManager.REINDEX_MAX_LIVE_WAITS) {
                        console.warn(`[RAGManager] Re-index pausing exceeded cap (${RAGManager.REINDEX_MAX_LIVE_WAITS} waits) due to continuous live meetings. Bailing; will resume next launch.`);
                        // Bail cleanly então o notificação resolves; o count-based acionar
                        // re-fires próximo launch para qualquer que seja remains.
                        this._emitReindex('embedding:reindex-complete', { total, space: activeSpace, partial: true });
                        return;
                    }
                    waits++;
                    await new Promise(r => setTimeout(r, RAGManager.REINDEX_LIVE_RECHECK_MS));
                }
                // Atomic claro + enqueue (crash-safe — see requeueMeetingForReindex).
                await this.embeddingPipeline.requeueMeetingForReindex(meetingId);
            }

            console.log(`[RAGManager] Re-index: requeued ${total} meeting(s). Awaiting background embedding...`);

            // ── Fase 2: await actual embedding ── o requeue acima apenas QUEUED o work;
            // o meetings ter NULL embeddings (excluded de sbusca até o background
            // processQueue drains. Report Verdadeiro progresso fora o fila depth então o UI doesn't
            // claim "ccompleta enquanto past meetings são ainda unsearchable.
            const initialPending = this.embeddingPipeline.getQueueStatus().pending;
            let polls = 0;
            while (polls < RAGManager.REINDEX_MAX_DRAIN_POLLS) {
                const { pending } = this.embeddingPipeline.getQueueStatus();
                const doneItems = Math.max(0, initialPending - pending);
                this._emitReindex('embedding:reindex-progress', { done: doneItems, total: initialPending, space: activeSpace });
                if (pending === 0) break;
                polls++;
                await new Promise(r => setTimeout(r, RAGManager.REINDEX_DRAIN_POLL_MS));
            }

            const stillPending = this.embeddingPipeline.getQueueStatus().pending;
            // Completa = fila completamente drained. If we hit o poll cap com work left
            // (muito grande corpus / lento API), report parcial — it keeps draining em o
            // fundo e o count-based acionar re-verifies próximo launch.
            this._emitReindex('embedding:reindex-complete', {
                total,
                space: activeSpace,
                partial: stillPending > 0,
            });
            console.log(`[RAGManager] Re-index ${stillPending > 0 ? 'partially ' : ''}complete (${stillPending} queue item(s) still pending).`);
        } finally {
            this._reindexInFlight = false;
        }
    }

    private _emitReindex(channel: string, payload: Record<string, unknown>): void {
        try {
            const { BrowserWindow } = require('electron');
            BrowserWindow.getAllWindows().forEach((win: any) => {
                if (!win.isDestroyed()) win.webContents.send(channel, payload);
            });
        } catch (_) { /* non-fatal — renderer pode não ser para cima ainda */ }
    }
}
