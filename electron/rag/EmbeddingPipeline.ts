/**
 * @file EmbeddingPipeline.ts
 * @description Pipeline de geração de embeddings pós-reunião com lógica de fila e retentativas.
 * Utiliza provedores de embedding intercambiáveis (Gemini, OpenAI, Ollama) e
 * faz fallback automaticamente para LocalEmbeddingProvider (on-device) em caso
 * de exaustão do provedor primário. Gera e armazena embeddings para blocos
 * e resumos de reuniões, processando a fila em background sem bloquear a UI.
 */

// electron/rag/EmbeddingPipeline.ts
// Post-meeting embedding generation com queue-based tentar novamente logic
// Uses pluggable IEmbeddingProvider (Gemini, OpenAI, ou Ollama)
// Em provedor exhaustion, automatically falls voltar para LocalEmbeddingProvider (on-device).

import Database from 'better-sqlite3';
import { VectorStore } from './VectorStore';

import { EmbeddingProviderResolver, AppAPIConfig } from './EmbeddingProviderResolver';
import { IEmbeddingProvider } from './providers/IEmbeddingProvider';
import { LocalEmbeddingProvider } from './providers/LocalEmbeddingProvider';

const MAX_RETRIES = 3;
const RETRY_DELAY_BASE_MS = 2000;
// BUG-5: Maximum time para aguardar para a único embed() call.
// A frozen API (network partition / provedor hang) iria caso contrário travar isProcessing=true
// forever, silently stalling o entire pipeline até app restart.
// 30s é generous para grande chunks em lento connections (ttípico 200-800ms).
const EMBED_TIMEOUT_MS = 30_000;

/**
 * Pipeline de geração de embeddings pós-reunião com fila e retentativas.
 * Processa blocos e resumos, com fallback automático para o modelo local.
 */
export class EmbeddingPipeline {
    private provider: IEmbeddingProvider | null = null;
    /** Sempre disponível on-device alternativa (MiniLM). Null apenas se o bundled modelo é corrupted. */
    private fallbackProvider: IEmbeddingProvider | null = null;
    /** Conjunto de meeting IDs que ter sido downgraded para local alternativa após primário provedor exhaustion. */
    private fallbackMeetings = new Set<string>();
    private db: Database.Database;
    private vectorStore: VectorStore;
    private isProcessing = false;
    private initPromise: Promise<void> | null = null;
    /** Tracks o configuração used em o maioria recente successful ininicializa chamar para habilitar idempotency. */
    private _lastConfig: AppAPIConfig | null = null;

    constructor(db: Database.Database, vectorStore: VectorStore) {
        this.db = db;
        this.vectorStore = vectorStore;
    }

    /** Inicializa o pipeline com a configuração de provedores (idempotente) */
    async initialize(config: AppAPIConfig): Promise<void> {
        // Pular se configuração é identical ou tem não novo information
        if (this._lastConfig && !this._isConfigImprovement(this._lastConfig, config)) {
            console.log('[EmbeddingPipeline] Config unchanged or no new keys — skipping re-initialization');
            return this.initPromise ?? Promise.resolve();
        }
        this._lastConfig = { ...config };
        // Registrar apenas o SHAPE (que keys são present), nunca o secret values — o
        // configuração carries API keys e isso line iria caso contrário leak them para logs/crash reports.
        console.log('[EmbeddingPipeline] Initializing with config:', {
            openaiKey: !!config.openaiKey,
            geminiKey: !!config.geminiKey,
            ollamaUrl: config.ollamaUrl || null,
            geminiEmbeddingModel: config.geminiEmbeddingModel || null,
            geminiEmbeddingDims: config.geminiEmbeddingDims || null,
        });
        this.initPromise = this._doInitialize(config);
        return this.initPromise;
    }

