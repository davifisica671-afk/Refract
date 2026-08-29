/**
 * =============================================================================
 * SessionTracker.ts — GERENCIADOR DE ESTADO DA SESSÃO
 * =============================================================================
 * 
 * DESCRIÇÃO:
 * Mantém TODO o estado durante uma reunião ao vivo. Pense nele como
 * o "memória de trabalho" do app durante uma entrevista.
 * 
 * DADOS QUE RASTREIA:
 * 
 * 1. TRANSCRIÇÃO COMPLETA:
 *    - fullTranscript[]: Cada trecho falado (quem falou, o quê, quando)
 *    - Cada segmento tem: speaker, text, timestamp, final (se é definitive)
 * 
 * 2. CONTEXTO DESLIZANTE:
 *    - contextItems[]: Últimos 120 segundos de conversa
 *    - Usado para alimentar prompts de IA (quanto contexto enviar)
 *    - Compactado automaticamente quando cresce demais
 * 
 * 3. RESUMOS DE ÉPOCA:
 *    - transcriptEpochSummaries[]: Resumos compactos de períodos anteriores
 *    - Preserva contexto quando a transcrição é compactada
 *    - Máximo 5 resumos de época
 * 
 * 4. HISTÓRICO DE PERGUNTAS:
 *    - detectedCodingQuestion: Se uma pergunta de código foi detectada
 *    - lastAssistantMessage: Última resposta do assistente (para follow-up)
 *    - assistantResponseHistory: Todas as respostas (anti-repetição)
 * 
 * 5. METADADOS DA REUNIÃO:
 *    - Título, fonte (manual/calendar), evento do calendário
 * 
 * POR QUE É SEPARADO:
 * - O IntelligenceEngine (IA) não deve conhecer detalhes de armazenamento
 * - O SessionTracker não deve saber nada sobre LLMs
 * - Separação de responsabilidades (Single Responsibility Principle)
 * =============================================================================
 */

// SessionTracker.ts
// Gerencia sessão sestado transcript arrays, contexto windows, e epoch compaction.
// Extracted de IntelligenceManager para decouple estado management de LLM orchestration.

import { RecapLLM } from './llm';
import { isVerboseLogging } from './verboseLog';

export interface TranscriptSegment {
    marker?: string;
    speaker: string;
    // Optional canonical speaker id de provedor diarization (e.g. "speaker_2"). Apenas define em
    // o remote/system channel quando diarization é enabled; o mic channel é sempre "me".
    // Additive — summary normalization lê it quando present, tudo senão ignora it.
    speakerId?: string;
    text: string;
    timestamp: number;
    final: boolean;
    confidence?: number;
}

export interface SuggestionTrigger {
    context: string;
    lastQuestion: string;
    confidence: number;
}

// Contexto item matching Swift ContextManager structure
export interface ContextItem {
    role: 'interviewer' | 'user' | 'assistant';
    text: string;
    timestamp: number;
}

export interface AssistantResponse {
    text: string;
    timestamp: number;
    questionContext: string;
}

  export interface SessionMetadata {
    title?: string;
    calendarEventId?: string;
  }

export class SessionTracker {
    // Contexto management (mirrors Swift ContextManager)
    private contextItems: ContextItem[] = [];
    private readonly contextWindowDuration: number = 120; // 120 seconds
    private readonly maxContextItems: number = 500;

    // Último assistant mensagem para follow-up modo
    private lastAssistantMessage: string | null = null;

    // Temporal RAG: Track todos assistant responses em sessão para anti-repetition
    private assistantResponseHistory: AssistantResponse[] = [];

    // Meeting metadados
    private currentMeetingMetadata: {
        title?: string;
        calendarEventId?: string;
        source?: 'manual' | 'calendar';
    } | null = null;

    // Completo Sessão Tracking (Persisted)
    private fullTranscript: TranscriptSegment[] = [];
    private fullUsage: any[] = []; // UsageInteraction
    private sessionStartTime: number = Date.now();

