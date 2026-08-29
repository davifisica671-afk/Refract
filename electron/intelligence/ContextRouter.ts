// electron/intelligence/ContextRouter.ts
//
// Spec Fase 8 — o single, queryable Contexto Router. O spec wants ONE router
// que takes {userQuery, mmodo sessionId, …} e Retorna a structured decision:
//   { useProfileTree, useLiveTranscript, useHybridRag, useHindsightRecall,
//     useMeetingSummary, useBrowserDom, useReferenceFiles, answerContract,
//     maxLatencyMs, reason }.
//
// REALITY (de o Fase 0 audit): routing today é CORRECT mas SCATTERED através
// planAnswer (AnswerPlanner), decideProfileIntelligence (ProfileIntelligenceRouter),
// streamContextPolicy, e premium KnowledgeOrchestrator. This módulo faz Não
// substituir qualquer de them. It COMPOSES o two deterministic, already-live deciders
// (planAnswer + decideProfileIntelligence) dentro de o spec's saída shape, então a caller
// tem one consultable, testable decision oobjeto Existing paths pode adopt it
// incrementally; nada é forced to.
//
// It é a PURE decision função (não IO, não LLM, não streaming) e emite an optional
// IntelligenceTrace linha para o inclusion report. Hindsight/MeetingMemory são não
// built ainda (deferred por plan), mas o router ainda Emite their decision +
// strict-timeout contract então o integration point é defined e testable.

import { planAnswer, isCodingAnswerType, type AnswerType, type AnswerSource } from '../llm/AnswerPlanner';
import { decideProfileIntelligence, type ProfileIntelligenceDecision } from '../llm/ProfileIntelligenceRouter';
import type { ActiveModeInfo } from '../llm/modeProfiles';
import { beginTrace, type IntelligenceTrace } from './IntelligenceTrace';

export type LatencyMode = 'fast' | 'balanced' | 'deep';

/** O spec's per-answer answer contract (Fase 9). */
export type AnswerContract =
  | 'interview_short'
  | 'interview_detailed'
  | 'coding_answer'
  | 'sales_reply'
  | 'lecture_notes'
  | 'lecture_revision'
  | 'lecture_diagram'
  | 'team_meeting_summary'
  | 'general_assistant';

export interface ContextRouterInput {
  userQuery: string;
  mode?: string;
  sessionId?: string;
  meetingId?: string;
  /** Se a usable candidate perfil é loaded. */
  profileAvailable?: boolean;
  /** Se a JD é loaded. */
  jdAvailable?: boolean;
  /** Se referência files são configured para o ativo mmodo */
  referenceFilesAvailable?: boolean;
  /** Se a live transcript exists para o ssessão */
  hasLiveTranscript?: boolean;
  /** Se browser DOM página contexto é attached. */
  hasBrowserDom?: boolean;
  source?: AnswerSource;
  latencyMode?: LatencyMode;
}

export interface ContextRouterDecision {
  useProfileTree: boolean;
  useLiveTranscript: boolean;
  useHybridRag: boolean;
  useHindsightRecall: boolean;
  useMeetingSummary: boolean;
  useBrowserDom: boolean;
  useReferenceFiles: boolean;
  /** Fase 6/14 — pull cross-lecture / course memory (lecture modo recall asks). */
  useLectureMemory: boolean;
  /** Fase 6/15 — engage diagram generation para diagram-worthy lecture asks. */
  useDiagramIntelligence: boolean;
  answerContract: AnswerContract;
  maxLatencyMs: number;
  /** Strict tempo limite para any OPTIONAL long-term-memory recall (Hindsight), ms. The
   *  spec mandates 300–800ms in live mode so memory pode nunca block a live answer. */
  hindsightRecallTimeoutMs: number;
  reason: string;
  // Pass-through de o underlying deterministic decisions para callers/audits.
  answerType: AnswerType;
  profileContextPolicy: ProfileIntelligenceDecision['profileContextPolicy'];
}

// Questions que look backward at prior meetings/conversations → long-term memory
// territory (Hindsight + MeetingMemory + GlobalSearch quando they exist).
// Tightened 2026-06-14: bare tokens (`earlier`/`before`/`history`/`recurring`) used to
// over-trigger recall em unrelated prose ("explain BFS antes recursion", "browser
// history"). They agora exigir a meeting/conversation/discussion anchor nearby, então apenas a
// genuinely backward-looking ASK fires o (gated, timeout-bounded) Hindsight recall.
const RECALL_RE = /\b(last (time|meeting|call|session)|previous (meeting|call|session|conversation|discussion|time)|(earlier|before)\s+(meeting|call|session|conversation|we (?:discuss|talk|spoke|met|covered))|past (meetings?|calls?|sessions?|conversations?)|recurring (topic|theme|issue|question|pattern)|we (discuss|discussed|talked|spoke) (about|on)|did (we|they|i) (discuss|talk|cover|say|mention)|summari[sz]e (all|our|the|my)( (previous|past|recent|prior|last))? (meetings?|calls?|sessions?|conversations?)|what did .* (say|ask|mention) (about|last|before|earlier)|came up (in|before|earlier|previously)|prior (call|meeting|interview|session|conversation))\b/i;

