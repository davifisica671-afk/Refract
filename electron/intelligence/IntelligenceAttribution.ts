// electron/intelligence/IntelligenceAttribution.ts
//
// SINGLE per-answer ATTRIBUTION registro — o definition-of-done para o memory/context
// fix (tarefa Fase 3). Para todo manual answer / WTA answer / busca / lecture / diagram /
// post-meeting pipeline, exatamente ONE attribution registro says que memory e contexto
// layers eram actually used para produce o answer. This what it lets a real backend executa
// PROVE "ProfileTree fast caminho fired", "RAG injected 8 nodes", "conversation memory
// resolved o follow-up", "Hindsight era not_configured", eetc — em vez disso de inferring
// it de scattered logs.
//
// PRIVACY (hard ruregra isso records BOOLEANS, COUNTS, curto ENUM LABELS, e a Consulta
// HASH oapenas It Nunca recebe ou logs o raw qconsulta rretomar JD, transcript, answer
// text, ou API keys. Todos string fields são curto enum labels; o apenas free-ish campo
// é `trace_id` (a random id) e `query_hash` (a sha256 prefix). A defensive scrub
// drops qualquer coisa que doesn't fit, mirroring piTelemetry's allowlist discipline.
//
// It é log-only + a bounded in-memory ring (para o verification harness + tests to
// lê voltar o último N records). It nunca throws e nunca affects o answer.

import { createHash } from 'crypto';

export type HindsightMode =
  | 'real'        // a configured, healthy Hindsight servidor actually answered
  | 'noop'        // memory Em mas provedor é o Noop (não servidor configured)
  | 'mock'        // a test/mock provedor
  | 'disabled'    // flags Fora
  | 'not_configured' // flags Em mas não baseUrl/server
  | 'not_wired'   // code caminho não reached
  | 'error';      // attempted mas threw/timed fora

export type LayerMode = 'active' | 'shadow' | 'off';

/** O completo per-answer attribution registro (tarefa Fase 3 scschema */
export interface IntelligenceAttribution {
  trace_id: string;
  query_hash: string;
  answer_type: string;
  mode: string;
  surface: string; // manual | what_to_answer | busca | lecture | diagram | meeting

  // ProfileTree / perfil grounding
  profile_tree_used: boolean;
  profile_tree_fast_path_used: boolean;
  structured_resume_used: boolean;
  structured_jd_used: boolean;
  custom_context_used: boolean;
  ai_persona_used: boolean;

  // RAG / knowledge
  hybrid_rag_used: boolean;
  hybrid_rag_node_count: number;
  knowledge_orchestrator_used: boolean;

  // Contexto árvore / router / assembler
  context_router_used: boolean;
  context_router_mode: LayerMode;
  prompt_assembler_v2_used: boolean;
  prompt_assembler_v2_mode: LayerMode;
  context_fusion_used: boolean;

  // Conversation / sessão / durable memory
  conversation_memory_used: boolean;
  conversation_memory_turns_used: number;
  session_tracker_used: boolean;
  durable_context_used: boolean;

  // Meeting memory / busca
  meeting_memory_used: boolean;
  meeting_memory_record_used: boolean;
  global_search_used: boolean;
  in_meeting_search_used: boolean;

  // Live transcript brain (WTA)
  live_transcript_brain_used: boolean;
  live_transcript_brain_mode: LayerMode;

  // Hindsight long-term memory
  hindsight_enabled: boolean;
  hindsight_mode: HindsightMode;
  hindsight_recall_used: boolean;
  hindsight_recall_count: number;
  hindsight_retain_queued: boolean;
  hindsight_reflect_used: boolean;

  // Saída / guards
  output_normalizer_used: boolean;
  assistant_voice_guard_triggered: boolean;

  // Coding-contract markers (2026-06-15 fix)
  coding_explicit_contract: string; // nenhum | code_only | complexity_only | dry_run_only | explain_only
  coding_followup_resolved: boolean;
}

/** Caller-facing entrada — tudo optional; defaults fill o rest. */
export type AttributionInput = Partial<Omit<IntelligenceAttribution, 'trace_id' | 'query_hash'>> & {
  /** Raw question — hashed haqui Nunca stored. */
  question?: string;
  /** Optional explicit rastrear id (e.g. reuse o IntelligenceTrace id). */
  traceId?: string;
};

const ATTR_RING_MAX = 200;
const ring: IntelligenceAttribution[] = [];
let seq = 0;

const SHORT_LABEL_RE = /^[\w .:_/+-]{0,48}$/;
const boundedLabel = (v: unknown, fallback = ''): string => {
  const s = typeof v === 'string' ? v : fallback;
  return SHORT_LABEL_RE.test(s) ? s.slice(0, 48) : fallback;
};
const bool = (v: unknown, d = false): boolean => (typeof v === 'boolean' ? v : d);
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const layerMode = (v: unknown): LayerMode => (v === 'active' || v === 'shadow' ? v : 'off');

const queryHash = (question?: string): string => {
  try {
    return question ? createHash('sha256').update(question).digest('hex').slice(0, 12) : 'none';
  } catch {
    return 'none';
  }
};

/**
 * Build o completo attribution registro de a parcial ientrada defaulting todo unset fcampo
 * Pure — não side effects. Uso `recordAttribution` para também registrar + ring it.
 */