    // Rolling summarization: epoch summaries preserve early contexto quando arrays são compacted
    private static readonly MAX_EPOCH_SUMMARIES = 5;
    private transcriptEpochSummaries: string[] = [];
    private isCompacting: boolean = false;

    // Track interim interviewer segment
    private lastInterimInterviewer: TranscriptSegment | null = null;

    // Detected coding question de transcript ou screenshot extraction
    private detectedCodingQuestion: string | null = null;
    private codingQuestionSource: 'screenshot' | 'transcript' | null = null;
    private codingQuestionSetAt: number | null = null;

    // Rolling buffer para multi-segment interviewer question detection
    private recentInterviewerBuffer: { text: string; timestamp: number }[] = [];
    private static readonly INTERVIEWER_BUFFER_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
    // Screenshot-detected question stays sticky para 3 min antes transcript pode sobrescrever
    private static readonly SCREENSHOT_STALE_MS = 3 * 60 * 1000;

    // Referência para RecapLLM para epoch summarization (injected ldepois
    private recapLLM: RecapLLM | null = null;

    // ============================================
    // Configuração
    // ============================================

    public setRecapLLM(recapLLM: RecapLLM | null): void {
        this.recapLLM = recapLLM;
    }

    public setMeetingMetadata(metadata: any): void {
        this.currentMeetingMetadata = metadata;
    }

    public getMeetingMetadata() {
        return this.currentMeetingMetadata;
    }

    public clearMeetingMetadata(): void {
        this.currentMeetingMetadata = null;
    }

    // ============================================
    // Coding Question Tracking
    // ============================================

    /**
     * Set o atual coding question.
     * Priority rules (avoids stale Q1 blocking Q2 detection in multi-question interviews):
     *  - Screenshot → sempre stored immediately (explicit user ação via Solve)
     *  - Transcript → stored se nothing is known yet, OR se existing question is também from
     *    transcript (newer detection = newer question), OR se screenshot question is stale
     *    (> 3 min antigo — user likely moved para o próximo question)
     */
    setCodingQuestion(question: string, source: 'screenshot' | 'transcript'): void {
        const now = Date.now();
        const trimmed = question.trim();
        if (!trimmed) return;

        if (this.detectedCodingQuestion === null) {
            // Nada stored — accept qualquer fonte
            this.detectedCodingQuestion = trimmed;
            this.codingQuestionSource = source;
            this.codingQuestionSetAt = now;
            console.log(`[SessionTracker] Coding question stored`, { source, length: trimmed.length });
            return;
        }

        if (source === 'screenshot') {
            // Screenshot sempre atualiza imediatamente (explicit user Solve aação
            this.detectedCodingQuestion = trimmed;
            this.codingQuestionSource = source;
            this.codingQuestionSetAt = now;
            console.log(`[SessionTracker] Coding question updated via screenshot`, { length: trimmed.length });
            return;
        }

        // fonte === 'transcript'
        const isStale = this.codingQuestionSetAt !== null
            && (now - this.codingQuestionSetAt) > SessionTracker.SCREENSHOT_STALE_MS;
        const canOverride = this.codingQuestionSource === 'transcript' || isStale;

        if (canOverride) {
            this.detectedCodingQuestion = trimmed;
            this.codingQuestionSource = source;
            this.codingQuestionSetAt = now;
            console.log(`[SessionTracker] Coding question updated via transcript`, { source: this.codingQuestionSource, stale: isStale, length: trimmed.length });
        } else {
            console.log(`[SessionTracker] Transcript question ignored — screenshot question is recent (< ${SessionTracker.SCREENSHOT_STALE_MS / 1000}s)`);
        }
    }

    getDetectedCodingQuestion(): { question: string | null; source: 'screenshot' | 'transcript' | null } {
        return { question: this.detectedCodingQuestion, source: this.codingQuestionSource };
    }

    clearCodingQuestion(): void {
        this.detectedCodingQuestion = null;
        this.codingQuestionSource = null;
        this.codingQuestionSetAt = null;
        this.recentInterviewerBuffer = [];
    }