    /** Verifica se a configuração melhorou em relação à anterior */
    private _isConfigImprovement(prev: AppAPIConfig, next: AppAPIConfig): boolean {
        const hasNew = (prevVal: string | undefined, nextVal: string | undefined) =>
            !prevVal && !!nextVal;
        return (
            hasNew(prev.openaiKey, next.openaiKey) ||
            hasNew(prev.geminiKey, next.geminiKey) ||
            hasNew(prev.ollamaUrl, next.ollamaUrl)
        );
    }

    private async _doInitialize(config: AppAPIConfig): Promise<void> {
        // Construct o local alternativa para cima front, mas fazer Não chamar isAvailable() haqui
        // LocalEmbeddingProvider construction é cheap (paths + static dimensions/space);
        // isAvailable() carrega o MiniLM ONNX modelo via transformers.js e pode stall
        // o Electron principal processo durante primeiro paint. O provedor carrega lazily em
        // primeiro real fallback/query uso através embed()/embedQuery().
        this.fallbackProvider = new LocalEmbeddingProvider();
        console.log(`[EmbeddingPipeline] Local fallback provider registered for lazy load (${this.fallbackProvider.dimensions}d)`);

        // Resolve primário provedor antes touching o local mmodelo If o primário é
        // local, o resolver's instance becomes ambos primário e alternativa então o modelo
        // é loaded at maioria uma vez em local-only mmodo
        try {
            this.provider = await EmbeddingProviderResolver.resolve(config);
            console.log(`[EmbeddingPipeline] Ready with provider: ${this.provider.name} (${this.provider.dimensions}d)`);

            // If o primário É local, point fallbackProvider at o mesmo instance para avoid
            // loading o modelo twice.
            if (this.provider instanceof LocalEmbeddingProvider) {
                this.fallbackProvider = this.provider;
            }

            // Verifica para anterior embedding-SPACE mismatches.
            // Acionar fora o count de incompatible meetings (não apenas lastSpace !=
            // activeSpace) então a crash mid-reindex — onde last_embedding_space pode
            // já equal o ativo space mas rows ainda hold o antigo space —
            // é ainda detected e resumed.
            const activeSpace = this.provider.space;
            const stateRow = this.db.prepare("SELECT value FROM app_state WHERE key = 'last_embedding_space'").get() as any;
            const lastSpace = stateRow?.value;

            const incompatibleCount = this.vectorStore.getIncompatibleSpaceCount(activeSpace);
            if (incompatibleCount > 0) {
                // RAGManager.scheduleAutoReindex() gerencia o user-facing notification
                // e o actual re-embedding. Aqui we apenas registrar — emitting a aviso IPC
                // também iria double-notify.
                console.log(`[EmbeddingPipeline] Found ${incompatibleCount} meetings in an incompatible embedding space (last: ${lastSpace ?? 'unknown'}, active: ${activeSpace}). Auto-reindex will handle them.`);
            }

            // Salva ativo space
            this.db.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES ('last_embedding_space', ?)").run(activeSpace);

        } catch (err) {
            console.error('[EmbeddingPipeline] Failed to initialize primary provider:', err);
            console.warn('[EmbeddingPipeline] Falling back to local-only mode for all meetings.');
            // Promote alternativa como o primário então isReady() Retorna verdadeiro e queueing works.
            // O local modelo ainda carrega lazily em o primeiro embed call.
            this.provider = this.fallbackProvider;
            // Persist o alternativa provider's space então o próximo launch faz não disparar a
            // false-positive incompatible-space aviso (e.g. openai space vs local space).
            try {
                this.db.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES ('last_embedding_space', ?)").run(this.provider.space);
            } catch (_) { /* non-fatal — DB pode não ter app_state ainda em edge cases */ }
        }

        // Flush qualquer fila items submitted durante o startup race janela (i.e. antes o
        // provedor era ready). processQueue() é idempotent e a no-op se o fila é empty.
        setTimeout(() => {
            this.processQueue().catch(err => {
                console.warn('[EmbeddingPipeline] Post-init queue flush failed (non-fatal):', err.message);
            });
        }, 0);
    }

