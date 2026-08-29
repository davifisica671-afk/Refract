/**
 * @file RAGRetriever.ts
 * @description Pipeline de recuperação de contexto RAG.
 * Responsável por converter consultas do usuário em embeddings, buscar blocos
 * (chunks) semanticamente similares no VectorStore, re-ordenar por relevância
 * e recentidade, e montar o contexto final dentro de um limite de tokens.
 * Detecta intenção da consulta (decisões, ações, resumo, etc.) para ajustar
 * a estratégia de recuperação.
 */

import { VectorStore, ScoredChunk } from './VectorStore';
import { EmbeddingPipeline } from './EmbeddingPipeline';
import { formatChunkForContext } from './SemanticChunker';

/**
 * Tipos de intenção da consulta para ajustar a estratégia de recuperação.
 * Detectados via padrões regex, sem uso de LLM.
 */
export type QueryIntent =
    | 'decision_recall'   // "O que fez we decide?"
    | 'speaker_lookup'    // "O que fez X say?"
    | 'action_items'      // "O que são my ação items?"
    | 'summary'           // "SummResumir
    | 'open_question';    // Default fallback

/** Opções de configuração para a recuperação de contexto */
export interface RetrievalOptions {
    meetingId?: string;           // Para meeting-scoped queries
    maxTokens?: number;           // Contexto token budget (default: 1500)
    topK?: number;                // Initial retrieval count (default: 8)
    recencyWeight?: number;       // 0-1, como muito to weight recente (default: 0.3)
    intent?: QueryIntent;         // Sobrescrever detected intent
}

/** Resultado da recuperação de contexto com blocos, texto formatado e metadados */
export interface RetrievedContext {
    chunks: ScoredChunk[];
    formattedContext: string;
    totalTokens: number;
    meetingIds: string[];
    intent: QueryIntent;          // Detected consulta intent para prompt hints
}


/**
 * Orquestra o pipeline de recuperação de contexto RAG.
 * Fluxo: embed consulta → buscar candidatos → re-ordenar → montar contexto.
 */
export class RAGRetriever {
    private vectorStore: VectorStore;
    private embeddingPipeline: EmbeddingPipeline;

    constructor(vectorStore: VectorStore, embeddingPipeline: EmbeddingPipeline) {
        this.vectorStore = vectorStore;
        this.embeddingPipeline = embeddingPipeline;
    }