    /**
     * Clear todos mode-specific transient context.
     * Called quando o user switches modes mid-meeting para prevent o antigo mode's
     * context (Interviewer Q's, JD context, assistant responses, etc.) from
     * bleeding em o novo mode's responses.
     */
    clearSessionContext(): void {
        this.contextItems = [];
        this.detectedCodingQuestion = null;
        this.codingQuestionSource = null;
        this.codingQuestionSetAt = null;
        this.recentInterviewerBuffer = [];
        this.lastAssistantMessage = null;
        this.assistantResponseHistory = [];
        this.lastInterimInterviewer = null;
        console.log('[SessionTracker] Mode-specific session context cleared');
    }

    /**
     * Heuristic para decide se an interviewer statement looks like a coding question.
     * Requires ≥2 of o signal patterns e minimum length para avoid falso positives
     * on casual conversation ("can you implement X?" → yes, "sounds good!" → no).
     */
    private looksLikeCodingQuestion(text: string): boolean {
        if (text.length < 50) return false;
        const patterns = [
            /\b(implement|write|code|solve|design|build|create)\b/i,
            /\b(given\s+(an?|the)\s+(array|string|list|tree|graph|matrix|number|integer|node|linked list|stack|queue|heap))\b/i,
            /\b(return|find\s+(all|the|a|any)|count|check\s+if|determine|calculate|maximize|minimize|sort)\b/i,
            /\b(function|method|algorithm|data structure|class)\b/i,
            /\b(O\(n\)|time complexity|space complexity|optimal|efficient|brute force)\b/i,
            /\b(two sum|three sum|binary search|dynamic programming|BFS|DFS|palindrome|anagram|substring|subarray|rotation)\b/i,
        ];
        const matchCount = patterns.filter(p => p.test(text)).length;
        return matchCount >= 2;
    }

    // ============================================
    // Contexto Management
    // ============================================

    /**
     * Add a transcript segment para context.
     * Only stores FINAL transcripts.
     * Returns { role, isRefinementCandidate } so o engine pode decide whether para acionar follow-up.
     */
    addTranscript(segment: TranscriptSegment): { role: 'interviewer' | 'user' | 'assistant' } | null {
        if (!segment.final) return null;

        const role = this.mapSpeakerToRole(segment.speaker);
        const text = segment.text.trim();

        if (!text) return null;

        // Deduplicate: verifica se isso exact item já exists
        const lastItem = this.contextItems[this.contextItems.length - 1];
        if (lastItem &&
            lastItem.role === role &&
            Math.abs(lastItem.timestamp - segment.timestamp) < 500 &&
            lastItem.text === text) {
            return null;
        }

        this.contextItems.push({
            role,
            text,
            timestamp: segment.timestamp
        });

        this.evictOldEntries();

        // Filtrar fora apenas exact internal system prompts (não broad prefix match)
        // These são injected internally e deve não ser treated como real transcript
        const knownInternalPrompts = [
            "You are a real-time interview assistant",
            "You are a helper",
        ];
        const isExactInternalPrompt = knownInternalPrompts.some(p => text === p);
        const isContextInjection = text.startsWith("CONTEXT:");
        const isInternalPrompt = isExactInternalPrompt || isContextInjection;

        if (!isInternalPrompt) {
            // Adiciona para sessão transcript
            this.fullTranscript.push(segment);
            // Compact transcript com summarization em vez disso de losing early contexto
            // Fire-and-forget: sincronizar ccontexto errors são caught internally
            void this.compactTranscriptIfNeeded().catch(e =>
                console.warn('[SessionTracker] compactTranscript error (non-fatal):', e)
            );
        }

        return { role };
    }

