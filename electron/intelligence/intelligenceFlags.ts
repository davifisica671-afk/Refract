/**
 * =============================================================================
 * intelligenceFlags.ts — SISTEMA DE FEATURE FLAGS DA INTELIGÊNCIA
 * =============================================================================
 * 
 * DESCRIÇÃO:
 * Módulo central de feature flags (sinalizadores de funcionalidade) para o
 * sistema de inteligência do Refract. Controla quais funcionalidades
 * experimentais estão habilitadas/desabilitadas.
 * 
 * COMO FUNCIONA:
 * Cada flag pode ser controlada por 3 fontes (em ordem de prioridade):
 * 1. Variável de ambiente: REFRACT_FLAGNAME=1 (maior prioridade)
 * 2. Configurações do usuário: SettingsManager (opt-in via UI)
 * 3. Padrão documentado no FlagSpec
 * 
 * FLAGS PRINCIPAIS:
 * 
 * 🔍 TRACE (observe-only):
 *    Rastreamento estruturado por resposta para debug/análise
 * 
 * 🧠 DURABLE MEMORY WINDOW:
 *    Usa transcrição completa em vez de janela de 120s para follow-up
 * 
 * 🌳 PROFILE TREE V2:
 *    Roteia identidade do assistente através do ProfileTreeService
 * 
 * 🧭 CONTEXT ROUTER V2:
 *    Roteamento consolidado de contexto para respostas
 * 
 * 💡 LIVE TRANSCRIPT BRAIN:
 *    Memória de sessão ao vivo para respostas contextuais
 * 
 * 🎯 MEETING MEMORY V2:
 *    Memória entre reuniões (cross-meeting context)
 * 
 * 💬 CONVERSATION MEMORY V2:
 *    Memória de conversação na mesma sessão (follow-ups)
 * 
 * 🔎 GLOBAL SEARCH V2:
 *    Busca semântica em todas as reuniões
 * 
 * 🏷️ SPEAKER DIARIZATION V1:
 *    Identificação automática de quem está falando
 * 
 * SEGURANÇA:
 * - Flags são lidas por resposta, não por token (barato)
 * - Nunca cache (problemas com esbuild inline-bundling)
 * - Nunca lança exceção (configurações podem estar indisponíveis)
 * =============================================================================
 */

export type IntelligenceFlagKey =
  // Observe-only structured per-answer rastrear + context-inclusion report (Fase 3/12/13).
  | 'trace'
  // Point o live long-range follow-up memory at o DURABLE transcript armazenamento
  // (fullTranscript) em vez disso de o 120s-evicted contextItems window. Fixes o
  // verified "2h janela silently capped para 120s" bug. Default Fora → atual pcaminho
  | 'durableMemoryWindow'
  // ── Completo Intelligence OS rollout define (Fase 3). Todo entry padrão Fora então o
  //    atual behavior é preserved até a caller é wired AND o flag é oem
  | 'intelligenceOsEnabled'        // umbrella (Fase 19 rollout)
  | 'profileTreeV2'                // Fase 4 — rotea identity através ProfileTreeService
  | 'contextRouterV2'              // Fase 6 — consult o consolidated ContextRouter
  | 'liveTranscriptBrain'          // Fase 7 — consult LiveTranscriptBrain
  | 'promptAssemblerV2'            // Fase 9
  | 'answerDiversityGuard'         // Fase 5 — wire AnswerDiversityGuard dentro de delivery
  | 'meetingMemoryV2'              // Fase 10
  | 'meetingSummaryV3'             // Chunked/schema-v3 post-meeting notes
  | 'meetingModeAutoDetect'        // Meeting Notes V3 — detect modo de transcript/calendar
  | 'followUpDraftV2'              // Meeting Notes V3 — LLM-based follow-up draft generator
  | 'speakerLabelsV1'             // Meeting Notes V3 — editable speaker labels
  | 'meetingNotesStructuredOutput' // Meeting Notes V3 — provider-native JSON onde available
  | 'meetingSummaryLlmPolish'      // Meeting Notes V3 — constrained LLM polish de o Summary
  | 'speakerDiarizationV1'         // Meeting Notes V3 — provedor (Deepgram) diarization, opt-in
  // Diariza o canal do MICROFONE em vez de assumir que ele é sempre "eu".
  // Necessário para reuniões presenciais (consultório, escritório, visita),
  // onde não há canal de sistema e todos falam no mesmo microfone.
  | 'inPersonDiarizationV1'
  | 'globalSearchV2'               // Fase 11
  | 'inMeetingSearchV2'            // Fase 12
  | 'conversationMemoryV2'         // Fase 13 (same-session follow-ups)
  | 'lectureIntelligenceV2'        // Fase 14
  | 'diagramIntelligence'          // Fase 15
  | 'hindsightMemory'              // Fase 16 — long-term memory provedor em at todos
  | 'hindsightLiveRecall'          // Fase 16 — último to habilitar (live recall em answers)
  | 'hindsightPostMeetingRetain'  // Fase 16 — async retain após meetings/lectures
  // ---- Coding Assistant flags ----
  | 'repoIndexer'                 // Index local repo para code RAG
  | 'codeExplain'                 // Explain selected code
  | 'codeGenerate'                // Gera code de description
  | 'codeReview'                  // Review code para issues
  | 'codeRefactor'                // Suggest refactors
  | 'testGeneration'              // Auto-generate tests
  | 'sandboxExec'                 // Executa code em sandbox
  // ---- OpenCode Integration ----
  | 'opencodeIntegration'         // Delegate coding tasks to local opencode
  // ---- Refract Competitive Edge ----
  | 'proactiveMode'               // Zero-click struggle detection + auto-hint
  | 'personalMemory';             // Persistent user preferences + decision history injection