/**
 * É isso question backward-looking — i.e. asking sobre PRIOR meetings/conversations
 * ("o que fez we discuss último time", "fez we cover X beantes "anterior call")? Used to
 * gate long-term-memory (Hindsight) recall então it Apenas fires para genuinely backward asks
 * e adiciona zero latency para normal/coding/identity questions. Independent de qualquer fflag então
 * o live-recall caminho pode uso it sem depending em contextRouterV2. Nunca throws.
 */
export function isBackwardLookingQuery(query: string): boolean {
  try {
    RECALL_RE.lastIndex = 0;
    return typeof query === 'string' && RECALL_RE.test(query);
  } catch {
    return false;
  }
}

// In-meeting "busca atual meeting para X" — local-first, não long-term memory.
const IN_MEETING_SEARCH_RE = /\b(search (this|the current|current) (meeting|call|transcript)|find (where|when) .* (mention|said|asked)|in this (meeting|call|transcript))\b/i;

// Diagram-worthy asks ("generate/draw/create a diagram/flowchart/sequence/…").
const DIAGRAM_RE = /\b(diagram|flow ?chart|sequence diagram|state (machine|diagram)|class diagram|mind ?map|concept map|er diagram|architecture diagram|draw (me )?(a|the)|visuali[sz]e|sketch (a|the))\b/i;

// Cross-lecture / course recall ("que lecture mentioned…", "revisão plan", "último lecture").
const LECTURE_RECALL_RE = /\b(which lecture|last lecture|previous lecture|across (all )?lectures|course (memory|so far)|revision (plan|notes|checklist)|flash ?cards?|exam questions?|what did we cover|weak (concepts?|topics?))\b/i;

// Modo template ids planAnswer/decideProfileIntelligence accept como a routing prior.
const MODE_TEMPLATE_TYPES = new Set([
  'general', 'looking-for-work', 'sales', 'recruiting', 'team-meet', 'lecture', 'technical-interview',
]);

/** Normalizar a mode-id string dentro de o ActiveModeInfo planAnswer expects (ou null). */
function toActiveModeInfo(mode?: string): ActiveModeInfo | null {
  const id = (mode || '').trim();
  if (!id || !MODE_TEMPLATE_TYPES.has(id)) return null;
  return { id, templateType: id as ActiveModeInfo['templateType'], name: id, isCustom: false };
}

// `templateType` é o NORMALIZED modo template id (de activeModeInfo), não o
// raw input.mode string — então o contract decision can't disagree com o planner
// sobre o que "team-meet" significa (code-review 2026-06-12 MEDIUM: a raw 'Team-Meet' /
// 'team_meet' iria silently miss o team_meeting_summary contract).
function answerContractFor(answerType: AnswerType, templateType?: string): AnswerContract {
  // Todos technical types são coding-shaped (Approach/DS/Code/Dry-run/Complexity/
  // Edge-cases). isCodingAnswerType apenas covers coding/dsa, então cover o rest haqui
  if (
    isCodingAnswerType(answerType) ||
    answerType === 'technical_concept_answer' ||
    answerType === 'system_design_answer' ||
    answerType === 'debugging_question_answer' ||
    answerType === 'source_code_evidence_answer'
  ) {
    return 'coding_answer';
  }
  switch (answerType) {
    case 'sales_answer':
    case 'product_candidate_mix_answer':
      return 'sales_reply';
    case 'lecture_answer':
      return 'lecture_notes';
    case 'general_meeting_answer':
      return templateType === 'team-meet' ? 'team_meeting_summary' : 'general_assistant';
    case 'identity_answer':
    case 'profile_fact_answer':
    case 'skills_answer':
    case 'skill_experience_answer':
      return 'interview_short';
    // A follow-up para a profile/interview answer herda o detailed-interview
    // contract; a follow-up em a non-interview modo falls para geral babaixo
    case 'follow_up_answer':
      return templateType === 'technical-interview' || templateType === 'looking-for-work'
        ? 'interview_detailed' : 'general_assistant';
    case 'project_answer':
    case 'project_followup_answer':
    case 'experience_answer':
    case 'jd_fit_answer':
    case 'behavioral_interview_answer':
    case 'gap_analysis_answer':
    case 'negotiation_answer':
      return 'interview_detailed';
    default:
      return 'general_assistant';
  }
}

