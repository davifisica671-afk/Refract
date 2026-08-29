/**
 * =============================================================================
 * MeetingPersistence.ts — PERSISTÊNCIA E CICLO DE VIDA DE REUNIÕES
 * =============================================================================
 * 
 * DESCRIÇÃO:
 * Gerencia todo o ciclo de vida de uma reunião APÓS ela terminar:
 * parada → snapshot → processamento em background → salvamento.
 * 
 * FLUXO COMPLETO:
 * 
 * 1. PARADA (stopMeeting):
 *    - Força salvar transcrição interim (dados parciais)
 *    - Verifica se reunião é muito curta (< 1s → descarta)
 *    - Verifica política de retenção (never → descarta tudo)
 *    - Tira snapshot de todos os dados ANTES de resetar estado
 *    - Reseta estado imediatamente (novo pode iniciar)
 *    - Salva placeholder no SQLite ("Processing...")
 *    - Dispara processamento em background
 * 
 * 2. PROCESSAMENTO EM BACKGROUND (processAndSaveMeeting):
 *    - Gera TÍTULO via LLM (ex: "Entrevista Técnica - Empresa X")
 *    - Gera RESUMO ESTRUTURADO V3 via LLM:
 *      * Resumo geral
 *      * Itens de ação (o que foi decidido)
 *      * Pontos-chave (tópicos importantes)
 *    - Extrai entidades (pessoas, empresas, tecnologias)
 *    - Indexa para RAG (busca semântica futura)
 *    - Atualiza placeholder no SQLite com dados reais
 *    - Notifica renderer que reunião foi processada
 * 
 * 3. RECUPERAÇÃO:
 *    - recoverUnprocessedMeetings: Processa reuniões que falharam
 *    - regenerateMeetingSummary: Regenera notas com modo/tom diferente
 *    - regenerateMeetingFollowUp: Gera rascunho de follow-up por e-mail
 * 
 * PRIVACIDADE:
 * - Política "never" impede persistência (não salva nada)
 * - Per-meeting toggle "doNotPersist" permite não salvar reuniões específicas
 * - Fail-secure: em caso de erro ao ler configurações, descarta por segurança
 * 
 * TELEMETRIA:
 * - Registra início/fim de cada fase do processamento
 * - Acompanha latência de cada chamada LLM
 * - Rastreia uso de memória de longo prazo (Hindsight)
 * =============================================================================
 */

// MeetingPersistence.ts
// Gerencia meeting lifecycle: spara ssalva e recovery.
// Extracted de IntelligenceManager para decouple DB operations de LLM orchestration.

import { SessionTracker, TranscriptSegment } from './SessionTracker';
import { LLMHelper } from './LLMHelper';
import { DatabaseManager, Meeting } from './db/DatabaseManager';
import { GROQ_TITLE_PROMPT, GROQ_SUMMARY_JSON_PROMPT } from './llm';
import { buildPostCallEnhancements } from './services/post-call/PostCallWorkflow';
import { MeetingContextAssembler } from './services/meeting/MeetingContextAssembler';
import type { MeetingSummaryTelemetryMeta } from './services/meeting/types';
import { MeetingMemoryService } from './intelligence/MeetingMemoryService';
import { LongTermMemoryService } from './intelligence/memory/LongTermMemoryService';
import { isIntelligenceFlagEnabled } from './intelligence/intelligenceFlags';
import { recordAttribution, hindsightModeFor } from './intelligence/IntelligenceAttribution';
import { telemetryService } from './services/telemetry/TelemetryService';
import type { ProviderDataScopePolicy } from './llm/ProviderRouter';
const crypto = require('crypto');

export class MeetingPersistence {
    private session: SessionTracker;
    private llmHelper: LLMHelper;

    constructor(session: SessionTracker, llmHelper: LLMHelper) {
        this.session = session;
        this.llmHelper = llmHelper;
    }

