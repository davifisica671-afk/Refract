/**
 * =============================================================================
 * IntelligenceManager.ts — FACHADA DO SISTEMA DE INTELIGÊNCIA
 * =============================================================================
 * 
 * DESCRIÇÃO:
 * Fachada fina (Facade Pattern) que esconde a complexidade dos 3 submódulos
 * de inteligência e mantém compatibilidade retroativa com chamadores existentes.
 * 
 * SUBMÓDULOS INTERNOS:
 * 
 * 1. SessionTracker — Gerencia estado da sessão:
 *    - Arrays de transcrição (o que foi falado)
 *    - Gerenciamento de contexto (últimos N segundos)
 *    - Compactação de epochs (resumo periódico)
 *    - Detecção de programação (identifica perguntas de código)
 * 
 * 2. IntelligenceEngine — Roteamento de modos LLM (6+ modos):
 *    - assist: Assistente geral
 *    - whatToSay: "O que devo dizer?" (resposta ao vivo)
 *    - followUp: Refinamento de resposta
 *    - recap: Resumo da reunião
 *    - clarify: Esclarecimento de dúvida
 *    - manual: Pergunta digitada pelo usuário
 *    - codeHint: Dica de código
 *    - brainstorm: Brainstorming
 *    - followUpQuestions: Perguntas de acompanhamento
 * 
 * 3. MeetingPersistence — Salva e recupera reuniões:
 *    - Para reunião → snapshot dos dados
 *    - Gera título automaticamente via LLM
 *    - Gera resumo estruturado (V3) via LLM
 *    - Salva no SQLite (banco local)
 *    - Regenera notas sob demanda
 * 
 * FLUXO DE DADOS:
 *   Áudio → STT (texto) → SessionTracker (contexto) 
 *   → IntelligenceEngine (roteamento + LLM) → Resposta → Renderer (UI)
 * 
 * POR QUE É UMA FACHADA:
 * Chamadores antigos (ipcHandlers.ts, main.ts) chamam inteligenciaManager.method().
 * Sem a fachada, eles precisariam saber qual submódulo usar, criar instâncias,
 * e gerenciar o ciclo de vida. A fachada simplifica para uma única API.
 * =============================================================================
 */

// IntelligenceManager.ts
// Fachada fina que delega para submódulos especializados.
// Mantém compatibilidade total retroativa — todos os chamadores existentes continuam funcionando sem alterações.
//
// Submódulos:
//   SessionTracker     — arrays de transcrição de estado, gerenciamento de contexto, compactação de epochs
//   IntelligenceEngine — roteamento de modo LLM (6 modos), emissão de eventos
//   MeetingPersistence — parada/salvamento/recuperação de reuniões

import { EventEmitter } from 'events';
import { LLMHelper } from './LLMHelper';
import { SessionTracker } from './SessionTracker';
import { IntelligenceEngine } from './IntelligenceEngine';
import { MeetingPersistence } from './MeetingPersistence';
import { ScreenContext } from './services/screen/ScreenContextService';

// Re-exportar tipos para compatibilidade retroativa
export type { TranscriptSegment, SuggestionTrigger, ContextItem } from './SessionTracker';
export type { IntelligenceMode, IntelligenceModeEvents } from './IntelligenceEngine';
export type { DynamicAction } from './services/dynamic-actions/DynamicAction';

export const GEMINI_FLASH_MODEL = "gemini-3.5-flash";
export const GEMINI_FLASH_LITE_MODEL = "gemini-3.1-flash-lite";

/**
 * IntelligenceManager - Fachada para a camada de inteligência.
 * 
 * Delega para:
 * - SessionTracker:     transcrições de contexto, resumos de epochs
 * - IntelligenceEngine: modos LLM (assist, whatToSay, followUp, recap, clarify, manual, followUpQuestions)
 * - MeetingPersistence: parada/salvamento/recuperação de reuniões
 */
export class IntelligenceManager extends EventEmitter {
    private session: SessionTracker;
    private engine: IntelligenceEngine;
    private persistence: MeetingPersistence;

    constructor(llmHelper: LLMHelper) {
        super();
        this.session = new SessionTracker();
        this.engine = new IntelligenceEngine(llmHelper, this.session);
        this.persistence = new MeetingPersistence(this.session, llmHelper);

        // Conectar o LLMHelper usado pelo compilador assíncrono de prompt por seção (Fase 16b).
        // Compilação fire-and-forget executa quando o usuário adiciona/edita uma seção de nota ou modo personalizado
        try {
            const { ModesManager } = require('./services/ModesManager');
            ModesManager.setLlmHelperForCompiler(llmHelper);
        } catch { /* non-fatal */ }

        // Encaminhar todos os eventos do engine através da fachada
        this.forwardEngineEvents();
    }