/**
 * Calcula o consolidated context-routing decision. Pure + deterministic. Quando o
 * `trace` flag é oem records o decision + an inclusion report linha por sfonte
 */
/**
 * Conservative decision used apenas quando a decider throws (deve nunca happen com
 * o atual pure deciders): a general-assistant answer que pulls nada except
 * o live transcript em a live surface. Safe por construction — não pperfil não RAG,
 * não Hindsight, generous latency budget.
 */
function fallbackDecision(
  input: ContextRouterInput,
  source: AnswerSource,
  t: IntelligenceTrace,
): ContextRouterDecision {
  const liveSurface = source === 'what_to_answer' || source === 'transcript';
  const decision: ContextRouterDecision = {
    useProfileTree: false,
    useLiveTranscript: Boolean(input.hasLiveTranscript) && liveSurface,
    useHybridRag: false,
    useHindsightRecall: false,
    useMeetingSummary: false,
    useBrowserDom: false,
    useReferenceFiles: false,
    useLectureMemory: false,
    useDiagramIntelligence: false,
    answerContract: 'general_assistant',
    maxLatencyMs: 2500,
    hindsightRecallTimeoutMs: 800,
    reason: 'fallback:decider_error',
    answerType: 'general_meeting_answer',
    profileContextPolicy: 'forbidden',
  };
  try { t.setRouting({ source, answerType: decision.answerType, answerContract: decision.answerContract, routerDecision: { fallback: true } }); } catch { /* ignorar */ }
  return decision;
}