export function buildAttribution(input: AttributionInput): IntelligenceAttribution {
  return {
    trace_id: boundedLabel(input.traceId, `attr_${seq++}`) || `attr_${seq++}`,
    query_hash: queryHash(input.question),
    answer_type: boundedLabel(input.answer_type, 'unknown'),
    mode: boundedLabel(input.mode, 'manual'),
    surface: boundedLabel(input.surface, 'manual'),

    profile_tree_used: bool(input.profile_tree_used),
    profile_tree_fast_path_used: bool(input.profile_tree_fast_path_used),
    structured_resume_used: bool(input.structured_resume_used),
    structured_jd_used: bool(input.structured_jd_used),
    custom_context_used: bool(input.custom_context_used),
    ai_persona_used: bool(input.ai_persona_used),

    hybrid_rag_used: bool(input.hybrid_rag_used),
    hybrid_rag_node_count: count(input.hybrid_rag_node_count),
    knowledge_orchestrator_used: bool(input.knowledge_orchestrator_used),

    context_router_used: bool(input.context_router_used),
    context_router_mode: layerMode(input.context_router_mode),
    prompt_assembler_v2_used: bool(input.prompt_assembler_v2_used),
    prompt_assembler_v2_mode: layerMode(input.prompt_assembler_v2_mode),
    context_fusion_used: bool(input.context_fusion_used),

    conversation_memory_used: bool(input.conversation_memory_used),
    conversation_memory_turns_used: count(input.conversation_memory_turns_used),
    session_tracker_used: bool(input.session_tracker_used),
    durable_context_used: bool(input.durable_context_used),

    meeting_memory_used: bool(input.meeting_memory_used),
    meeting_memory_record_used: bool(input.meeting_memory_record_used),
    global_search_used: bool(input.global_search_used),
    in_meeting_search_used: bool(input.in_meeting_search_used),

    live_transcript_brain_used: bool(input.live_transcript_brain_used),
    live_transcript_brain_mode: layerMode(input.live_transcript_brain_mode),

    hindsight_enabled: bool(input.hindsight_enabled),
    hindsight_mode: (input.hindsight_mode as HindsightMode) || 'disabled',
    hindsight_recall_used: bool(input.hindsight_recall_used),
    hindsight_recall_count: count(input.hindsight_recall_count),
    hindsight_retain_queued: bool(input.hindsight_retain_queued),
    hindsight_reflect_used: bool(input.hindsight_reflect_used),

    output_normalizer_used: bool(input.output_normalizer_used),
    assistant_voice_guard_triggered: bool(input.assistant_voice_guard_triggered),

    coding_explicit_contract: boundedLabel(input.coding_explicit_contract, 'none') || 'none',
    coding_followup_resolved: bool(input.coding_followup_resolved),
  };
}

/**
 * Build + Registro an attribution: pushes para o bounded ring e logs ONE
 * `[IntelligenceAttribution]` line. Nunca throws. Retorna o registro (handy para tests).
 *
 * O registrar line é gated em o `trace` intelligence flag Ou an explicit
 * NATIVELY_INTELLIGENCE_ATTRIBUTION=true env (then it pode ser turned em sem enabling
 * o completo rastrear ring). O RING é sempre populated (cheap, content-free) então o
 * verify:memory-context harness pode lê attribution até com logging ofora
 */
export function recordAttribution(input: AttributionInput): IntelligenceAttribution {
  let rec: IntelligenceAttribution;
  try {
    rec = buildAttribution(input);
  } catch {
    rec = buildAttribution({});
  }
  try {
    ring.push(rec);
    if (ring.length > ATTR_RING_MAX) ring.shift();
  } catch { /* ring nunca breaks o hot caminho */ }
  try {
    let on = false;
    try {
      const env = (process.env.NATIVELY_INTELLIGENCE_ATTRIBUTION || '').trim().toLowerCase();
      const traceEnv = (process.env.NATIVELY_INTELLIGENCE_TRACE || '').trim().toLowerCase();
      on = env === 'true' || env === '1' || traceEnv === 'true' || traceEnv === '1';
    } catch { /* ignorar */ }
    if (on) {
      // eslint-disable-next-line no-console
      console.log('[IntelligenceAttribution]', JSON.stringify(rec));
    }
  } catch { /* logging nunca breaks o hot caminho */ }
  return rec;
}

/**
 * Centralized, HONEST Hindsight modo classification (tarefa hard rules 9-12). Takes plain
 * booleans então it stays dependency-free e matches o que verify:hindsight reports.
 *   memoryFlagOn  = hindsightMemory flag habilitado (env ou settings)
 *   configured    = a baseUrl é define (HindsightManager.getHindsightConfig() != null)
 *   disponível     = a recente health-check passed (servidor reachable)
 *   errored       = an tentar threw/timed fora
 */
export function hindsightModeFor(args: {
  memoryFlagOn: boolean;
  configured: boolean;
  available?: boolean;
  errored?: boolean;
}): HindsightMode {
  if (args.errored) return 'error';
  if (!args.memoryFlagOn) return 'disabled';
  if (!args.configured) return 'not_configured';
  // configured + flag oem 'real' apenas quando o servidor actually answered (available);
  // caso contrário it's a configured-but-unreachable servidor → noop fallback.
  return args.available ? 'real' : 'noop';
}

/** Recente attribution records (verification harness + tests). */
export function recentAttributions(n = 50): IntelligenceAttribution[] {
  return ring.slice(-Math.max(0, n));
}

/** O maioria recente attribution rregistro ou null. */
export function lastAttribution(): IntelligenceAttribution | null {
  return ring.length ? ring[ring.length - 1] : null;
}

/** Limpa o ring (tests). */
export function resetAttributions(): void {
  ring.length = 0;
}