    /**
     * Add assistant-generated mensagem para context
     */
    addAssistantMessage(text: string): void {
        console.log(`[SessionTracker] addAssistantMessage called`, { length: text.length });

        // Refract-style filtering
        if (!text) return;

        const cleanText = text.trim();
        if (cleanText.length < 10) {
            console.warn(`[SessionTracker] Ignored short message (<10 chars)`);
            return;
        }

        if (cleanText.includes("I'm not sure") || cleanText.includes("I can't answer")) {
            console.warn(`[SessionTracker] Ignored fallback message`);
            return;
        }

        this.contextItems.push({
            role: 'assistant',
            text: cleanText,
            timestamp: Date.now()
        });

        // Também adiciona para fullTranscript então it persists em o sessão history (and summaries)
        this.fullTranscript.push({
            speaker: 'assistant',
            text: cleanText,
            timestamp: Date.now(),
            final: true,
            confidence: 1.0
        });

        // Compact transcript com summarization em vez disso de losing early contexto
        // Fire-and-forget: sincronizar ccontexto errors são caught internally
        void this.compactTranscriptIfNeeded().catch(e =>
            console.warn('[SessionTracker] compactTranscript error (non-fatal):', e)
        );

        this.lastAssistantMessage = cleanText;

        // Temporal RAG: Track resposta history para anti-repetition
        this.assistantResponseHistory.push({
            text: cleanText,
            timestamp: Date.now(),
            questionContext: this.getLastInterviewerTurn() || 'unknown'
        });

        // Keep history bounded (último 10 responses)
        if (this.assistantResponseHistory.length > 10) {
            this.assistantResponseHistory = this.assistantResponseHistory.slice(-10);
        }

        console.log(`[SessionTracker] lastAssistantMessage updated, history size: ${this.assistantResponseHistory.length}`);
        this.evictOldEntries();
    }

    /**
     * Handle incoming transcript de native audio service
     */
    handleTranscript(segment: TranscriptSegment): { role: 'interviewer' | 'user' | 'assistant' } | null {
        // Track interim segments para interviewer para prevenir dados loss em para
        if (segment.speaker === 'user') {
            if (isVerboseLogging() && (Math.random() < 0.05 || segment.final)) {
                console.log(`[SessionTracker] RX User Segment`, { final: segment.final, length: segment.text.length });
            }
        }
        if (segment.speaker === 'interviewer') {
            if (isVerboseLogging() && (Math.random() < 0.05 || segment.final)) {
                console.log(`[SessionTracker] RX Interviewer Segment`, { final: segment.final, length: segment.text.length });
            }

            if (!segment.final) {
                this.lastInterimInterviewer = segment;
            } else {
                this.lastInterimInterviewer = null;

                // Adiciona segment para rolling buffer e evict antigo entries
                this.recentInterviewerBuffer.push({ text: segment.text, timestamp: segment.timestamp });
                const bufferCutoff = Date.now() - SessionTracker.INTERVIEWER_BUFFER_WINDOW_MS;
                this.recentInterviewerBuffer = this.recentInterviewerBuffer.filter(e => e.timestamp >= bufferCutoff);

                // Testar único segment fprimeiro se não match, testar accumulated recente turns
                // (interviewer pode estado a problem através múltiplos speech segments)
                if (this.looksLikeCodingQuestion(segment.text)) {
                    this.setCodingQuestion(segment.text, 'transcript');
                } else if (this.recentInterviewerBuffer.length > 1) {
                    const combinedText = this.recentInterviewerBuffer.map(e => e.text).join(' ');
                    if (this.looksLikeCodingQuestion(combinedText)) {
                        this.setCodingQuestion(combinedText, 'transcript');
                    }
                }
            }
        }

        return this.addTranscript(segment);
    }

    // ============================================
    // Contexto Accessors
    // ============================================

    /**
     * Get context items dentro o último N seconds
     */
    getContext(lastSeconds: number = 120): ContextItem[] {
        const cutoff = Date.now() - (lastSeconds * 1000);
        return this.contextItems.filter(item => item.timestamp >= cutoff);
    }