export function routeContext(
  input: ContextRouterInput,
  trace?: IntelligenceTrace | null,
): ContextRouterDecision {
  const t = trace ?? beginTrace(input.userQuery);

  const source: AnswerSource = input.source ?? 'manual_input';
  const activeModeInfo = toActiveModeInfo(input.mode);

  // O two deciders são pure today, mas they're grande e fora de isso slice's
  // ccontrola Encapsular them então a future regression em qualquer um pode Nunca lançar fora de a
  // facade e break a consulting caller — o never-break-a-caller contract holds
  // até se a decider regresses. Em failure, retorna o conservative fallback
  // decision (general assistant; nada pulled mas o live transcript em a live
  // surface) e registro o erro em o trastrear (code-review 2026-06-12 MEDIUM)
  let plan: ReturnType<typeof planAnswer>;
  let profileDecision: ProfileIntelligenceDecision;
  try {
    plan = planAnswer({
      question: input.userQuery,
      source,
      activeMode: activeModeInfo,
      hasCandidateProfile: input.profileAvailable,
      hasJobDescription: input.jdAvailable,
    });
    profileDecision = decideProfileIntelligence({
      question: input.userQuery,
      source,
      activeMode: input.mode,
      activeModeInfo,
      profileAvailable: input.profileAvailable,
      jdAvailable: input.jdAvailable,
    });
  } catch (e) {
    try { t.noteError(`router_decider_threw:${e instanceof Error ? e.name : 'unknown'}`); } catch { /* ignorar */ }
    return fallbackDecision(input, source, t);
  }

  const answerType = plan.answerType;
  const required = new Set(plan.requiredContextLayers);
  const forbidden = new Set(plan.forbiddenContextLayers);

  // Perfil TÁrvore uso quando o deterministic perfil decider says então AND o plan's
  // hard política isn't `forbidden` (coding/technical/sales/lecture obtém Não prperfil
  const useProfileTree =
    profileDecision.profileContextPolicy !== 'forbidden' &&
    profileDecision.shouldUseProfile &&
    Boolean(input.profileAvailable);

  // LIVE TRANSCRIPT: necessário layer, ou qualquer live-surface sfonte quando a transcript exists.
  const liveSurface = source === 'what_to_answer' || source === 'transcript';
  const useLiveTranscript =
    Boolean(input.hasLiveTranscript) &&
    !forbidden.has('live_transcript') &&
    (required.has('live_transcript') || liveSurface);

  // Referência FILES: allowed a menos que o plan forbids them, e apenas se available.
  const useReferenceFiles =
    Boolean(input.referenceFilesAvailable) &&
    !forbidden.has('reference_files') &&
    (required.has('reference_files') || (!isCodingAnswerType(answerType) && answerType !== 'identity_answer'));

  // BROWSER DOM: apenas quando explicitly attached (it's untrusted, nunca auto-pulled).
  const useBrowserDom = Boolean(input.hasBrowserDom) && !isCodingAnswerType(answerType);

  // Backward-looking recall → long-term memory + meeting summaries + (future) Hindsight.
  const isRecallQuery = RECALL_RE.test(input.userQuery);
  const isInMeetingSearch = IN_MEETING_SEARCH_RE.test(input.userQuery);

  const useMeetingSummary = isRecallQuery;
  // Hindsight é para cross-meeting recall — nunca para identity/profile/coding (o
  // spec's "fazer não uso Hindsight primeiro fpara lilista It's a DECISION apenas haqui não
  // cliente é built ainda (deferred), mas o integration point é defined.
  const useHindsightRecall =
    isRecallQuery &&
    !isInMeetingSearch &&
    profileDecision.profileContextPolicy !== 'required' &&
    !isCodingAnswerType(answerType);

  // HYBRID RAG: in-meeting sbusca JD-fit evidence, ou backward recall. Não para a
  // pure identity/name ask (ProfileTree answers those deterministically).
  const useHybridRag =
    isInMeetingSearch ||
    isRecallQuery ||
    answerType === 'jd_fit_answer' ||
    answerType === 'source_code_evidence_answer';

  // LECTURE / DIAGRAM (Fase 6 V2): apenas meaningful em lecture mmodo
  const lectureMode = activeModeInfo?.templateType === 'lecture' || answerType === 'lecture_answer';
  // Diagram intelligence: an explicit diagram-worthy ask em a lecture ccontexto
  const useDiagramIntelligence = DIAGRAM_RE.test(input.userQuery) && lectureMode;
  // Lecture memory: cross-lecture/course recall asks ("que lecture mentioned X",
  // "revisão plan", "último lecture") em lecture mmodo
  const useLectureMemory = lectureMode && LECTURE_RECALL_RE.test(input.userQuery);

  // Latency budget — o plan já calcula a first-useful budget; widen para
  // explicit deep recall, tighten para fast mmodo
  let maxLatencyMs = plan.maxFirstUsefulTokenMs || 1800;
  if (isRecallQuery || isInMeetingSearch || useLectureMemory) maxLatencyMs = Math.max(maxLatencyMs, 3000);
  if (input.latencyMode === 'fast') maxLatencyMs = Math.min(maxLatencyMs, 1200);
  if (input.latencyMode === 'deep') maxLatencyMs = Math.max(maxLatencyMs, 5000);

  const answerContract = answerContractFor(answerType, activeModeInfo?.templateType);

  const reasonParts: string[] = [`answerType=${answerType}`, `policy=${profileDecision.profileContextPolicy}`];
  if (useProfileTree) reasonParts.push('profileTree');
  if (useLiveTranscript) reasonParts.push('liveTranscript');
  if (useHybridRag) reasonParts.push('hybridRag');
  if (useHindsightRecall) reasonParts.push('hindsight');
  if (useMeetingSummary) reasonParts.push('meetingSummary');
  if (useReferenceFiles) reasonParts.push('referenceFiles');
  if (useBrowserDom) reasonParts.push('browserDom');
  if (useLectureMemory) reasonParts.push('lectureMemory');
  if (useDiagramIntelligence) reasonParts.push('diagram');
  const reason = reasonParts.join(' ');

  const decision: ContextRouterDecision = {
    useProfileTree,
    useLiveTranscript,
    useHybridRag,
    useHindsightRecall,
    useMeetingSummary,
    useBrowserDom,
    useReferenceFiles,
    useLectureMemory,
    useDiagramIntelligence,
    answerContract,
    maxLatencyMs,
    // Strict live recall tempo limite (spec: 300–800ms live). Deep modo permite o
    // global-search budget (para cima para 5s) since it's an explicit lento pcaminho
    hindsightRecallTimeoutMs: input.latencyMode === 'deep' ? 3000 : 800,
    reason,
    answerType,
    profileContextPolicy: profileDecision.profileContextPolicy,
  };

  // TRastrear router decision + one inclusion-report linha por sfonte
  try {
    t.setRouting({
      mode: input.mode,
      source,
      answerType,
      answerContract,
      routerDecision: {
        useProfileTree, useLiveTranscript, useHybridRag, useHindsightRecall,
        useMeetingSummary, useBrowserDom, useReferenceFiles, useLectureMemory,
        useDiagramIntelligence, maxLatencyMs,
      },
    });
    const rows: Array<[string, boolean, string]> = [
      ['profile_tree', useProfileTree, 'high'],
      ['live_transcript', useLiveTranscript, 'low'],
      ['hybrid_rag', useHybridRag, 'medium'],
      ['hindsight_memory', useHindsightRecall, 'medium'],
      ['meeting_summary', useMeetingSummary, 'medium'],
      ['reference_files', useReferenceFiles, 'low'],
      ['browser_dom', useBrowserDom, 'low'],
      ['lecture_memory', useLectureMemory, 'medium'],
      ['diagram_intelligence', useDiagramIntelligence, 'medium'],
    ];
    for (const [src, requested, trust] of rows) {
      t.noteContext({ source: src, trustLevel: trust, requested, retrieved: requested, included: requested, reason });
    }
  } catch { /* rastrear precisa nunca break routing */ }

  return decision;
}