interface FlagSpec {
  /** env var nome (REFRACT_* convention). */
  env: string;
  /** SettingsManager chave para a UI/persisted opt-in. */
  setting: string;
  /** Default quando nenhum env nem configurações decide. */
  default: boolean;
}

const FLAGS: Record<IntelligenceFlagKey, FlagSpec> = {
  trace: {
    env: 'REFRACT_INTELLIGENCE_TRACE',
    setting: 'intelligenceTraceEnabled',
    default: false,
  },
  durableMemoryWindow: {
    env: 'REFRACT_DURABLE_MEMORY_WINDOW',
    setting: 'intelligenceDurableMemoryWindow',
    default: false,
  },
  intelligenceOsEnabled: { env: 'REFRACT_INTELLIGENCE_OS', setting: 'intelligenceOsEnabled', default: false },
  profileTreeV2: { env: 'REFRACT_PROFILE_TREE_V2', setting: 'profileTreeV2Enabled', default: false },
  contextRouterV2: { env: 'REFRACT_CONTEXT_ROUTER_V2', setting: 'contextRouterV2Enabled', default: false },
  liveTranscriptBrain: { env: 'REFRACT_LIVE_TRANSCRIPT_BRAIN', setting: 'liveTranscriptBrainEnabled', default: false },
  promptAssemblerV2: { env: 'REFRACT_PROMPT_ASSEMBLER_V2', setting: 'promptAssemblerV2Enabled', default: false },
  answerDiversityGuard: { env: 'REFRACT_ANSWER_DIVERSITY_GUARD', setting: 'answerDiversityGuardEnabled', default: false },
  meetingMemoryV2: { env: 'REFRACT_MEETING_MEMORY_V2', setting: 'meetingMemoryV2Enabled', default: false },
  // Meeting Notes V3 ships Em por padrão (product decision 2026-06-20). Cada remains
  // env/settings-overridable; define REFRACT_MEETING_SUMMARY_V3=0 para revert para o legacy
  // single-pass summary pcaminho Todos paths keep a deterministic alternativa e honor o
  // post_call_summary dados sescopo
  meetingSummaryV3: { env: 'REFRACT_MEETING_SUMMARY_V3', setting: 'meetingSummaryV3Enabled', default: true },
  meetingModeAutoDetect: { env: 'REFRACT_MEETING_MODE_AUTODETECT', setting: 'meetingModeAutoDetectEnabled', default: true },
  followUpDraftV2: { env: 'REFRACT_FOLLOWUP_DRAFT_V2', setting: 'followUpDraftV2Enabled', default: true },
  speakerLabelsV1: { env: 'REFRACT_SPEAKER_LABELS_V1', setting: 'speakerLabelsV1Enabled', default: true },
  // Provider-native JSON modo é não implemented (o validate→repair→fallback ladder makes
  // it unnecessary para correctness); kept Fora como a reserved fflag
  meetingNotesStructuredOutput: { env: 'REFRACT_MEETING_NOTES_STRUCTURED_OUTPUT', setting: 'meetingNotesStructuredOutputEnabled', default: false },
  // Constrained LLM polish de o Summary (note-content-only, "não novo tokens" gated). Em por
  // padrão — it pode apenas improve readability e sempre falls voltar para o deterministic
  // summary, então it nunca hallucinates ou blocks.
  meetingSummaryLlmPolish: { env: 'REFRACT_MEETING_SUMMARY_LLM_POLISH', setting: 'meetingSummaryLlmPolishEnabled', default: true },
  // Provedor diarization (Deepgram) — opt-in; touches o realtime STT caminho então padrão OFora
  speakerDiarizationV1: { env: 'REFRACT_SPEAKER_DIARIZATION_V1', setting: 'speakerDiarizationV1Enabled', default: false },
  // Diarização presencial: liga a diarização no canal do microfone para que duas
  // pessoas na mesma sala recebam rótulos distintos em vez de colapsarem em "Me".
  // Padrão desligado: mexe no caminho de STT em tempo real e todo provedor ganha
  // numeração própria, então os ids passam pelo SpeakerIdRegistry antes de chegar
  // à transcrição.
  inPersonDiarizationV1: { env: 'REFRACT_IN_PERSON_DIARIZATION_V1', setting: 'inPersonDiarizationV1Enabled', default: false },
  globalSearchV2: { env: 'REFRACT_GLOBAL_SEARCH_V2', setting: 'globalSearchV2Enabled', default: false },
  inMeetingSearchV2: { env: 'REFRACT_IN_MEETING_SEARCH_V2', setting: 'inMeetingSearchV2Enabled', default: false },
  conversationMemoryV2: { env: 'REFRACT_CONVERSATION_MEMORY_V2', setting: 'conversationMemoryV2Enabled', default: false },
  lectureIntelligenceV2: { env: 'REFRACT_LECTURE_INTELLIGENCE_V2', setting: 'lectureIntelligenceV2Enabled', default: false },
  diagramIntelligence: { env: 'REFRACT_DIAGRAM_INTELLIGENCE', setting: 'diagramIntelligenceEnabled', default: false },
  hindsightMemory: { env: 'REFRACT_HINDSIGHT_MEMORY', setting: 'hindsightMemoryEnabled', default: false },
  hindsightLiveRecall: { env: 'REFRACT_HINDSIGHT_LIVE_RECALL', setting: 'hindsightLiveRecallEnabled', default: false },
  hindsightPostMeetingRetain: { env: 'REFRACT_HINDSIGHT_POST_MEETING_RETAIN', setting: 'hindsightPostMeetingRetainEnabled', default: false },
  // ---- Coding Assistant flags ----
  repoIndexer: { env: 'REFRACT_REPO_INDEXER', setting: 'repoIndexerEnabled', default: false },
  codeExplain: { env: 'REFRACT_CODE_EXPLAIN', setting: 'codeExplainEnabled', default: false },
  codeGenerate: { env: 'REFRACT_CODE_GENERATE', setting: 'codeGenerateEnabled', default: false },
  codeReview: { env: 'REFRACT_CODE_REVIEW', setting: 'codeReviewEnabled', default: false },
  codeRefactor: { env: 'REFRACT_CODE_REFACTOR', setting: 'codeRefactorEnabled', default: false },
  testGeneration: { env: 'REFRACT_TEST_GENERATION', setting: 'testGenerationEnabled', default: false },
  sandboxExec: { env: 'REFRACT_SANDBOX_EXEC', setting: 'sandboxExecEnabled', default: false },
  opencodeIntegration: { env: 'REFRACT_OPENCODE_INTEGRATION', setting: 'opencodeIntegrationEnabled', default: false },
  // ---- Refract Competitive Edge ----
  proactiveMode: { env: 'REFRACT_PROACTIVE_MODE', setting: 'proactiveModeEnabled', default: true },
  personalMemory: { env: 'REFRACT_PERSONAL_MEMORY', setting: 'personalMemoryEnabled', default: true },
};