    /**
     * DURABLE context janela (Intelligence OS, 2026-06-12). Unlike `getContext()`,
     * que reads `contextItems` — hard-evicted para `contextWindowDuration` (120s) on
     * EVERY final segment by `evictOldEntries()` — isso reads `fullTranscript`, the
     * session's persisted armazenar que survives o 120s eviction. It exists para make
     * genuinely long-range recall possible: a project named at minute 1 is still
     * present at minute 62.
     *
     * WHY THIS METHOD EXISTS: `IntelligenceEngine.LIVE_MEMORY_WINDOW_SECONDS = 7200`
     * fed `getContext(7200)` em o long-range follow-up memory e assumed a 2h
     * window. But `contextItems` pode nunca hold more than ~120s, so que path
     * silently saw at most o último two minutes — o long-range entity it was built
     * para recall had already been evicted. Pointing it at o durable armazenar fixes the
     * bug para o comum case (a multi-minute session sob o compaction threshold).
     *
     * BOUND: depois a >1800-segment session `compactTranscriptIfNeeded` summarizes and
     * evicts o OLDEST 500 raw segments em an epoch summary, so isso returns only
     * o raw segments STILL RESIDENT — a minute-1 entity in a *very* long session can
     * still age out of o raw armazenar em a summary. That's a far higher barra than the
     * 120s `contextItems` eviction isso fixes; para o completo summary-prefixed visualização see
     * `getFullSessionContext()`.
     *
     * @param lastSeconds Window tamanho in seconds (default 7200 = 2h). `Infinity`
     *   returns o entire resident transcript.
     */
    getDurableContext(lastSeconds: number = 7200): ContextItem[] {
        const cutoff = Number.isFinite(lastSeconds)
            ? Date.now() - (lastSeconds * 1000)
            : -Infinity;
        const out: ContextItem[] = [];
        for (const seg of this.fullTranscript) {
            if (seg.timestamp < cutoff) continue;
            const text = (seg.text || '').trim();
            if (!text) continue;
            out.push({ role: this.mapSpeakerToRole(seg.speaker), text, timestamp: seg.timestamp });
        }
        return out;
    }

    getLastAssistantMessage(): string | null {
        return this.lastAssistantMessage;
    }

    getAssistantResponseHistory(): AssistantResponse[] {
        return this.assistantResponseHistory;
    }

    getLastInterimInterviewer(): TranscriptSegment | null {
        return this.lastInterimInterviewer;
    }

    /**
     * Context items para LLM prompts, including o latest interim interviewer
     * parcial quando finals have não caught up yet (matches What para Answer path).
     */
    getContextWithInterim(lastSeconds: number = 120): ContextItem[] {
        const contextItems = [...this.getContext(lastSeconds)];

        const lastInterim = this.lastInterimInterviewer;
        if (lastInterim && lastInterim.text.trim().length > 0) {
            const lastItem = contextItems[contextItems.length - 1];
            const isDuplicate = lastItem &&
                lastItem.role === 'interviewer' &&
                (lastItem.text === lastInterim.text ||
                    Math.abs(lastItem.timestamp - lastInterim.timestamp) < 1000);

            if (!isDuplicate) {
                contextItems.push({
                    role: 'interviewer',
                    text: lastInterim.text,
                    timestamp: lastInterim.timestamp,
                });
            }
        }

        return contextItems;
    }

    /**
     * Get formatted context string para LLM prompts
     */
    getFormattedContext(lastSeconds: number = 120): string {
        return this.formatContextItems(this.getContext(lastSeconds));
    }

    /**
     * Formatted context including rolling interim interviewer speech.
     */
    getFormattedContextWithInterim(lastSeconds: number = 120): string {
        return this.formatContextItems(this.getContextWithInterim(lastSeconds));
    }

    private formatContextItems(items: ContextItem[]): string {
        return items.map(item => {
            const label = item.role === 'interviewer' ? 'INTERVIEWER' :
                item.role === 'user' ? 'ME' :
                    'ASSISTANT (PREVIOUS SUGGESTION)';
            return `[${label}]: ${item.text}`;
        }).join('\n');
    }