    /** Recupera contexto relevante para uma consulta em uma reunião específica */
    async retrieve(
        query: string,
        options: RetrievalOptions = {}
    ): Promise<RetrievedContext> {
        const {
            meetingId,
            maxTokens = 1500,
            topK = 8,
            recencyWeight = 0.3,
            intent: overrideIntent
        } = options;

        // Detect consulta intent (pode ser overridden)
        const intent = overrideIntent || this.detectIntent(query);

        // 1. Embed o consulta
        let queryEmbedding: number[];
        try {
            queryEmbedding = await this.embeddingPipeline.getEmbeddingForQuery(query);
        } catch (error) {
            console.error('[RAGRetriever] Failed to embed query:', error);
            // Retorna vazio contexto em embedding failure
            return {
                chunks: [],
                formattedContext: '',
                totalTokens: 0,
                meetingIds: [],
                intent
            };
        }

        // 2. Recupera candidates (over-fetch para reranking)
        const spaceKey = this.embeddingPipeline.getActiveSpaceKey();
        let candidates = await this.vectorStore.searchSimilar(queryEmbedding, {
            meetingId,
            limit: topK * 2,
            minSimilarity: 0.25,
            spaceKey
        });

        if (candidates.length === 0) {
            console.log('[RAGRetriever] No similar chunks found');
            return {
                chunks: [],
                formattedContext: '',
                totalTokens: 0,
                meetingIds: [],
                intent
            };
        }

        // 3. Re-rank por relevance + recency
        const now = Date.now();
        candidates = candidates.map(chunk => ({
            ...chunk,
            finalScore: this.computeFinalScore(chunk, now, recencyWeight)
        }));

        candidates.sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));

        // 4. Selecionar top-K dentro de token budget
        const selected: ScoredChunk[] = [];
        let totalTokens = 0;

        for (const chunk of candidates) {
            if (totalTokens + chunk.tokenCount > maxTokens) {
                // Pular se we já ter minimum content
                if (selected.length >= topK / 2) break;
                continue;
            }

            selected.push(chunk);
            totalTokens += chunk.tokenCount;

            if (selected.length >= topK) break;
        }

        // 5. Ordenar selected por timestamp para coherent reading
        selected.sort((a, b) => a.startMs - b.startMs);

        // 6. Formata contexto
        const formattedContext = selected
            .map(chunk => formatChunkForContext(chunk))
            .join('\n\n');

        return {
            chunks: selected,
            formattedContext,
            totalTokens,
            meetingIds: [...new Set(selected.map(c => c.meetingId))],
            intent
        };
    }

    /** Recupera contexto de forma global, combinando busca por blocos e resumos */
    async retrieveGlobal(
        query: string,
        options: RetrievalOptions = {}
    ): Promise<RetrievedContext> {
        const {
            maxTokens = 1500,
            topK = 8,
            recencyWeight = 0.3,
            intent: overrideIntent
        } = options;

        // Detect consulta intent
        const intent = overrideIntent || this.detectIntent(query);

        // Embed consulta
        let queryEmbedding: number[];
        try {
            queryEmbedding = await this.embeddingPipeline.getEmbeddingForQuery(query);
        } catch (error) {
            console.error('[RAGRetriever] Failed to embed query:', error);
            return {
                chunks: [],
                formattedContext: '',
                totalTokens: 0,
                meetingIds: [],
                intent
            };
        }

        // Busca ambos chunks e summaries
        const spaceKey = this.embeddingPipeline.getActiveSpaceKey();
        const chunkResults = await this.vectorStore.searchSimilar(queryEmbedding, {
            limit: topK * 2,
            minSimilarity: 0.25,
            spaceKey
        });

        const summaryResults = await this.vectorStore.searchSummaries(queryEmbedding, 5, spaceKey);

        // Obtém meeting IDs de topo summaries
        const relevantMeetingIds = new Set(summaryResults.map(s => s.meetingId));

        // Boost chunks de meetings com matching summaries
        const boostedChunks = chunkResults.map(chunk => ({
            ...chunk,
            similarity: relevantMeetingIds.has(chunk.meetingId)
                ? chunk.similarity * 1.2  // 20% boost
                : chunk.similarity
        }));

        // Re-rank
        const now = Date.now();
        const ranked = boostedChunks.map(chunk => ({
            ...chunk,
            finalScore: this.computeFinalScore(chunk, now, recencyWeight)
        }));

        ranked.sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));

        // Selecionar dentro de budget
        const selected: ScoredChunk[] = [];
        let totalTokens = 0;

        for (const chunk of ranked) {
            if (totalTokens + chunk.tokenCount > maxTokens) {
                if (selected.length >= topK / 2) break;
                continue;
            }

            selected.push(chunk);
            totalTokens += chunk.tokenCount;

            if (selected.length >= topK) break;
        }

        // Agrupar por meeting para coherent saída
        const byMeeting = new Map<string, ScoredChunk[]>();
        for (const chunk of selected) {
            if (!byMeeting.has(chunk.meetingId)) {
                byMeeting.set(chunk.meetingId, []);
            }
            byMeeting.get(chunk.meetingId)!.push(chunk);
        }

        // Formata com meeting grouping
        const contextParts: string[] = [];
        for (const [meetingId, chunks] of byMeeting) {
            // Ordenar chunks dentro de meeting por timestamp
            chunks.sort((a, b) => a.startMs - b.startMs);
            const chunkTexts = chunks.map(c => formatChunkForContext(c)).join('\n');
            contextParts.push(`--- Meeting ${meetingId} ---\n${chunkTexts}`);
        }

        return {
            chunks: selected,
            formattedContext: contextParts.join('\n\n'),
            totalTokens,
            meetingIds: [...byMeeting.keys()],
            intent
        };
    }

    /** Calcula pontuação final combinando relevância e recentidade */
    private computeFinalScore(
        chunk: ScoredChunk,
        now: number,
        recencyWeight: number
    ): number {
        // Recency: decay sobre 7 days (half-life)
        const ageMs = now - chunk.startMs;
        const ageHours = ageMs / (1000 * 60 * 60);
        const recencyScore = Math.exp(-ageHours / 168);  // 168 hours = 7 days

        // Combined score
        const relevanceWeight = 1 - recencyWeight;
        return (relevanceWeight * chunk.similarity) + (recencyWeight * recencyScore);
    }

    /** Detecta a intenção da consulta usando padrões regex (rápido e determinístico) */
    detectIntent(query: string): QueryIntent {
        const lower = query.toLowerCase();

        // Decision patterns
        if (/\b(decide|decision|agreed|conclusion|settled|determined|resolved)\b/.test(lower) ||
            /what did we (decide|agree|conclude)/.test(lower) ||
            /did we (decide|agree|settle)/.test(lower)) {
            return 'decision_recall';
        }

        // Speaker consulta patterns
        if (/\b(said|mentioned|told|asked|suggested|proposed|pointed out)\b/.test(lower) &&
            /\b(he|she|they|\w+)\s+(said|mentioned|told|asked)/.test(lower)) {
            return 'speaker_lookup';
        }
        if (/what did (\w+|he|she|they) say/.test(lower) ||
            /who said/.test(lower)) {
            return 'speaker_lookup';
        }

        // Ação items patterns
        if (/\b(action|task|todo|to-do|follow[- ]?up|next step|assigned|deadline)\b/.test(lower) ||
            /what (are|were) (my|the|our) (action|task|todo)/.test(lower) ||
            /what (do i|should i|need to) do/.test(lower)) {
            return 'action_items';
        }

        // Summary patterns
        if (/\b(summar|overview|recap|highlights?|key points?)\b/.test(lower) ||
            /^(summarize|recap|give me a summary)/.test(lower)) {
            return 'summary';
        }

        return 'open_question';
    }

    /** Detecta se a consulta é escopada por reunião ou global */
    detectScope(query: string, currentMeetingId?: string): 'meeting' | 'global' {
        const lower = query.toLowerCase();

        // Meeting-scoped patterns
        const meetingPatterns = [
            'this meeting',
            'this call',
            'just now',
            'earlier',
            'they said',
            'he said',
            'she said',
            'did they',
            'did he',
            'did she',
            'what did'
        ];

        // Global patterns
        const globalPatterns = [
            'all meetings',
            'any meeting',
            'ever discuss',
            'find',
            'search',
            'when did we',
            'have we ever',
            'last time'
        ];

        // Verifica patterns
        for (const pattern of meetingPatterns) {
            if (lower.includes(pattern)) return 'meeting';
        }

        for (const pattern of globalPatterns) {
            if (lower.includes(pattern)) return 'global';
        }

        // Default based em contexto
        return currentMeetingId ? 'meeting' : 'global';
    }
}