    /** Verifica se o pipeline está pronto para uso */
    isReady(): boolean {
        return this.provider !== null;
    }

    /** Aguarda o pipeline finalizar a inicialização (seguro para múltiplas chamadas) */
    async waitForReady(timeoutMs: number = 15000): Promise<void> {
        if (this.provider) return; // já ready
        if (this.initPromise) {
            // Race contra a tempo limite então we don't hang forever
            await Promise.race([
                this.initPromise,
                new Promise<void>((_, reject) =>
                    setTimeout(() => reject(new Error(`Embedding pipeline initialization timed out after ${timeoutMs}ms`)), timeoutMs)
                )
            ]);
            return;
        }
        throw new Error('Embedding pipeline has not been initialized');
    }

    /** Retorna o nome do provedor de embedding ativo */
    getActiveProviderName(): string | undefined {
        return this.provider?.name;
    }

    /** Retorna a chave composta do espaço de embedding do provedor ativo */
    getActiveSpaceKey(): string | undefined {
        return this.provider?.space;
    }

    /** Retorna as dimensões do provedor ativo */
    getActiveDimensions(): number | undefined {
        return this.provider?.dimensions;
    }

    /** Enfileira uma reunião para processamento de embeddings */
    async queueMeeting(meetingId: string): Promise<void> {
        // Obtém chunks sem embeddings
        const chunks = this.vectorStore.getChunksWithoutEmbeddings(meetingId);

        if (chunks.length === 0) {
            console.log(`[EmbeddingPipeline] No chunks to embed for meeting ${meetingId}`);
            return;
        }

        // Fila cada chunk.
        // Insere Ou Ignorar previne duplicate rows se queueMeeting() é chamado twice
        // para o mesmo meeting (e.g., reprocessMeeting() pacaminho
        const insert = this.db.prepare(`
            INSERT OR IGNORE INTO embedding_queue (meeting_id, chunk_id, status)
            VALUES (?, ?, 'pending')
        `);

        const queueAll = this.db.transaction(() => {
            for (const chunk of chunks) {
                insert.run(meetingId, chunk.id);
            }
            // Também fila summary (chunk_id = NULL significa summary)
            insert.run(meetingId, null);
        });

        queueAll();
        
        // NOTE: Provedor metadados é written em o primeiro successful embedding
        // para isso meeting (dentro embedChunk), não aqui — para avoid marking a
        // meeting como embedded se o fila crashes antes qualquer work é dfeito

        console.log(`[EmbeddingPipeline] Queued ${chunks.length} chunks + 1 summary for meeting ${meetingId}`);

        // Inicia processing em background
        this.processQueue().catch(err => {
            console.error('[EmbeddingPipeline] Queue processing error:', err);
        });
    }

    /** Limpa embeddings de uma reunião e a reenfileira para re-embedding atomicamente */
    async requeueMeetingForReindex(meetingId: string): Promise<void> {
        const chunkIds = this.db
            .prepare('SELECT id FROM chunks WHERE meeting_id = ?')
            .all(meetingId) as { id: number }[];

        const insert = this.db.prepare(`
            INSERT OR IGNORE INTO embedding_queue (meeting_id, chunk_id, status)
            VALUES (?, ?, 'pending')
        `);

        // One ttransação claro vectors + provider/space mmetadados então fila
        // Todos chunks (não apenas NULL-embedding ones) + o summary.
        const tx = this.db.transaction(() => {
            this.vectorStore.clearEmbeddingsForMeeting(meetingId);
            // Purge qualquer prior fila rows para isso meeting fprimeiro O UNIQUE(meeting_id,
            // chunk_id) restrição faz Não dedupe o summary linha (chunk_id É NULL, and
            // SQLite treats NULL != NULL), então a re-queue iria caso contrário accumulate
            // duplicate summary rows. Deleting primeiro makes isso idempotent para chunks AND
            // o summary, e é safe dentro o mesmo transação como o re-insert.
            this.db.prepare('DELETE FROM embedding_queue WHERE meeting_id = ?').run(meetingId);
            for (const c of chunkIds) insert.run(meetingId, c.id);
            insert.run(meetingId, null); // summary
        });
        tx();

        console.log(`[EmbeddingPipeline] Requeued meeting ${meetingId} for re-index (${chunkIds.length} chunks + summary, atomic)`);

        this.processQueue().catch(err => {
            console.error('[EmbeddingPipeline] Queue processing error (reindex):', err);
        });
    }