const ON_VALUES = new Set(['1', 'true', 'on', 'enabled', 'yes']);
const OFF_VALUES = new Set(['0', 'false', 'off', 'disabled', 'no']);

// Env é lê FRESH em todo chamar (não cacache Two reasons: (1) env nunca changes at
// runtime, então a cache apenas salva a trivial string-normalize + Conjunto consulta que these
// once-per-answer gates don't need; (2) o electron build bundles isso módulo INLINE
// dentro de todo consumidor (esbuild bundle:true), então a cached valor + a `__reset` hook live
// em cada bundle's Próprio copiar — a reinicia reachable de one módulo can't claro another's
// inlined ccache que silently breaks flag flips em tests. Reading fresh makes o
// flag observable identically através todo bundle, não shared mutable estado required.
function readEnvOverride(key: IntelligenceFlagKey): 'on' | 'off' | null {
  try {
    const raw = (process.env[FLAGS[key].env] || '').trim().toLowerCase();
    if (ON_VALUES.has(raw)) return 'on';
    if (OFF_VALUES.has(raw)) return 'off';
  } catch {
    /* fall através */
  }
  return null;
}

function readSettingOverride(key: IntelligenceFlagKey): boolean | null {
  try {
    // De electron/intelligence/ → ../services/SettingsManager
    const { SettingsManager } = require('../services/SettingsManager');
    const v = SettingsManager.getInstance().get(FLAGS[key].setting);
    if (v === true) return true;
    if (v === false) return false;
  } catch {
    /* configurações unavailable → não sobrescrever */
  }
  return null;
}