    /**
     * Forward todos events de IntelligenceEngine através isso facade
     * so existing listeners on IntelligenceManager continue para work.
     */
    private forwardEngineEvents(): void {
        const events = [
            'assist_update', 'suggested_answer', 'suggested_answer_token', 'suggested_answer_discard',
            // Execução de código verificada (em segundo plano): ✓ badge + mensagem corrigida
            'code_verified', 'code_correction',
            'refined_answer', 'refined_answer_token',
            'recap', 'recap_token', 'clarify', 'clarify_token',
            'follow_up_questions_update', 'follow_up_questions_token',
            'manual_answer_started', 'manual_answer_result',
            'mode_changed', 'error',
            // Sprint 7: canal dedicado para cargas de coaching de negociação.
            'negotiation_coaching',
            // Fase 3: emissão de cartões de ação dinâmica estilo Refract.
            'dynamic_action_emitted',
        ];

        for (const event of events) {
            this.engine.on(event, (...args: any[]) => {
                this.emit(event, ...args);
            });
        }
    }

    // ============================================
    // LLM Initialization (delegates para engine)
    // ============================================

    initializeLLMs(): void {
        // Cancelar quaisquer streams em andamento antes de trocar clientes LLM
        this.engine.reset();
        this.engine.initializeLLMs();
    }

    reinitializeLLMs(): void {
        this.engine.reset();
        this.engine.reinitializeLLMs();
    }

    // ============================================
    // Gerenciamento de Contexto (delega para sessão)
    // ============================================

    setMeetingMetadata(metadata: any): void {
        this.session.setMeetingMetadata(metadata);
    }

    addTranscript(segment: import('./SessionTracker').TranscriptSegment, skipRefinementCheck: boolean = false): void {
        if (skipRefinementCheck) {
            // Adição direta sem detecção de refinamento
            this.session.addTranscript(segment);
        } else {
            // Deixar o engine lidar com transcrição + detecção de refinamento
            this.engine.handleTranscript(segment, false);
        }
    }

    addAssistantMessage(text: string): void {
        this.session.addAssistantMessage(text);
    }

    getContext(lastSeconds: number = 120) {
        return this.session.getContext(lastSeconds);
    }

    getLastAssistantMessage(): string | null {
        return this.session.getLastAssistantMessage();
    }

    getFormattedContext(lastSeconds: number = 120): string {
        return this.session.getFormattedContext(lastSeconds);
    }

    getLastInterviewerTurn(): string | null {
        return this.session.getLastInterviewerTurn();
    }

    /** Transcrição finalizada completa da reunião atual (para busca Fase 10 durante a reunião). */
    getCurrentMeetingTranscript(): Array<{ speaker: string; text: string; timestamp: number }> {
        return this.session.getFullTranscript().map(s => ({ speaker: s.speaker, text: s.text, timestamp: s.timestamp }));
    }

    logUsage(type: string, question: string, answer: string): void {
        this.session.logUsage(type, question, answer);
    }

    // ============================================
    // Transcript Handling (delegates para engine)
    // ============================================

    handleTranscript(segment: import('./SessionTracker').TranscriptSegment): void {
        this.engine.handleTranscript(segment);
    }

    async handleSuggestionTrigger(trigger: import('./SessionTracker').SuggestionTrigger): Promise<void> {
        return this.engine.handleSuggestionTrigger(trigger);
    }

    // ============================================
    // Modo Executors (delegates para engine)
    // ============================================

    async runAssistMode(): Promise<string | null> {
        return this.engine.runAssistMode();
    }

    async runWhatShouldISay(question?: string, confidence?: number, imagePaths?: string[], options?: { skipCooldown?: boolean; screenContext?: ScreenContext; promptInstruction?: string; activeSkill?: { id: string; name: string; promptBlock: string }; domContext?: string }): Promise<string | null> {
        return this.engine.runWhatShouldISay(question, confidence, imagePaths, options);
    }

    async runFollowUp(intent: string, userRequest?: string): Promise<string | null> {
        return this.engine.runFollowUp(intent, userRequest);
    }