    /** Processa embeddings pendentes na fila com retentativas e fallback */
    async processQueue(): Promise<void> {
        if (this.isProcessing) {
            console.log('[EmbeddingPipeline] Already processing queue');
            return;
        }

        if (!this.provider) {
            console.log('[EmbeddingPipeline] No provider, skipping queue processing');
            return;
        }

        // Recover items stuck em 'processing' de a anterior app crash.
        // These eram marked 'processing' antes o embed chamar mas nunca completed.
        // Reinicia them para 'pending' então isso executa pode escolher them upara cima
        const stuckCount = this.db.prepare(
            `UPDATE embedding_queue SET status = 'pending' WHERE status = 'processing'`
        ).run().changes;
        if (stuckCount > 0) {
            console.warn(`[EmbeddingPipeline] Recovered ${stuckCount} stuck 'processing' items from prior crash.`);
        }

        this.isProcessing = true;

        try {
            // Foreground gate (manual regression 2026-06-12): o drenar loop's
            // synchronous better-sqlite3 statements block o main-process evento
            // loop. Yield para qualquer in-flight manual/WTA answer entre items então a
            // post-meeting embedding backlog can't make live questions lag.
            const { ForegroundGate } = require('../services/ForegroundGate') as typeof import('../services/ForegroundGate');
            while (true) {
                await ForegroundGate.waitUntilIdle();
                // Busca próximo pendente item. Items marked para local alternativa (retry_count = -1)
                // são também eligible, então we uso a broad ffiltrar
                const pending = this.db.prepare(`
                    SELECT * FROM embedding_queue
                    WHERE status = 'pending'
                      AND (retry_count < ? OR retry_count = -1)
                    ORDER BY created_at ASC
                    LIMIT 1
                `).get(MAX_RETRIES) as any;

                if (!pending) {
                    console.log('[EmbeddingPipeline] Queue empty');
                    break;
                }

                // Determine que provedor para uso
                const useFallback =
                    pending.retry_count === -1 ||
                    this.fallbackMeetings.has(pending.meeting_id);
                const activeProvider = useFallback ? this.fallbackProvider : this.provider;

                if (!activeProvider) {
                    // Cannot proceed — não provedor at todos (fallback também unavailable).
                    // Reinicia item voltar para 'pending' então it pode ser retried quando keys são configured.
                    // Fazer Não mark como 'failed' — que é a terminal estado que can't ser recovered.
                    this.db.prepare(
                        `UPDATE embedding_queue SET status = 'pending', error_message = 'No provider available' WHERE id = ?`
                    ).run(pending.id);
                    // Break o loop — lá é nada we pode fazer até a provedor becomes available.
                    console.warn('[EmbeddingPipeline] No provider available (not even local fallback). Stopping queue processing.');
                    break;
                }

                // Mark como processing
                this.db.prepare(
                    `UPDATE embedding_queue SET status = 'processing' WHERE id = ?`
                ).run(pending.id);

                try {
                    if (pending.chunk_id) {
                        await this.embedChunk(pending.chunk_id, activeProvider);
                    } else {
                        await this.embedMeetingSummary(pending.meeting_id, activeProvider);
                    }

                    // Mark como completed
                    this.db.prepare(`
                        UPDATE embedding_queue 
                        SET status = 'completed', processed_at = ?
                        WHERE id = ?
                    `).run(new Date().toISOString(), pending.id);

                } catch (error: any) {
                    const newRetryCount = (pending.retry_count === -1 ? 0 : pending.retry_count) + 1;
                    console.error(
                        `[EmbeddingPipeline] Error processing queue item ${pending.id} ` +
                        `(retry ${newRetryCount}/${MAX_RETRIES}, provider: ${activeProvider.name}):`,
                        error.message
                    );

                    if (!useFallback && newRetryCount >= MAX_RETRIES && this.fallbackProvider) {
                        // Primário provedor exhausted. Rebaixar o meeting para local fallback.
                        await this.activateMeetingFallback(pending.meeting_id);
                    } else {
                        // Ainda ter tenta novamente remaining — back-off e rtentar novamente
                        this.db.prepare(`
                            UPDATE embedding_queue 
                            SET status = 'pending', retry_count = retry_count + 1, error_message = ?
                            WHERE id = ?
                        `).run(error.message, pending.id);

                        // Exponential recuo (pular para alternativa items já rreinicia
                        if (!useFallback) {
                            const delay = RETRY_DELAY_BASE_MS * Math.pow(2, pending.retry_count);
                            await this.delay(delay);
                        }
                    }
                }
            }
        } finally {
            this.isProcessing = false;
        }
    }