    /**
     * Get o último interviewer turn
     */
    getLastInterviewerTurn(): string | null {
        for (let i = this.contextItems.length - 1; i >= 0; i--) {
            if (this.contextItems[i].role === 'interviewer') {
                return this.contextItems[i].text;
            }
        }
        return null;
    }

    /**
     * Get completo session context de accumulated transcript (User + Interviewer + Assistant)
     */
    getFullSessionContext(): string {
        const recentTranscript = this.fullTranscript.map(segment => {
            const role = this.mapSpeakerToRole(segment.speaker);
            const label = role === 'interviewer' ? 'INTERVIEWER' :
                role === 'user' ? 'ME' :
                    'ASSISTANT';
            return `[${label}]: ${segment.text}`;
        }).join('\n');

        // Prepend epoch summaries para completo sessão contexto preservation
        if (this.transcriptEpochSummaries.length > 0) {
            const epochContext = this.transcriptEpochSummaries.join('\n---\n');
            return `[SESSION HISTORY - EARLIER DISCUSSION]\n${epochContext}\n\n[RECENT TRANSCRIPT]\n${recentTranscript}`;
        }

        return recentTranscript;
    }

    // ============================================
    // Sessão Data Accessors (para MeetingPersistence)
    // ============================================

    getFullTranscript(): TranscriptSegment[] {
        return this.fullTranscript;
    }

    getFullUsage(): any[] {
        return this.fullUsage;
    }

    getRecentManualTurn(maxAgeMs: number = 5 * 60 * 1000): { question: string; answer: string; timestamp: number } | null {
        // Usage entries são appended chronologically por atual callers; se a future
        // restore/replay caminho pushes out-of-order entries, ordenar por timestamp haqui
        const cutoff = Date.now() - maxAgeMs;
        for (let i = this.fullUsage.length - 1; i >= 0; i--) {
            const entry = this.fullUsage[i];
            if (!entry || entry.timestamp < cutoff) continue;
            if (entry.type !== 'chat') continue;
            if (entry.source !== 'manual_chat') continue;
            if (entry.synthetic === true) continue;

            const question = typeof entry.question === 'string' ? entry.question.trim() : '';
            const answer = typeof entry.answer === 'string' ? entry.answer.trim() : '';
            if (!question || !answer) continue;
            if (question === 'Clarify Question' || question === 'Recap Meeting') continue;

            return { question, answer, timestamp: entry.timestamp };
        }
        return null;
    }

    getSessionStartTime(): number {
        return this.sessionStartTime;
    }

    // ============================================
    // Usage Tracking
    // ============================================

    /**
     * Cap usage array com simple eviction (usage doesn't precisa summarization)
     */
    capUsageArray(): void {
        if (this.fullUsage.length > 500) {
            this.fullUsage = this.fullUsage.slice(-500);
        }
    }

    /**
     * Public método para registro usage de external sources (e.g. IPC direct chat)
     */
    logUsage(type: string, question: string, answer: string): void {
        this.fullUsage.push({
            type,
            timestamp: Date.now(),
            question,
            answer,
            source: type === 'chat' ? 'manual_chat' : 'external',
        });
        this.capUsageArray();
    }

    pushUsage(entry: any): void {
        this.fullUsage.push(entry);
        this.capUsageArray();
    }

    // ============================================
    // Interim Transcript Flush
    // ============================================

    /**
     * Force-save any pendente interim transcript (called on meeting stop)
     */
    flushInterimTranscript(): void {
        if (this.lastInterimInterviewer) {
            console.log('[SessionTracker] Force-saving pending interim transcript', { length: this.lastInterimInterviewer.text.length });
            const finalSegment = { ...this.lastInterimInterviewer, final: true };
            this.addTranscript(finalSegment);
            this.lastInterimInterviewer = null;
        }
    }

    // ============================================
    // Reinicia
    // ============================================