    /**
     * Stops o meeting immediately, snapshots data, e triggers fundo processing.
     * Returns immediately so UI pode switch.
     */
    public async stopMeeting(): Promise<string | null> {
        console.log('[MeetingPersistence] Stopping meeting and queueing save...');

        // 0. Force-save qualquer pendente interim transcript
        this.session.flushInterimTranscript();

        // 1. Snapshot válido dados Antes resetting
        const durationMs = Date.now() - this.session.getSessionStartTime();
        if (durationMs < 1000) {
            console.log("Meeting too short, ignoring.");
            this.session.reset();
            return null;
        }

        // Fase 9 — privacy gate: 'nnunca retention ou per-meeting do-not-persist
        // pula persistence entirely. We ainda emitir telemetry (sanitized) então
        // usage analytics work, mas Não transcript / Não summary / Não DB rlinha
        let doNotPersist = false;
        try {
            const { SettingsManager } = require('./services/SettingsManager');
            const retention = SettingsManager.getInstance().get('meetingRetention');
            if (retention === 'never') doNotPersist = true;
            // Per-meeting alternar é lê de SessionTracker meeting metadados
            // (e.g. define via o renderer "Fazer não persist isso meeting" toalternar
            const meta = this.session.getMeetingMetadata?.();
            if (meta && (meta as any).doNotPersist === true) doNotPersist = true;
        } catch (err) {
            console.error('[MeetingPersistence] Failed to read retention settings, defaulting to discard for safety:', err);
            doNotPersist = true; // Fail-secure fallback
        }
        if (doNotPersist) {
            console.log('[MeetingPersistence] doNotPersist set — skipping save (no DB row, no summary).');
            try {
                const { telemetryService } = require('./services/telemetry/TelemetryService');
                telemetryService.track({
                    name: 'meeting_stop',
                    properties: { persisted: false, reason: 'do_not_persist', durationMs },
                });
            } catch { /* non-fatal */ }
            this.session.reset();
            return null;
        }

        const snapshot = {
            transcript: [...this.session.getFullTranscript()],
            usage: [...this.session.getFullUsage()],
            startTime: this.session.getSessionStartTime(),
            durationMs: durationMs,
            context: this.session.getFullSessionContext()
        };

        // BUG-04 fix: snapshot metadados Antes rereinicia limpa it então o
        // fundo processAndSaveMeeting worker recebe o calendar info.
        const metadataSnapshot = this.session.getMeetingMetadata();

        // BUG-MODE-BLEEDING fix: snapshot o ativo modo Antes rereinicia então o
        // fundo processAndSaveMeeting worker uses o correto mode's note
        // sections até se o user switches modes antes assíncrono processing ccompleta
        let modeSnapshot: { id: string; name: string; templateType: string } | null = null;
        try {
            const { ModesManager } = require('./services/ModesManager');
            const activeMode = ModesManager.getInstance().getActiveMode();
            if (activeMode) {
                modeSnapshot = { id: activeMode.id, name: activeMode.name, templateType: activeMode.templateType };
                console.log(`[MeetingPersistence] Mode snapshot captured: "${activeMode.name}" (${activeMode.templateType})`);
            }
        } catch (modeErr: any) {
            console.warn('[MeetingPersistence] Failed to capture mode snapshot:', modeErr?.message);
        }

        // 2. Reinicia estado imediatamente então novo meeting pode inicia ou UI é clean
        this.session.reset();

        const meetingId = crypto.randomUUID();

        // 4. Initial Salva (Placeholder)
        const minutes = Math.floor(durationMs / 60000);
        const seconds = ((durationMs % 60000) / 1000).toFixed(0);
        const durationStr = `${minutes}:${Number(seconds) < 10 ? '0' : ''}${seconds}`;

        const placeholder: Meeting = {
            id: meetingId,
            title: "Processing...",
            date: new Date().toISOString(),
            duration: durationStr,
            summary: "Generating summary...",
            detailedSummary: { actionItems: [], keyPoints: [] },
            transcript: snapshot.transcript,
            usage: snapshot.usage,
            isProcessed: false,
            summaryStatus: 'queued'
        };

        try {
            DatabaseManager.getInstance().saveMeeting(placeholder, snapshot.startTime, durationMs);
            // Notifica Frontend
            const wins = require('electron').BrowserWindow.getAllWindows();
            wins.forEach((w: any) => w.webContents.send('meetings-updated'));
        } catch (e) {
            console.error("Failed to save placeholder", e);
        }

        this.processAndSaveMeeting(snapshot, meetingId, metadataSnapshot, modeSnapshot).catch(err => {
            console.error('[MeetingPersistence] Background processing failed:', err);
        });

        return meetingId;
    }