    /** Ativa fallback local para uma reunião após exaustão do provedor primário */
    private async activateMeetingFallback(meetingId: string): Promise<void> {
        if (!this.fallbackProvider) {
            // Deve nunca happen — proteger exists em o caller, mas ser defensive.
            console.error(`[EmbeddingPipeline] Cannot activate fallback for ${meetingId}: no local fallback provider available.`);
            return;
        }
        // Capture em a local const então TypeScript pode narrow o tipo (class fields can't ser narrowed).
        const fallback = this.fallbackProvider;

        console.warn(
            `[EmbeddingPipeline] Primary provider exhausted for meeting ${meetingId}. ` +
            `Activating local fallback (${fallback.name}).`
        );

        // 1. Limpa existing (potentially partial) embeddings para prevenir dimension clash.
        //    This é safe porque we re-embed todos chunks de scratch via o fallback.
        this.vectorStore.clearEmbeddingsForMeeting(meetingId);

        // 2. Reinicia Todos non-failed fila items para isso meeting voltar para pendente com
        //    sentinel retry_count=-1. We incluir anteriormente 'completed' items aqui
        //    porque clearEmbeddingsForMeeting() apenas wiped their stored BLOBs, então
        //    their 'completed' status é agora stale — they Precisa ser re-embedded.
        //    status='failed' items (retry_count >= MAX_RETRIES) stay falhou para avoid
        //    an infinite tentar novamente loop.
        this.db.prepare(`
            UPDATE embedding_queue
            SET status = 'pending', retry_count = -1,
                error_message = 'Falling back to local embedding'
            WHERE meeting_id = ?
              AND status != 'failed'
        `).run(meetingId);

        // 3. Track at runtime (avoids a DB lê por item em processQueue)
        this.fallbackMeetings.add(meetingId);

        // 4. Notifica o renderer
        try {
            const { BrowserWindow } = require('electron');
            BrowserWindow.getAllWindows().forEach((win: any) => {
                if (!win.isDestroyed()) {
                    win.webContents.send('embedding:fallback-activated', {
                        meetingId,
                        fallbackProvider: fallback.name,
                        reason: 'Primary embedding provider failed after max retries'
                    });
                }
            });
        } catch (_) { /* non-fatal */ }
    }

    /** Obtém embedding para um bloco de documento (para armazenamento) */
    async getEmbedding(text: string): Promise<number[]> {
        if (!this.provider) {
            throw new Error('Embedding provider not initialized');
        }
        return this.embedWithTimeout(this.provider, text, 'live-chunk');
    }