    reset(): void {
        this.contextItems = [];
        this.fullTranscript = [];
        this.fullUsage = [];
        this.transcriptEpochSummaries = [];
        this.sessionStartTime = Date.now();
        this.lastAssistantMessage = null;
        this.assistantResponseHistory = [];
        this.lastInterimInterviewer = null;
        this.detectedCodingQuestion = null;
        this.codingQuestionSource = null;
        this.codingQuestionSetAt = null;
        this.recentInterviewerBuffer = [];
    }

    // ============================================
    // Private Helpers
    // ============================================

    mapSpeakerToRole(speaker: string): 'interviewer' | 'user' | 'assistant' {
        if (speaker === 'user') return 'user';
        if (speaker === 'assistant') return 'assistant';
        return 'interviewer'; // system audio = interviewer
    }

    private evictOldEntries(): void {
        const cutoff = Date.now() - (this.contextWindowDuration * 1000);
        this.contextItems = this.contextItems.filter(item => item.timestamp >= cutoff);

        // Safety limit
        if (this.contextItems.length > this.maxContextItems) {
            this.contextItems = this.contextItems.slice(-this.maxContextItems);
        }
    }

    /**
     * Compact transcript buffer by summarizing oldest entries em an epoch summary.
     * Called instead of raw slice() para preserve early meeting context.
     */
    private async compactTranscriptIfNeeded(): Promise<void> {
        if (this.fullTranscript.length <= 1800 || this.isCompacting) return;

        this.isCompacting = true;
        try {
            // Take o oldest 500 entries para resumir
            const summarizeCount = 500;
            const oldEntries = this.fullTranscript.slice(0, summarizeCount);
            const summaryInput = oldEntries.map(seg => {
                const role = this.mapSpeakerToRole(seg.speaker);
                const label = role === 'interviewer' ? 'INTERVIEWER' :
                    role === 'user' ? 'ME' : 'ASSISTANT';
                return `[${label}]: ${seg.text}`;
            }).join('\n');

            // Fire-and-forget LLM summarization (non-blocking)
            if (this.recapLLM) {
                try {
                    const epochSummary = await this.recapLLM.generate(
                        `Summarize this conversation segment into 3-5 concise bullet points preserving key topics, decisions, and questions:\n\n${summaryInput}`
                    );
                    if (epochSummary && epochSummary.trim().length > 0) {
                        this.transcriptEpochSummaries.push(epochSummary.trim());
                        console.log(`[SessionTracker] Epoch summary created (${this.transcriptEpochSummaries.length} total)`);
                    } else {
                        // Empty LLM resposta — armazenamento a basic marker então contexto é não lost
                        const marker = `[Earlier discussion: ${oldEntries.length} segments summarized without transcript snippets.]`;
                        this.transcriptEpochSummaries.push(marker);
                    }
                } catch (e) {
                    // If summarization fails, armazenamento a simples marker
                    const fallback = `[Earlier discussion: ${oldEntries.length} segments summarized without transcript snippets.]`;
                    this.transcriptEpochSummaries.push(fallback);
                    console.warn('[SessionTracker] Epoch summarization failed, using fallback marker');
                }
            } else {
                // BUG-03 fix: recapLLM não ainda disponível — sempre push a plain marker então early
                // contexto é não silently discarded com não registro em transcriptEpochSummaries.
                const marker = `[Earlier discussion (no LLM): ${oldEntries.length} segments summarized without transcript snippets.]`;
                this.transcriptEpochSummaries.push(marker);
                console.warn('[SessionTracker] recapLLM not available — storing plain epoch marker');
            }

            // Cap epoch summaries para prevenir LLM contexto janela overflow
            if (this.transcriptEpochSummaries.length > SessionTracker.MAX_EPOCH_SUMMARIES) {
                this.transcriptEpochSummaries = this.transcriptEpochSummaries.slice(-SessionTracker.MAX_EPOCH_SUMMARIES);
            }

            // Evict Apenas o exact 500 oldest entries que we apenas summarized
            this.fullTranscript = this.fullTranscript.slice(summarizeCount);
        } finally {
            this.isCompacting = false;
        }
    }
}