    /**
     * Heavy lifting: LLM Title, Summary, e DB Write
     */
    private async processAndSaveMeeting(
        data: { transcript: TranscriptSegment[], usage: any[], startTime: number, durationMs: number, context: string },
        meetingId: string,
        // BUG-04 fix: accept metadados snapshot então calendar info é não lost após session.reset()
        metadata?: { title?: string; calendarEventId?: string; source?: 'manual' | 'calendar' } | null,
        // BUG-MODE-BLEEDING fix: accept modo snapshot então assíncrono summary uses o modo que era
        // ativo quando meeting stopped, não qualquer que seja modo é ativo quando assíncrono processing rexecuta
        modeSnapshot?: { id: string; name: string; templateType: string } | null
    ): Promise<void> {
        let title = "Untitled Session";
        let summaryData: any = { actionItems: [], keyPoints: [] };
        let v3SummaryMeta: MeetingSummaryTelemetryMeta | null = null;
        let generationSucceeded = false;
        let postCallSummaryAllowed = true;
        // Fase 6 — post_call_summary lifecycle telemetry. Wrapped em try/catch
        // ao redor track calls então a telemetry sink fault nunca breaks persistence.
        const _postCallStart = Date.now();
        // ATTRIBUTION (tarefa Fase 3/9): prove o post-meeting memory pipeline ran.
        let _meetingMemoryRecorded = false;
        let _meetingMemoryCounts: { topics: number; decisions: number; actionItems: number; entities: number } | null = null;
        let _hindsightRetainQueued = false;
        try {
            telemetryService.track({
                name: 'post_call_summary_started',
                modeId: modeSnapshot?.id,
                properties: {
                    modeTemplateType: modeSnapshot?.templateType,
                    transcriptSegmentCount: data.transcript.length,
                    durationMs: data.durationMs,
                },
            });
        } catch { /* non-fatal */ }

        // Uso passed-in metadados snapshot (Não this.session.getMeetingMetadata() que é já cleared)
        let calendarEventId: string | undefined;
        let source: 'manual' | 'calendar' = 'manual';

        if (metadata) {
            if (metadata.title) title = metadata.title;
            if (metadata.calendarEventId) calendarEventId = metadata.calendarEventId;
            if (metadata.source) source = metadata.source;
        }

        // Escopo gate aplica para o entire post-call LLM summary pcaminho não apenas
        // mode-reference snippets. If denied, V3 é skipped e LLMHelper's existing
        // alternativa behavior gerencia o legacy caminho sem sending transcript para cloud.
        try {
            const { SettingsManager } = require('./services/SettingsManager');
            const scopePolicy = SettingsManager.getInstance().get('providerDataScopes') as ProviderDataScopePolicy | undefined;
            postCallSummaryAllowed = scopePolicy?.post_call_summary !== false;
        } catch { /* settings unavailable → keep existing default */ }

        try {
            // Gera Title (apenas se não define por calendar e summary escopo permite transcript LLM uuso
            if ((!metadata || !metadata.title) && postCallSummaryAllowed) {
                const titlePrompt = `Generate a concise 3-6 word title for this meeting context. Output ONLY the title text. Do not use quotes or conversational filler.`;
                const groqTitlePrompt = GROQ_TITLE_PROMPT;

                const titleContext = data.transcript
                    .map(segment => `${segment.speaker || 'speaker'}: ${segment.text || ''}`)
                    .join('\n')
                    .slice(0, 8000);
                const generatedTitle = await this.llmHelper.generateMeetingSummary(titlePrompt, titleContext, groqTitlePrompt);
                if (generatedTitle) title = generatedTitle.replace(/["*]/g, '').trim();
            }

            // Carrega template note sections para o modo que era ativo quando meeting stopped.
            // BUG-MODE-BLEEDING fix: uso o snapshotted mmodo não getActiveMode() que can
            // retorna a diferente modo se o user switched modes antes assíncrono processing completed.
            let modeNoteSections: Array<{ title: string; description: string; compiledPrompt?: string }> = [];
            let modeContextBlock = '';
            try {
                const { ModesManager, TEMPLATE_NOTE_SECTIONS } = require('./services/ModesManager');
                const modesMgr = ModesManager.getInstance();

                // Uso snapshot modo se available, caso contrário fall voltar para atual ativo modo (para recovery scenarios)
                const targetModeId = modeSnapshot?.id ?? modesMgr.getActiveMode()?.id;
                if (!targetModeId) {
                    console.log('[MeetingPersistence] No mode active — using generic summary.');
                } else {
                    // Obtém o mode's templateType de snapshot ou look it para cima
                    const templateType = modeSnapshot?.templateType ?? modesMgr.getModes().find((m: { id: string; templateType?: string }) => m.id === targetModeId)?.templateType;
                    const modeName = modeSnapshot?.name ?? modesMgr.getModes().find((m: { id: string; name?: string }) => m.id === targetModeId)?.name ?? 'Unknown';

                    // Prefer user's customized DB sections (carry compiledPrompt); fall voltar para canonical template
                    const dbSections: Array<{ title: string; description: string; compiledPrompt?: string }> = modesMgr.getNoteSections(targetModeId);
                    modeNoteSections = dbSections.length > 0
                        ? dbSections
                        : (templateType ? (TEMPLATE_NOTE_SECTIONS[templateType as keyof typeof TEMPLATE_NOTE_SECTIONS] ?? []) : []);
                    console.log(`[MeetingPersistence] Summary mode: "${modeName}" (${templateType}), sections: ${modeNoteSections.length} (${dbSections.length > 0 ? 'custom DB' : 'canonical template'})`);

                    // Build o summary-safe modo contexto block.
                    // Fase 6 — nunca inject raw reference-file bodies dentro de post-call summary
                    // prompts. Uso ModesManager.buildSummarySafeModeContextBlock(), que keeps
                    // o mode's customContext (trusted, low-token) e apenas adiciona retrieved
                    // referência snippets. Honors o providerDataScopes ppolítica
                    //   - `post_call_summary === false` → não modo contexto at todos
                    //   - `reference_files === false`   → customContext oapenas não retrieved snippets
                    if (modeSnapshot) {
                        let scopePolicy: ProviderDataScopePolicy | undefined = undefined;
                        try {
                            const { SettingsManager } = require('./services/SettingsManager');
                            scopePolicy = SettingsManager.getInstance().get('providerDataScopes');
                        } catch { /* non-fatal */ }
                        const summaryAllowed = scopePolicy?.post_call_summary !== false;
                        postCallSummaryAllowed = summaryAllowed;
                        const referenceSnippetsAllowed = scopePolicy?.reference_files !== false;

                        if (summaryAllowed) {
                            const transcriptHint = data.transcript
                                .map(segment => `${segment.speaker || 'speaker'}: ${segment.text || ''}`)
                                .join('\n')
                                .slice(0, 4000);
                            modeContextBlock = modesMgr.buildSummarySafeModeContextBlock(modeSnapshot.id, {
                                query: 'meeting summary',
                                transcript: transcriptHint,
                                tokenBudget: 1200,
                                includeReferenceSnippets: referenceSnippetsAllowed,
                            }) || '';
                        } else {
                            console.warn('[ScopeFallback] post_call_summary denied for cloud; routing to Ollama');
                            modeContextBlock = '';
                        }
                    }
                }
            } catch (modeErr: any) {
                console.warn('[MeetingPersistence] Failed to load mode sections:', modeErr?.message);
            }

            // Modo AUTO-DETECTION (Fase 10, atrás meetingModeAutoDetect). Deterministic,
            // não LLM, não provedor chamar — safe até quando post_call_summary escopo é denied.
            // Nunca switches o live mmodo apenas records a suggestion em summary.mode.detected*.
            let detectedMode: { templateType: string; modeId?: string; modeName?: string; confidence: number } | undefined;
            try {
                if (isIntelligenceFlagEnabled('meetingModeAutoDetect') && data.transcript.length > 2) {
                    const { MeetingModeDetector } = require('./services/meeting/MeetingModeDetector');
                    const detection = new MeetingModeDetector().detect({
                        transcript: data.transcript,
                        calendarTitle: metadata?.title,
                    });
                    if (detection.confidence > 0 && detection.templateType !== 'general') {
                        let modeId: string | undefined;
                        let modeName: string | undefined;
                        try {
                            const { ModesManager } = require('./services/ModesManager');
                            const match = ModesManager.getInstance().getModes().find((m: { id: string; name: string; templateType: string }) => m.templateType === detection.templateType);
                            if (match) { modeId = match.id; modeName = match.name; }
                        } catch { /* non-fatal */ }
                        detectedMode = { templateType: detection.templateType, modeId, modeName, confidence: detection.confidence };
                        console.log(`[MeetingPersistence] Mode auto-detect: ${detection.templateType} (conf ${detection.confidence})`);
                    }
                }
            } catch (detErr: any) {
                console.warn('[MeetingPersistence] Mode auto-detect skipped (non-fatal):', detErr?.message);
            }

            // Gera Structured Summary. V3 é o long-context pcaminho it nunca uses a
            // naïve transcript prefix como o primário summary ientrada If it fails ou é
            // disabled, o existing V2 single-pass caminho abaixo remains o compatibility fallback.
            if (data.transcript.length > 2 && isIntelligenceFlagEnabled('meetingSummaryV3') && postCallSummaryAllowed) {
                const db = DatabaseManager.getInstance();
                db.updateSummaryStatus(meetingId, 'queued');
                const assembler = new MeetingContextAssembler(this.llmHelper);
                const v3StartedMs = Date.now();
                const assembled = await assembler.assembleSummary({
                    transcript: data.transcript,
                    title,
                    modeTemplateType: modeSnapshot?.templateType,
                    modeNoteSections,
                    modeContextBlock,
                    modeMeta: {
                        ...(modeSnapshot?.id ? { selectedModeId: modeSnapshot.id } : {}),
                        ...(modeSnapshot?.name ? { selectedModeName: modeSnapshot.name } : {}),
                        ...(modeSnapshot?.templateType ? { selectedTemplateType: modeSnapshot.templateType } : {}),
                        ...(detectedMode ? {
                            ...(detectedMode.modeId ? { detectedModeId: detectedMode.modeId } : {}),
                            detectedModeName: detectedMode.modeName || detectedMode.templateType,
                            detectedConfidence: detectedMode.confidence,
                        } : {}),
                        summaryModeUsed: modeSnapshot?.templateType || 'general',
                    },
                    startedAtMs: v3StartedMs,
                    startedAtIso: new Date(v3StartedMs).toISOString(),
                    // Fase 8 — LLM follow-up draft. Gated por fflag escopo já enforced por
                    // postCallSummaryAllowed (we são dentro que branch).
                    generateFollowUpDraft: isIntelligenceFlagEnabled('followUpDraftV2'),
                    // #1 — constrained LLM Summary polish (note-content-only, gated, safe fallback).
                    polishSummary: isIntelligenceFlagEnabled('meetingSummaryLlmPolish'),
                    onStatusUpdate: status => db.updateSummaryStatus(meetingId, status),
                });
                v3SummaryMeta = assembled.meta;
                if (assembled.summary) {
                    const v3 = assembled.summary;
                    summaryData = {
                        schemaVersion: 3,
                        title: v3.title,
                        tldr: v3.tldr,
                        whatChanged: v3.whatChanged,
                        overview: v3.overview,
                        sectionsV3: v3.sections,
                        sections: v3.sections.map(section => ({ title: section.title, bullets: section.bullets.map(bullet => bullet.text) })),
                        decisions: v3.decisions,
                        actionItemsV3: v3.actionItems,
                        actionItems: v3.actionItems.map(item => item.text),
                        actionItemsStructured: v3.actionItems.map(item => ({
                            id: item.id || `action_${crypto.randomUUID()}`,
                            text: item.text,
                            ...(item.owner ? { owner: item.owner } : {}),
                            ...(item.deadline ? { deadline: item.deadline } : {}),
                            ...(typeof item.sourceTimestampMs === 'number' ? { sourceTimestamp: item.sourceTimestampMs } : {}),
                        })),
                        openQuestions: v3.openQuestions,
                        risks: v3.risks,
                        followUpDraft: v3.followUpDraft,
                        timeline: v3.timeline,
                        people: v3.people,
                        topics: v3.topics,
                        sourceQuality: v3.sourceQuality,
                        mode: v3.mode,
                        generation: v3.generation,
                        recipes: v3.recipes,
                        keyPoints: v3.tldr,
                        actionItemsTitle: 'Action Items',
                        keyPointsTitle: 'TLDR',
                    };
                    generationSucceeded = true;

                    // CROSS-MEETING RECALL (Fase 13, atrás meetingMemoryV2). Local-first,
                    // deterministic, não LLM, não network. Compares isso meeting's abrir
                    // questions/risks para recente prior meetings para surface "ainda abrir de
                    // último time". Degrades para nada quando lá é não prior history.
                    try {
                        if (isIntelligenceFlagEnabled('meetingMemoryV2')) {
                            const { CrossMeetingRecall, priorFromDetailedSummary } = require('./services/meeting/CrossMeetingRecall');
                            const recent = DatabaseManager.getInstance().getRecentMeetings(15)
                                .filter(m => m.id !== meetingId)
                                .map(priorFromDetailedSummary)
                                .filter((p: unknown): p is NonNullable<typeof p> => p !== null);
                            const recall = new CrossMeetingRecall().compute(v3, recent);
                            if (recall.stillOpen.length > 0) {
                                (summaryData as any).crossMeeting = recall;
                            }
                        }
                    } catch (xmErr) {
                        console.warn('[CrossMeetingRecall] skipped (non-fatal):', (xmErr as any)?.message);
                    }
                }
            }

            if (!postCallSummaryAllowed && isIntelligenceFlagEnabled('meetingSummaryV3')) {
                console.warn('[MeetingSummaryV3] post_call_summary scope denied — skipping V3 cloud summary path.');
            }

            if (summaryData.schemaVersion !== 3 && data.transcript.length > 2 && postCallSummaryAllowed) {
                const baseRules = `RULES:
- Do NOT invent information not present in the context
- You MAY infer implied action items or next steps if they are logical consequences of the discussion
- Do NOT explain or define concepts mentioned
- Do NOT use filler phrases like "The meeting covered..." or "Discussed various..."
- Do NOT mention transcripts, AI, or summaries
- Do NOT sound like an AI assistant
- Sound like a senior PM's internal notes

STYLE: Calm, neutral, professional, skim-friendly. Short bullets, no sub-bullets.`;

                let summaryPrompt: string;
                let groqSummaryPrompt: string;

                if (modeNoteSections.length > 0) {
                    // Mode-specific structured notes — sections como objeto com title keys
                    const sectionList = modeNoteSections
                        .map(s => s.description?.trim()
                            ? `- "${s.title}": ${s.description}`
                            : `- "${s.title}"`)
                        .join('\n');
                    const sectionKeys = modeNoteSections
                        .map(s => `    "${s.title}": []`)
                        .join(',\n');

                    summaryPrompt = `You are a silent meeting note-taker. Extract structured notes from the conversation transcript below.
${modeContextBlock}
${baseRules}

SECTIONS TO FILL (extract only what is present in the transcript):
${sectionList}

Return ONLY valid JSON — no markdown fences, no comments, no extra keys. Each section value is an array of concise factual bullet strings taken directly from the conversation. Use [] if a section has no relevant content.

{
  "overview": "1-2 sentence summary of what was discussed",
  "sections": {
${sectionKeys}
  }
}`;
                    console.log('[MeetingPersistence] Using mode-specific prompt with sections:', modeNoteSections.map(s => s.title));
                    groqSummaryPrompt = summaryPrompt;
                } else {
                    // Default generic notes
                    summaryPrompt = `You are a silent meeting summarizer. Convert this conversation into concise internal meeting notes.

${baseRules}

Return ONLY valid JSON (no markdown code blocks):
{
  "overview": "1-2 sentence description of what was discussed",
  "keyPoints": ["3-6 specific bullets - each = one concrete topic or point discussed"],
  "actionItems": ["specific next steps, assigned tasks, or implied follow-ups. If absolutely none found, return empty array"]
}`;
                    groqSummaryPrompt = GROQ_SUMMARY_JSON_PROMPT;
                }

                const fallbackContext = buildBalancedTranscriptContext(data.transcript, 16000);
                const generatedSummary = await this.llmHelper.generateMeetingSummary(summaryPrompt, fallbackContext, groqSummaryPrompt);

                if (generatedSummary) {
                    // Strip markdown fences se present
                    const jsonMatch = generatedSummary.match(/```(?:json)?\n?([\s\S]*?)\n?```/) || [null, generatedSummary];
                    const jsonStr = (jsonMatch[1] || generatedSummary).trim();
                    console.log('[MeetingPersistence] LLM summary response received', { length: jsonStr.length });
                    try {
                        const parsed = JSON.parse(jsonStr);
                        if (modeNoteSections.length > 0 && parsed.sections && typeof parsed.sections === 'object') {
                            // Converte sections objeto dentro de typed array preserving template ordenar
                            const sectionsArr: Array<{ title: string; bullets: string[] }> = modeNoteSections
                                .map(s => ({
                                    title: s.title,
                                    bullets: Array.isArray(parsed.sections[s.title]) ? parsed.sections[s.title] as string[] : [],
                                }));
                            console.log('[MeetingPersistence] Parsed mode sections:', sectionsArr.map(s => `${s.title}(${s.bullets.length})`));
                            summaryData = {
                                overview: parsed.overview,
                                actionItems: [],
                                keyPoints: [],
                                sections: sectionsArr,
                            };
                        } else {
                            if (modeNoteSections.length > 0) {
                                console.warn('[MeetingPersistence] Mode sections expected but LLM did not return "sections" key. Falling back to generic.');
                            }
                            summaryData = parsed;
                        }
                        generationSucceeded = Boolean(summaryData?.overview || summaryData?.keyPoints?.length || summaryData?.actionItems?.length || summaryData?.sections?.some((section: any) => Array.isArray(section.bullets) && section.bullets.length > 0));
                    } catch (e) {
                        console.error('[MeetingPersistence] Failed to parse summary JSON', { responseLength: jsonStr.length, error: e });
                    }
                }
            } else {
                console.log("Transcript too short for summary generation.");
            }

            const postCallEnhancements = buildPostCallEnhancements({
                transcript: data.transcript,
                modeTemplateType: modeSnapshot?.templateType,
                summaryData,
            });
            summaryData = summaryData.schemaVersion === 3
                ? {
                    ...summaryData,
                    coachingInsights: postCallEnhancements.coachingInsights,
                    actionItemsStructured: Array.isArray(summaryData.actionItemsStructured) && summaryData.actionItemsStructured.length > 0
                        ? summaryData.actionItemsStructured
                        : postCallEnhancements.actionItemsStructured,
                    followUpDraft: summaryData.followUpDraft || postCallEnhancements.followUpDraft,
                }
                : {
                    ...summaryData,
                    ...postCallEnhancements,
                };

            // MEETING MEMORY V2 (Fase 8 wiring, atrás meeting_memory_v2_enabled):
            // extrair first-class structured memory (entities/topics/decisions/questions/
            // action-items/skills/companies) e PERSIST it dentro de summary_json sob a
            // `meetingMemory` kchave This executa em o ALREADY-BACKGROUND processAndSaveMeeting
            // worker (fired fire-and-forget de stopMeeting), então it pode nunca block live
            // answering (non-negotiable ruregra It's a NEW chave em summary_json — não DB
            // migration, completamente backward-compatible (old meetings apenas lack it; readers
            // manipular absence). Deterministic, não LLM, não extra provedor call. Flag Fora →
            // summaryData é byte-for-byte unchanged.
            try {
                if (isIntelligenceFlagEnabled('meetingMemoryV2')) {
                    const record = new MeetingMemoryService().buildMeetingRecord({
                        meetingId,
                        segments: data.transcript,
                        mode: modeSnapshot?.templateType,
                        startedAt: data.startTime,
                        endedAt: data.startTime + data.durationMs,
                    });
                    (summaryData as any).meetingMemory = {
                        topics: record.topics,
                        questionsAsked: record.questionsAsked,
                        decisions: record.decisions,
                        actionItems: record.actionItems,
                        risks: record.risks,
                        entities: record.entities,
                        skillsDiscussed: record.skillsDiscussed,
                        companiesDiscussed: record.companiesDiscussed,
                        participants: record.participants,
                        sourceQuality: record.sourceQuality,
                        schemaVersion: 2,
                    };
                    _meetingMemoryRecorded = true;
                    // Content-free attribution: COUNTS oapenas nunca o extracted text.
                    _meetingMemoryCounts = {
                        topics: record.topics.length,
                        decisions: record.decisions.length,
                        actionItems: record.actionItems.length,
                        entities: record.entities.length,
                    };
                }
            } catch (memErr) {
                console.warn('[MeetingMemoryV2] extraction skipped (non-fatal):', (memErr as any)?.message);
            }
        } catch (e) {
            console.error("Error generating meeting metadata", e);
        }

        try {
            const minutes = Math.floor(data.durationMs / 60000);
            const seconds = ((data.durationMs % 60000) / 1000).toFixed(0);
            const durationStr = `${minutes}:${Number(seconds) < 10 ? '0' : ''}${seconds}`;

            const meetingData: Meeting = {
                id: meetingId,
                title: title,
                date: new Date().toISOString(),
                duration: durationStr,
                summary: "See detailed summary",
                detailedSummary: summaryData,
                transcript: data.transcript,
                usage: data.usage,
                calendarEventId: calendarEventId,
                source: source,
                isProcessed: true,
                summaryStatus: generationSucceeded || data.transcript.length <= 2 ? 'completed' : 'failed'
            };

            DatabaseManager.getInstance().saveMeeting(meetingData, data.startTime, data.durationMs);

            // HINDSIGHT POST-MEETING RETAIN (Fase 13 wiring, atrás
            // hindsight_post_meeting_retain_enabled). Após o meeting é persisted
            // locally, ASYNC-retain its summary dentro de long-term memory IF Hindsight é
            // configured. LongTermMemoryService.fromFlags Retorna a NoopMemoryProvider
            // a menos que hindsight_memory é Também em AND a baseUrl é configured AND o
            // opcional @vectorize-io/hindsight-client é installed — então com não servidor
            // isso é a guaranteed no-op (o app works completamente sem Hindsight). retain
            // é async/queued (nunca blocks). Escopo tags enforce per-user/org isolation.
            // Executa em o already-background processAndSaveMeeting wworker
            try {
                // Config de HindsightManager (settings Ou env) então isso works em a packaged
                // bbuild não apenas quando HINDSIGHT_BASE_URL é exported em a dev shell.
                const { HindsightManager } = require('./services/HindsightManager') as typeof import('./services/HindsightManager');
                const _hm = HindsightManager.getInstance();
                const hsCfg = _hm.getHindsightConfig();
                // Pular a known-down servidor (cached health) — don't fila a retain that
                // can't land (2026-06-14 fix).
                if (isIntelligenceFlagEnabled('hindsightPostMeetingRetain') && hsCfg && _hm.isAvailable()) {
                    const ltm = LongTermMemoryService.fromFlags({ hindsight: hsCfg });
                    if (ltm.enabled) {
                        const summaryText = summaryData?.schemaVersion === 3 && Array.isArray(summaryData?.tldr)
                            ? summaryData.tldr.join('\n')
                            : (typeof summaryData?.overview === 'string'
                                ? summaryData.overview
                                : JSON.stringify(summaryData?.keyPoints ?? []));
                        // Per-install escopo id (isolates two installs sharing one Cloud
                        // account); modo tag scopes por meeting mmodo
                        ltm.retainMeetingSummary(meetingId, summaryText, { userId: _hm.localUserId(), meetingId }, modeSnapshot?.templateType);
                        _hindsightRetainQueued = true;
                        console.log('[Hindsight] queued post-meeting summary retain', { meetingId, provider: ltm.providerName });
                    }
                }
            } catch (hsErr) {
                console.warn('[Hindsight] post-meeting retain skipped (non-fatal):', (hsErr as any)?.message);
            }

            // Metadados era já snapshotted antes session.reset() — nada para claro haqui

            // Notifica Frontend para atualiza lista
            const wins = require('electron').BrowserWindow.getAllWindows();
            wins.forEach((w: any) => w.webContents.send('meetings-updated'));

            // ATTRIBUTION: one registro proving que post-meeting memory layers ran em salva
            // (bug #4: MeetingMemoryService + Hindsight retain não anteriormente evidenced).
            try {
                const _hmEnabled = isIntelligenceFlagEnabled('hindsightMemory') && isIntelligenceFlagEnabled('hindsightPostMeetingRetain');
                let _hsConfigured = false; let _hsAvailable = false;
                try {
                    const { HindsightManager } = require('./services/HindsightManager') as typeof import('./services/HindsightManager');
                    const _hm2 = HindsightManager.getInstance();
                    _hsConfigured = Boolean(_hm2.getHindsightConfig());
                    _hsAvailable = _hsConfigured && _hm2.isAvailable();
                } catch { /* attribution apenas */ }
                recordAttribution({
                    answer_type: 'meeting_summary',
                    mode: modeSnapshot?.templateType || 'meeting',
                    surface: 'meeting',
                    meeting_memory_used: isIntelligenceFlagEnabled('meetingMemoryV2'),
                    meeting_memory_record_used: _meetingMemoryRecorded,
                    hindsight_enabled: _hmEnabled,
                    hindsight_mode: hindsightModeFor({ memoryFlagOn: isIntelligenceFlagEnabled('hindsightMemory'), configured: _hsConfigured, available: _hsAvailable }),
                    hindsight_retain_queued: _hindsightRetainQueued,
                });
                if (_meetingMemoryCounts) {
                    console.log('[MeetingMemoryV2] structured memory persisted', { meetingId, ..._meetingMemoryCounts, hindsightRetainQueued: _hindsightRetainQueued });
                }
            } catch { /* attribution nunca breaks persistence */ }

            // Fase 6 — post_call_summary_completed (não transcript / não summary text;
            // counts e durations onapenas
            try {
                const enhancements = (summaryData as any) || {};
                telemetryService.track({
                    name: 'post_call_summary_completed',
                    modeId: modeSnapshot?.id,
                    durationMs: Date.now() - _postCallStart,
                    properties: {
                        modeTemplateType: modeSnapshot?.templateType,
                        actionItemCount: Array.isArray(enhancements.actionItemsStructured) ? enhancements.actionItemsStructured.length : 0,
                        coachingInsightCount: Array.isArray(enhancements.coachingInsights) ? enhancements.coachingInsights.length : 0,
                        sectionsCount: Array.isArray(enhancements.sections) ? enhancements.sections.length : 0,
                        schemaVersion: typeof enhancements.schemaVersion === 'number' ? enhancements.schemaVersion : 2,
                        v3Used: Boolean(v3SummaryMeta?.v3Used),
                        chunkCount: v3SummaryMeta?.chunkCount ?? 0,
                        summaryStrategy: v3SummaryMeta?.strategy ?? 'fallback',
                        transcriptCoveragePercent: v3SummaryMeta?.transcriptCoveragePercent ?? 0,
                    },
                });
            } catch { /* non-fatal */ }

        } catch (error) {
            console.error('[MeetingPersistence] Failed to save meeting:', error);
            try { DatabaseManager.getInstance().updateSummaryStatus(meetingId, 'failed'); } catch { /* non-fatal */ }
            try {
                telemetryService.track({
                    name: 'post_call_summary_failed',
                    modeId: modeSnapshot?.id,
                    durationMs: Date.now() - _postCallStart,
                    properties: { errorClass: (error as Error)?.constructor?.name ?? 'Unknown' },
                });
            } catch { /* non-fatal */ }
        }
    }

    /**
     * Recover meetings que were started mas não fully processed (e.g. app crash)
     */
    public async recoverUnprocessedMeetings(): Promise<void> {
        console.log('[MeetingPersistence] Checking for unprocessed meetings...');
        const db = DatabaseManager.getInstance();
        const unprocessed = db.getUnprocessedMeetings();

        if (unprocessed.length === 0) {
            console.log('[MeetingPersistence] No unprocessed meetings found.');
            return;
        }

        console.log(`[MeetingPersistence] Found ${unprocessed.length} unprocessed meetings. recovering...`);

        for (const m of unprocessed) {
            try {
                const details = db.getMeetingDetails(m.id);
                if (!details) continue;

                console.log(`[MeetingPersistence] Recovering meeting ${m.id}...`);

                const context = details.transcript?.map(t => {
                    const label = t.speaker === 'interviewer' ? 'INTERVIEWER' :
                        t.speaker === 'user' ? 'ME' : 'ASSISTANT';
                    return `[${label}]: ${t.text}`;
                }).join('\n') || "";

                const parts = (details.duration || '0:00').split(':');
                // EC-07 fix: proteger contra malformed duração strings (e.g. corrupted DB rlinha
                const mins = parseInt(parts[0]) || 0;
                const secs = parseInt(parts[1]) || 0;
                const durationMs = ((mins * 60) + secs) * 1000;
                const startTime = new Date(details.date).getTime();

                const snapshot = {
                    transcript: details.transcript as TranscriptSegment[],
                    usage: details.usage,
                    startTime: startTime,
                    durationMs: durationMs,
                    context: context
                };

                await this.processAndSaveMeeting(snapshot, m.id);
                console.log(`[MeetingPersistence] Recovered meeting ${m.id}`);

            } catch (e) {
                console.error(`[MeetingPersistence] Failed to recover meeting ${m.id}`, e);
            }
        }
    }

    /**
     * Regenerate o V3 notes para an already-saved meeting (user-initiated, Phase 12).
     * Re-runs o completo map-reduce pipeline on o stored transcript, optionally com a
     * diferente mode e com o saved speaker renomear labels applied. Never blocks: the
     * caller invokes isso de an IPC manipulador off o UI thread; it updates summary_status
     * so o UI pode mostrar progress.
     *
     * Honors providerDataScopes.post_call_summary — se denied, returns falso (no cloud call).
     */
    public async regenerateSavedMeeting(meetingId: string, opts?: { templateType?: string; tone?: 'professional' | 'warm' | 'concise' | 'friendly' }): Promise<boolean> {
        const db = DatabaseManager.getInstance();
        const details = db.getMeetingDetails(meetingId);
        if (!details || !Array.isArray(details.transcript) || details.transcript.length < 3) return false;

        // Escopo gate.
        let postCallSummaryAllowed = true;
        try {
            const { SettingsManager } = require('./services/SettingsManager');
            const scopePolicy = SettingsManager.getInstance().get('providerDataScopes') as ProviderDataScopePolicy | undefined;
            postCallSummaryAllowed = scopePolicy?.post_call_summary !== false;
        } catch { /* default permitir */ }
        if (!postCallSummaryAllowed) {
            console.warn('[MeetingPersistence] regenerate denied — post_call_summary scope off.');
            return false;
        }

        // Resolve o alvo modo (explicit osobrescrever senão stored selected mmodo senão active).
        let templateType = opts?.templateType;
        let modeId: string | undefined;
        let modeName: string | undefined;
        let modeNoteSections: Array<{ title: string; description: string; compiledPrompt?: string }> = [];
        let modeContextBlock = '';
        try {
            const { ModesManager, TEMPLATE_NOTE_SECTIONS } = require('./services/ModesManager');
            const modesMgr = ModesManager.getInstance();
            const storedMode = (details.detailedSummary as any)?.mode;
            if (!templateType) templateType = storedMode?.selectedTemplateType || modesMgr.getActiveMode()?.templateType;
            const match = modesMgr.getModes().find((m: { id: string; name: string; templateType: string }) => m.templateType === templateType);
            if (match) { modeId = match.id; modeName = match.name; modeNoteSections = modesMgr.getNoteSections(match.id); }
            if (modeNoteSections.length === 0 && templateType) modeNoteSections = TEMPLATE_NOTE_SECTIONS[templateType as keyof typeof TEMPLATE_NOTE_SECTIONS] ?? [];
        } catch (e: any) {
            console.warn('[MeetingPersistence] regenerate mode load failed:', e?.message);
        }

        // Aplica saved speaker labels então evidence/owners uso renamed speakers.
        let transcript = details.transcript as TranscriptSegment[];
        try {
            if (isIntelligenceFlagEnabled('speakerLabelsV1')) {
                const labels = (details.detailedSummary as any)?.speakerLabels;
                if (labels && Object.keys(labels).length > 0) {
                    const { SpeakerLabelService } = require('./services/meeting/SpeakerLabelService');
                    transcript = new SpeakerLabelService().applyLabels(transcript, labels);
                }
            }
        } catch (e: any) {
            console.warn('[MeetingPersistence] regenerate speaker labels skipped:', e?.message);
        }

        db.updateSummaryStatus(meetingId, 'queued');
        try {
            const startedMs = Date.now();
            const assembler = new MeetingContextAssembler(this.llmHelper);
            const assembled = await assembler.assembleSummary({
                transcript,
                title: details.title,
                modeTemplateType: templateType,
                modeNoteSections,
                modeContextBlock,
                modeMeta: {
                    ...(modeId ? { selectedModeId: modeId } : {}),
                    ...(modeName ? { selectedModeName: modeName } : {}),
                    ...(templateType ? { selectedTemplateType: templateType } : {}),
                    summaryModeUsed: templateType || 'general',
                },
                startedAtMs: startedMs,
                startedAtIso: new Date(startedMs).toISOString(),
                generateFollowUpDraft: isIntelligenceFlagEnabled('followUpDraftV2'),
                polishSummary: isIntelligenceFlagEnabled('meetingSummaryLlmPolish'),
                followUpTone: opts?.tone,
                onStatusUpdate: status => db.updateSummaryStatus(meetingId, status),
            });

            if (!assembled.summary) {
                db.updateSummaryStatus(meetingId, 'failed');
                return false;
            }
            const v3 = assembled.summary;
            const detailedSummary = buildV3DetailedSummary(v3, details.detailedSummary);
            const ok = db.replaceDetailedSummary(meetingId, detailedSummary, { title: v3.title, summaryStatus: 'completed' });
            try {
                const wins = require('electron').BrowserWindow.getAllWindows();
                wins.forEach((w: any) => w.webContents.send('meetings-updated'));
            } catch { /* non-fatal */ }
            return ok;
        } catch (e: any) {
            console.error('[MeetingPersistence] regenerate failed:', e?.message);
            try { db.updateSummaryStatus(meetingId, 'failed'); } catch { /* non-fatal */ }
            return false;
        }
    }

    /**
     * Regenerate ONLY o follow-up draft para a saved V3 meeting (cheap; não re-summarize).
     */
    public async regenerateFollowUpDraft(meetingId: string, tone?: 'professional' | 'warm' | 'concise' | 'friendly'): Promise<boolean> {
        const db = DatabaseManager.getInstance();
        const details = db.getMeetingDetails(meetingId);
        const detailed = details?.detailedSummary as any;
        if (!detailed || detailed.schemaVersion !== 3) return false;

        let postCallSummaryAllowed = true;
        try {
            const { SettingsManager } = require('./services/SettingsManager');
            const scopePolicy = SettingsManager.getInstance().get('providerDataScopes') as ProviderDataScopePolicy | undefined;
            postCallSummaryAllowed = scopePolicy?.post_call_summary !== false;
        } catch { /* default permitir */ }
        if (!postCallSummaryAllowed) return false;

        try {
            const { FollowUpDraftGenerator } = require('./services/meeting/FollowUpDraftGenerator');
            const draft = await new FollowUpDraftGenerator(this.llmHelper).generate({
                summary: {
                    overview: detailed.overview || '',
                    decisions: detailed.decisions || [],
                    // Fall voltar para actionItemsStructured para V3 rows saved por earlier constrói
                    // que predate actionItemsV3 (mesmo fields o generator relê
                    actionItems: detailed.actionItemsV3 || detailed.actionItemsStructured || [],
                    openQuestions: detailed.openQuestions || [],
                    tldr: detailed.tldr || [],
                    whatChanged: detailed.whatChanged || [],
                },
                mode: detailed.mode?.selectedTemplateType,
                tone,
            });
            const ok = db.replaceDetailedSummary(meetingId, { ...detailed, followUpDraft: draft });
            try {
                const wins = require('electron').BrowserWindow.getAllWindows();
                wins.forEach((w: any) => w.webContents.send('meetings-updated'));
            } catch { /* non-fatal */ }
            return ok;
        } catch (e: any) {
            console.error('[MeetingPersistence] follow-up regenerate failed:', e?.message);
            return false;
        }
    }
}

// Build o persisted detailedSummary blob de a MeetingSummaryV3, preserving back-compat
// V2 ponte fields. Mirrors o inline mapping em processAndSaveMeeting então regenerate and
// initial salva produce identical shapes.
function buildV3DetailedSummary(v3: import('./services/meeting/types').MeetingSummaryV3, prev?: any): any {
    return {
        ...(prev && typeof prev === 'object' ? { speakerLabels: prev.speakerLabels } : {}),
        schemaVersion: 3,
        title: v3.title,
        tldr: v3.tldr,
        whatChanged: v3.whatChanged,
        overview: v3.overview,
        sectionsV3: v3.sections,
        sections: v3.sections.map(section => ({ title: section.title, bullets: section.bullets.map(b => b.text) })),
        decisions: v3.decisions,
        actionItemsV3: v3.actionItems,
        actionItems: v3.actionItems.map(item => item.text),
        actionItemsStructured: v3.actionItems.map(item => ({
            id: item.id || `action_${crypto.randomUUID()}`,
            text: item.text,
            ...(item.owner ? { owner: item.owner } : {}),
            ...(item.deadline ? { deadline: item.deadline } : {}),
            ...(typeof item.sourceTimestampMs === 'number' ? { sourceTimestamp: item.sourceTimestampMs } : {}),
        })),
        openQuestions: v3.openQuestions,
        risks: v3.risks,
        followUpDraft: v3.followUpDraft,
        timeline: v3.timeline,
        people: v3.people,
        topics: v3.topics,
        sourceQuality: v3.sourceQuality,
        mode: v3.mode,
        generation: v3.generation,
        recipes: v3.recipes,
        keyPoints: v3.tldr,
        actionItemsTitle: 'Action Items',
        keyPointsTitle: 'TLDR',
    };
}

function buildBalancedTranscriptContext(transcript: TranscriptSegment[], maxChars: number): string {
    const lines = (Array.isArray(transcript) ? transcript : [])
        .map(segment => `${segment.speaker || 'speaker'}: ${segment.text || ''}`)
        .filter(line => line.trim().length > 0);
    const full = lines.join('\n');
    if (full.length <= maxChars) return full;

    const budget = Math.max(3000, maxChars);
    const part = Math.floor(budget / 3);
    const start = full.slice(0, part);
    const middleStart = Math.max(0, Math.floor(full.length / 2) - Math.floor(part / 2));
    const middle = full.slice(middleStart, middleStart + part);
    const end = full.slice(Math.max(0, full.length - part));
    return [
        start,
        '\n[...middle of transcript preserved below...]\n',
        middle,
        '\n[...end of transcript preserved below...]\n',
        end,
    ].join('').slice(0, maxChars);
}