    async runRecap(): Promise<string | null> {
        return this.engine.runRecap();
    }

    async runClarify(): Promise<string | null> {
        return this.engine.runClarify();
    }

    async runFollowUpQuestions(): Promise<string | null> {
        return this.engine.runFollowUpQuestions();
    }

    async runManualAnswer(question: string): Promise<string | null> {
        return this.engine.runManualAnswer(question);
    }

    async runCodeHint(imagePaths?: string[], problemStatement?: string): Promise<string | null> {
        return this.engine.runCodeHint(imagePaths, problemStatement);
    }

    setCodingQuestion(question: string, source: 'screenshot' | 'transcript'): void {
        this.session.setCodingQuestion(question, source);
    }

    getDetectedCodingQuestion(): { question: string | null; source: 'screenshot' | 'transcript' | null } {
        return this.session.getDetectedCodingQuestion();
    }

    clearCodingQuestion(): void {
        this.session.clearCodingQuestion();
    }

    async runBrainstorm(imagePaths?: string[], problemStatement?: string): Promise<string | null> {
        return this.engine.runBrainstorm(imagePaths, problemStatement);
    }

    // ============================================
    // Estado Management
    // ============================================

    getActiveMode() {
        return this.engine.getActiveMode();
    }

    setMode(mode: import('./IntelligenceEngine').IntelligenceMode): void {
        // This era privada não original, mas mantida para compatibilidade
        (this.engine as any).setMode(mode);
    }

    // ============================================
    // Ciclo de Vida da Reunião (delegates para persistence)
    // ============================================

    async stopMeeting(): Promise<string | null> {
        return this.persistence.stopMeeting();
    }

    async recoverUnprocessedMeetings(): Promise<void> {
        return this.persistence.recoverUnprocessedMeetings();
    }

    /** Regenerar notas V3 para uma reunião salva (opcionalmente com um modo/tom diferente). */
    async regenerateMeetingSummary(meetingId: string, opts?: { templateType?: string; tone?: 'professional' | 'warm' | 'concise' | 'friendly' }): Promise<boolean> {
        return this.persistence.regenerateSavedMeeting(meetingId, opts);
    }

    /** Regenerar apenas o rascunho de acompanhamento para a reunião V3 salva. */
    async regenerateMeetingFollowUp(meetingId: string, tone?: 'professional' | 'warm' | 'concise' | 'friendly'): Promise<boolean> {
        return this.persistence.regenerateFollowUpDraft(meetingId, tone);
    }

    // ============================================
    // Gerenciamento de Contexto de Modo
    // ============================================

    /**
     * Clear mode-specific transient context sem resetting o completo session.
     * Called quando user switches modes para prevent antigo mode's context (Interviewer
     * Q's, JD context, assistant resposta history) de bleeding em o novo mode.
     */
    clearSessionContext(): void {
        this.session.clearSessionContext();
    }

    // ============================================
    // Fase 3 — Fachada de Ações Dinâmicas
    // ============================================

    /**
     * Bind dynamic-action engine para o ativo meeting/mode.
     * Caller is o IPC manipulador que starts a meeting (with sessionId) or
     * o modes:set-active manipulador que switches o ativo mode mid-meeting.
     */
    setDynamicActionContext(params: { sessionId: string; modeId: string; modeTemplateType: string }): void {
        this.engine.setDynamicActionContext(params);
    }

    clearDynamicActionContext(): void {
        this.engine.clearDynamicActionContext();
    }

    acceptDynamicAction(actionId: string): import('./services/dynamic-actions/DynamicAction').DynamicAction | null {
        return this.engine.acceptDynamicAction(actionId);
    }

    dismissDynamicAction(actionId: string): void {
        this.engine.dismissDynamicAction(actionId);
    }

    getActiveDynamicActions(): import('./services/dynamic-actions/DynamicAction').DynamicAction[] {
        return this.engine.getActiveDynamicActions();
    }

    // ============================================
    // Reinicialização (reinicia todos os submódulos)
    // ============================================

    /**
     * resetEngine: Cancel in-flight LLM streams WITHOUT touching session state.
     * Use isso quando swapping API keys ou providers mid-session so o transcript
     * is não wiped. (full reset() também clears o session — apenas use que at
     * end of meeting ou explicit session teardown.)
     */
    resetEngine(): void {
        this.engine.reset();
    }

    reset(): void {
        this.session.reset();
        this.engine.reset();
    }
}