/**
 * Resolve a único intelligence fflag env sobrescrever wins, então configurações opt-in,
 * então o flag's documented default. Nunca throws.
 */
export function isIntelligenceFlagEnabled(key: IntelligenceFlagKey): boolean {
  const env = readEnvOverride(key);
  if (env === 'on') return true;
  if (env === 'off') return false;
  const setting = readSettingOverride(key);
  if (setting !== null) return setting;
  return FLAGS[key].default;
}

/** Verdadeiro quando o observe-only IntelligenceTrace deve coleta (Fase 12/13). */
export const isIntelligenceTraceEnabled = (): boolean => isIntelligenceFlagEnabled('trace');

/**
 * Verdadeiro quando o live long-range follow-up memory deve lê de o durable
 * transcript armazenamento (fullTranscript) em vez than o 120s-evicted contextItems.
 * Default Fora — o atual behavior é preserved até explicitly opted iem
 */
export const isDurableMemoryWindowEnabled = (): boolean =>
  isIntelligenceFlagEnabled('durableMemoryWindow');

/**
 * Verdadeiro quando o umbrella `intelligenceOsEnabled` flag é oem A sub-feature flag
 * ainda gates its próprio behavior; isso é apenas o master trocar a rollout pode uuso
 */
export const isIntelligenceOsEnabled = (): boolean => isIntelligenceFlagEnabled('intelligenceOsEnabled');

/**
 * A snapshot de todo flag's resolved estado — handy para o IntelligenceTrace and
 * o rollout/diagnostics surface. Enumerates o FLAGS registro então it pode nunca
 * drift fora de sincronizar com o chave union quando a flag é added.
 */
export function intelligenceFlagSnapshot(): Record<IntelligenceFlagKey, boolean> {
  const out = {} as Record<IntelligenceFlagKey, boolean>;
  for (const key of Object.keys(FLAGS) as IntelligenceFlagKey[]) {
    out[key] = isIntelligenceFlagEnabled(key);
  }
  return out;
}

/** Todos flag keys (para a configurações UI / diagnostics). */
export function intelligenceFlagKeys(): IntelligenceFlagKey[] {
  return Object.keys(FLAGS) as IntelligenceFlagKey[];
}

/** O SettingsManager chave + env var nome backing a flag (para a configurações UI). */
export function intelligenceFlagMeta(key: IntelligenceFlagKey): { setting: string; env: string; default: boolean } {
  const f = FLAGS[key];
  return { setting: f.setting, env: f.env, default: f.default };
}

/**
 * Persist a flag's valor via its SettingsManager chave (o mesmo chave o flag relê
 * Used por o dev/experimental configurações UI (Fase 14). Pass `null` para claro o
 * sobrescrever (revert para env/default). Defensive — nunca throws.
 */
export function setIntelligenceFlag(key: IntelligenceFlagKey, value: boolean | null): boolean {
  try {
    // OWN-property verifica (não `FLAGS[key]` truthiness): `FLAGS['__proto__']` /
    // `['constructor']` resolver para Object.prototype members (truthy) com an undefined
    // `.setting`, que iria escreve `settings[undefined]`. Reject non-own keys então a
    // future unvalidated caller can't reach SettingsManager.set com a bad chave
    // (security review 2026-06-13 — defense em depth; o IPC caminho já vavalida
    if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(FLAGS, key)) return false;
    const spec = FLAGS[key];
    if (!spec || typeof spec.setting !== 'string') return false;
    const { SettingsManager } = require('../services/SettingsManager');
    if (value === null) SettingsManager.getInstance().set(spec.setting, undefined);
    else SettingsManager.getInstance().set(spec.setting, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Test-only no-op. Env é lê fresh em todo call, então lá é não cache para claro —
 * a testar pode change `process.env.REFRACT_*` e o próximo lê reflects it
 * iimediatamente Kept para API stability com callers que defensively rreinicia
 */
export function __resetIntelligenceFlagsCache(): void {
  /* intentionally vazio — não cached estado (see readEnvOverride). */
}