    /** Gera embeddings em lote para múltiplos blocos de documento */
    async getEmbeddings(texts: string[]): Promise<number[][]> {
        if (!this.provider) {
            throw new Error('Embedding provider not initialized');
        }
        if (texts.length === 0) return [];
        const provider = this.provider;
        return new Promise<number[][]>((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(
                    `[EmbeddingPipeline] embedBatch() timed out after ${EMBED_TIMEOUT_MS}ms for ${texts.length} chunks via ${provider.name}`
                ));
            }, EMBED_TIMEOUT_MS);
            provider.embedBatch(texts).then(
                (results) => { clearTimeout(timer); resolve(results); },
                (err)     => { clearTimeout(timer); reject(err); }
            );
        });
    }

    /** Obtém embedding para uma consulta de busca (pode usar prefixo diferente) */
    async getEmbeddingForQuery(text: string): Promise<number[]> {
        if (!this.provider) {
            throw new Error('Embedding provider not initialized');
        }
        // embedQuery() uses a query-specific prefix para asymmetric models (e.g. Nomic).
        // Encapsular com a manual tempo limite desde embedQuery é não covered por embedWithTimeout directly.
        return new Promise<number[]>((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(
                    `[EmbeddingPipeline] embedQuery() timed out after ${EMBED_TIMEOUT_MS}ms for live-query via ${this.provider!.name}`
                ));
            }, EMBED_TIMEOUT_MS);
            this.provider!.embedQuery(text).then(
                (result) => { clearTimeout(timer); resolve(result); },
                (err)    => { clearTimeout(timer); reject(err); }
            );
        });
    }

    /** Dimensões do modelo local (para verificação de compatibilidade) */
    get localDimensions(): number | null {
        return this.fallbackProvider?.dimensions ?? null;
    }

    /** Chave de espaço do provedor local (para verificação de compatibilidade) */
    get localSpaceKey(): string | null {
        return this.fallbackProvider?.space ?? null;
    }

    /** Gera embedding usando apenas o provedor local (retorna nulo se indisponível) */
    async getEmbeddingForQueryLocalOnly(text: string): Promise<number[] | null> {
        const local = this.fallbackProvider;
        if (!local) return null;
        try {
            return await this.embedWithTimeout(local, text, 'local-query');
        } catch (e: any) {
            console.warn('[EmbeddingPipeline] Local query embed failed:', e?.message || e);
            return null;
        }
    }

    /** Embute chamada de embed() com timeout rígido para evitar travamento (correção BUG-5) */
    private async embedWithTimeout(provider: IEmbeddingProvider, text: string, chunkLabel: string): Promise<number[]> {
        return new Promise<number[]>((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(
                    `[EmbeddingPipeline] embed() timed out after ${EMBED_TIMEOUT_MS}ms for ${chunkLabel} via ${provider.name}`
                ));
            }, EMBED_TIMEOUT_MS);

            provider.embed(text).then(
                (result) => { clearTimeout(timer); resolve(result); },
                (err)    => { clearTimeout(timer); reject(err); }
            );
        });
    }

    /** Gera embedding para um único bloco usando o provedor especificado */
    private async embedChunk(chunkId: number, provider?: IEmbeddingProvider): Promise<void> {
        const p = provider ?? this.provider;
        if (!p) throw new Error('No embedding provider');

        // Obtém chunk text
        const row = this.db.prepare('SELECT cleaned_text, meeting_id FROM chunks WHERE id = ?').get(chunkId) as any;
        if (!row) {
            console.log(`[EmbeddingPipeline] Chunk ${chunkId} not found, skipping`);
            return;
        }

        const embedding = await this.embedWithTimeout(p, row.cleaned_text, `chunk ${chunkId}`);
        this.vectorStore.storeEmbedding(chunkId, embedding);

        // Registro provedor metadados em o meeting após primeiro successful embedding
        try {
            this.db.prepare(
                'UPDATE meetings SET embedding_provider = ?, embedding_dimensions = ?, embedding_space = ? WHERE id = ? AND embedding_provider IS NULL'
            ).run(p.name, p.dimensions, p.space, row.meeting_id);
        } catch (e) {
            // Non-fatal — metadados é para safety filtering, não critical caminho
        }

        console.log(`[EmbeddingPipeline] Embedded chunk ${chunkId} via ${p.name}`);
    }

    /** Gera embedding para o resumo de uma reunião */
    private async embedMeetingSummary(meetingId: string, provider?: IEmbeddingProvider): Promise<void> {
        const p = provider ?? this.provider;
        if (!p) throw new Error('No embedding provider');

        // Obtém summary text
        const row = this.db.prepare(
            'SELECT summary_text FROM chunk_summaries WHERE meeting_id = ?'
        ).get(meetingId) as any;

        if (!row) {
            console.log(`[EmbeddingPipeline] No summary for meeting ${meetingId}, skipping`);
            return;
        }

        const embedding = await this.embedWithTimeout(p, row.summary_text, `summary:${meetingId}`);
        this.vectorStore.storeSummaryEmbedding(meetingId, embedding);

        // P2-8: registro provedor metadados em o meeting linha então que provider-switch
        // compatibility verifica (que gate busca queries por embedding_provider) também
        // cover meetings cujo apenas embedding é a summary (não chunks).
        try {
            this.db.prepare(
                'UPDATE meetings SET embedding_provider = ?, embedding_dimensions = ?, embedding_space = ? WHERE id = ? AND embedding_provider IS NULL'
            ).run(p.name, p.dimensions, p.space, meetingId);
        } catch (e) {
            // Non-fatal — metadados é para safety filtering, não critical caminho
        }

        console.log(`[EmbeddingPipeline] Embedded summary for meeting ${meetingId} via ${p.name}`);
    }

    /** Retorna o status da fila de processamento de embeddings */
    getQueueStatus(): { pending: number; processing: number; completed: number; failed: number } {
        const counts = this.db.prepare(`
            SELECT status, COUNT(*) as count FROM embedding_queue GROUP BY status
        `).all() as any[];

        const result = { pending: 0, processing: 0, completed: 0, failed: 0 };

        for (const row of counts) {
            if (row.status === 'pending') result.pending = row.count;
            else if (row.status === 'processing') result.processing = row.count;
            else if (row.status === 'completed') result.completed = row.count;
            else if (row.status === 'failed') result.failed = row.count;
        }

        // Também count 'pending' items que ter exhausted primário tenta novamente mas haven't ainda
        // activated o local alternativa (retry_count >= MAX_RETRIES, Não a sentinel).
        // These são effectively stalled — surface them como "failed" em o UI então o
        // user knows they precisa attention, mas note que activateMeetingFallback vai
        // mover them para retry_count=-1 quando o pipeline processa them.
        // IMPORTANT: excluir o fallback-sentinel (retry_count = -1) de isso count.
        const effectivelyStalled = this.db.prepare(`
            SELECT COUNT(*) as count FROM embedding_queue 
            WHERE status = 'pending' AND retry_count >= ? AND retry_count != -1
        `).get(MAX_RETRIES) as any;

        // Adiciona stalled count em topo de explicit status='failed' count (don't osobrescrever
        result.failed += (effectivelyStalled.count || 0);
        // Deduct stalled items de pendente então o totals são coherent
        result.pending = Math.max(0, result.pending - (effectivelyStalled.count || 0));

        return result;
    }

    /** Remove itens concluídos da fila mais antigos que N dias */
    cleanupQueue(daysOld: number = 7): void {
        const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
        this.db.prepare(`
            DELETE FROM embedding_queue 
            WHERE status = 'completed' AND processed_at < ?
        `).run(cutoff);
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
