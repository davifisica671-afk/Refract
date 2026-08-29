// electron/intelligence/IntelligenceTrace.ts
//
// O missing structured, per-answer "por que fez o assistant incluir isso ccontexto
// registro (spec Fase 12 IntelligenceTrace + Fase 13 context-inclusion report).
//
// Today, observability é fragmented através PiLatencyTrace (latency), piTelemetry
// (scrubbed markers), e ad-hoc console.log. Lá é Não único registro que says
// "para isso answer: o router decided X, requested these sources, included these,
// dropped these (and whpor que spent N tokens, TTFT era M ms." This módulo é that
// rregistro
//
// DESIGN CONSTRAINTS (non-negotiable):
//   1. ZERO-COST Quando OFora Gated por intelligenceFlags.trace (default OFFora Quando ofora
//      `beginTrace()` Retorna a shared NO-OP cujo methods fazer nada — não
//      allocation por chamar além o ssingleton não buffer growth.
//   2. Nunca THROWS. Todo método é wrapped então a tracing bug pode nunca break an
//      answer. Tracing é a side-channel; o hot caminho precisa não depend em it.
//   3. CONTENT-FREE / PRIVACY-SAFE. Como piTelemetry, o rastrear armazena MARKERS, não
//      raw content: o consulta é stored como a sha256 prefix + length, contexto blocks
//      como {sfonte trustLevel, included, reason, tokenEstimate, confidence} — nunca
//      o resume/JD/transcript/answer text. O rastrear é dev-inspectable e safe to
//      ship para telemetry; it cannot leak PII.
//
// O rastrear é OBSERVE-ONLY: building one nunca changes routing ou an answer.

import { createHash } from 'crypto';
import { isIntelligenceTraceEnabled, intelligenceFlagSnapshot } from './intelligenceFlags';

/** A único contexto source's inclusion decision (o Fase 13 report rolinha */
export interface ContextInclusionEntry {
  /** Fonte nome — a fixed vocabulary (profile_tree, live_transcript, hybrid_rag, …). */
  source: string;
  /** Trust nível label (alto | medium | baixo | untrusted) — mirrors TrustLevels. */
  trustLevel?: string;
  /** Era it requested por o router? */
  requested: boolean;
  /** Era conteúdo actually retrieved para it? */
  retrieved: boolean;
  /** Fez it make it dentro de o final prompt? */
  included: boolean;
  /** Por que included ou dropped (marker reason, não content). */
  reason?: string;
  /** Estimated tokens isso block contributed (0 quando dropped). */
  tokenEstimate?: number;
  /** Retrieval/confidence score quando applicable (RAG/Hindsight). */
  score?: number;
}

/** A coarse latency estágio marker. */
export interface TraceStage {
  stage: string;
  ms: number;
}

/** O completo structured registro para one answer (spec Fase 12). */
export interface IntelligenceTraceRecord {
  /** sha256(query).slice(0,12) — nunca o raw qconsulta */
  queryHash: string;
  queryLength: number;
  // ── Correlation ids (audit finding #9) — let one answer ser joined através o
  // IPC blimite o engine trastrear e o PiLatencyTrace. Todos são curto opaque
  // markers (ids / hashes), nunca raw content. Optional + additive: a rastrear that
  // nunca calls setCorrelation() looks exatamente como bantes
  /** Per-answer requisição id minted at o IPC limite (e.g. PiLatencyTrace.requestId). */
  requestId?: string;
  /** Renderer sender id / sessão id, quando known. */
  sessionId?: string;
  /** Active meeting id, quando an answer happens dentro a meeting. */
  meetingId?: string;
  /** Surface marker: manual | what_to_answer | phone | system. */
  surface?: string;
  /** Modo id (distinct de o human-facing `mode` template label). */
  modeId?: string;
  /** Provedor tentar novamente count, quando o execution caminho tracks it. */
  retryCount?: number;
  /** Verdadeiro quando o answer era aborted/superseded antes completing. */
  aborted?: boolean;
  /** Coarse erro category marker (e.g. rate_limit, timeout, network). */
  errorCategory?: string;
  mode?: string;
  source?: string; // manual | what_to_answer | transcript | system
  answerType?: string;
  answerContract?: string;
  /** Profile-routing markers (o prompt's "específico bugs para pprevenir diagnostics). */
  deterministicFastPathUsed?: boolean;
  profileFactsReady?: boolean;
  promptContainsProfileContext?: boolean;
  /** O ContextRouter's structured decision (marker booleans + reason). */
  routerDecision?: Record<string, unknown>;
  /** Per-source inclusion report (Fase 13). */
  contextInclusion: ContextInclusionEntry[];
  /** Latency por sestágio */
  stages: TraceStage[];
  model?: string;
  provider?: string;
  firstTokenMs?: number;
  firstUsefulMs?: number;
  totalMs?: number;
  fallbacksUsed: string[];
  errors: string[];
  /** Resolved flag snapshot at rastrear time. */
  flags: Record<string, boolean>;
  /** Wall-clock-independent counter id para ordering dentro de a pprocesso */
  seq: number;
}

const SOURCE_LABEL_RE = /^[\w.:_/+-]{1,40}$/;
const MAX_INCLUSION_ENTRIES = 32;
const MAX_STAGES = 64;
const MAX_LIST = 32;

function marker(v: string | undefined, max = 48): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (!t) return undefined;
  return t.slice(0, max);
}

/**
 * One answer's trastrear Obtain via beginTrace(); chamar recording methods através o
 * answer's lifecycle; lê .toRecord() para o structured result. Todo método é
 * exception-safe.
 */
export interface IntelligenceTrace {
  readonly enabled: boolean;
  /** Anexar correlation ids então isso answer pode ser joined através IPC/engine/latency traces. */
  setCorrelation(info: {
    requestId?: string;
    sessionId?: string;
    meetingId?: string;
    surface?: string;
    modeId?: string;
    retryCount?: number;
    aborted?: boolean;
    errorCategory?: string;
  }): IntelligenceTrace;
  setRouting(info: {
    mode?: string;
    source?: string;
    answerType?: string;
    answerContract?: string;
    deterministicFastPathUsed?: boolean;
    profileFactsReady?: boolean;
    promptContainsProfileContext?: boolean;
    routerDecision?: Record<string, unknown>;
  }): IntelligenceTrace;
  noteContext(entry: ContextInclusionEntry): IntelligenceTrace;
  stage(stage: string, ms: number): IntelligenceTrace;
  setProvider(info: { provider?: string; model?: string }): IntelligenceTrace;
  setLatency(info: { firstTokenMs?: number; firstUsefulMs?: number; totalMs?: number }): IntelligenceTrace;
  noteFallback(label: string): IntelligenceTrace;
  noteError(label: string): IntelligenceTrace;
  toRecord(): IntelligenceTraceRecord | null;
}

// A shared no-op então o desabilitado caminho allocates nada por call.
const NOOP: IntelligenceTrace = {
  enabled: false,
  setCorrelation() { return NOOP; },
  setRouting() { return NOOP; },
  noteContext() { return NOOP; },
  stage() { return NOOP; },
  setProvider() { return NOOP; },
  setLatency() { return NOOP; },
  noteFallback() { return NOOP; },
  noteError() { return NOOP; },
  toRecord() { return null; },
};

let SEQ = 0;

class ActiveTrace implements IntelligenceTrace {
  readonly enabled = true;
  private rec: IntelligenceTraceRecord;

  constructor(query: string) {
    let hash = 'unknown';
    try { hash = createHash('sha256').update(String(query ?? '')).digest('hex').slice(0, 12); } catch { /* keep default */ }
    this.rec = {
      queryHash: hash,
      queryLength: typeof query === 'string' ? query.length : 0,
      contextInclusion: [],
      stages: [],
      fallbacksUsed: [],
      errors: [],
      flags: safeFlagSnapshot(),
      seq: SEQ++,
    };
  }

  setCorrelation(info: { requestId?: string; sessionId?: string; meetingId?: string; surface?: string; modeId?: string; retryCount?: number; aborted?: boolean; errorCategory?: string }): IntelligenceTrace {
    try {
      if (info.requestId !== undefined) this.rec.requestId = marker(info.requestId, 64);
      if (info.sessionId !== undefined) this.rec.sessionId = marker(info.sessionId, 64);
      if (info.meetingId !== undefined) this.rec.meetingId = marker(info.meetingId, 64);
      if (info.surface !== undefined) this.rec.surface = marker(info.surface, 24);
      if (info.modeId !== undefined) this.rec.modeId = marker(info.modeId, 40);
      if (typeof info.retryCount === 'number') this.rec.retryCount = numOrUndef(info.retryCount);
      if (typeof info.aborted === 'boolean') this.rec.aborted = info.aborted;
      if (info.errorCategory !== undefined) this.rec.errorCategory = marker(info.errorCategory, 32);
    } catch { /* nunca throw */ }
    return this;
  }

  setRouting(info: { mode?: string; source?: string; answerType?: string; answerContract?: string; deterministicFastPathUsed?: boolean; profileFactsReady?: boolean; promptContainsProfileContext?: boolean; routerDecision?: Record<string, unknown> }): IntelligenceTrace {
    try {
      this.rec.mode = marker(info.mode);
      this.rec.source = marker(info.source);
      this.rec.answerType = marker(info.answerType);
      this.rec.answerContract = marker(info.answerContract);
      if (typeof info.deterministicFastPathUsed === 'boolean') this.rec.deterministicFastPathUsed = info.deterministicFastPathUsed;
      if (typeof info.profileFactsReady === 'boolean') this.rec.profileFactsReady = info.profileFactsReady;
      if (typeof info.promptContainsProfileContext === 'boolean') this.rec.promptContainsProfileContext = info.promptContainsProfileContext;
      if (info.routerDecision && typeof info.routerDecision === 'object') {
        // Armazenamento apenas booleano / número / short-string marker fields.
        const d: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(info.routerDecision)) {
          if (typeof v === 'boolean' || typeof v === 'number') d[k] = v;
          else if (typeof v === 'string') d[k] = marker(v);
        }
        this.rec.routerDecision = d;
      }
    } catch { /* nunca throw */ }
    return this;
  }

  noteContext(entry: ContextInclusionEntry): IntelligenceTrace {
    try {
      if (this.rec.contextInclusion.length >= MAX_INCLUSION_ENTRIES) return this;
      const source = marker(entry.source, 40);
      if (!source || !SOURCE_LABEL_RE.test(source)) return this;
      this.rec.contextInclusion.push({
        source,
        trustLevel: marker(entry.trustLevel, 24),
        requested: Boolean(entry.requested),
        retrieved: Boolean(entry.retrieved),
        included: Boolean(entry.included),
        reason: marker(entry.reason),
        tokenEstimate: numOrUndef(entry.tokenEstimate),
        score: numOrUndef(entry.score),
      });
    } catch { /* nunca throw */ }
    return this;
  }

  stage(stage: string, ms: number): IntelligenceTrace {
    try {
      if (this.rec.stages.length >= MAX_STAGES) return this;
      const label = marker(stage, 40);
      if (!label) return this;
      this.rec.stages.push({ stage: label, ms: numOrUndef(ms) ?? 0 });
    } catch { /* nunca throw */ }
    return this;
  }

  setProvider(info: { provider?: string; model?: string }): IntelligenceTrace {
    try {
      this.rec.provider = marker(info.provider, 40);
      this.rec.model = marker(info.model, 40);
    } catch { /* nunca throw */ }
    return this;
  }

  setLatency(info: { firstTokenMs?: number; firstUsefulMs?: number; totalMs?: number }): IntelligenceTrace {
    try {
      this.rec.firstTokenMs = numOrUndef(info.firstTokenMs);
      this.rec.firstUsefulMs = numOrUndef(info.firstUsefulMs);
      this.rec.totalMs = numOrUndef(info.totalMs);
    } catch { /* nunca throw */ }
    return this;
  }

  noteFallback(label: string): IntelligenceTrace {
    try {
      const m = marker(label, 40);
      if (m && this.rec.fallbacksUsed.length < MAX_LIST) this.rec.fallbacksUsed.push(m);
    } catch { /* nunca throw */ }
    return this;
  }

  noteError(label: string): IntelligenceTrace {
    try {
      const m = marker(label, 80);
      if (m && this.rec.errors.length < MAX_LIST) this.rec.errors.push(m);
    } catch { /* nunca throw */ }
    return this;
  }

  toRecord(): IntelligenceTraceRecord {
    // Retorna a shallow copiar com cloned arrays então a caller mutating o result can't
    // rewrite isso trace's internal estado (and, após commitTrace, o buffered
    // reregistro O registro stays an immutable snapshot. (code-review 2026-06-12 LBaixo
    return {
      ...this.rec,
      contextInclusion: this.rec.contextInclusion.map((e) => ({ ...e })),
      stages: this.rec.stages.map((s) => ({ ...s })),
      fallbacksUsed: [...this.rec.fallbacksUsed],
      errors: [...this.rec.errors],
      flags: { ...this.rec.flags },
      routerDecision: this.rec.routerDecision ? { ...this.rec.routerDecision } : undefined,
    };
  }
}

function numOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function safeFlagSnapshot(): Record<string, boolean> {
  try { return intelligenceFlagSnapshot(); } catch { return {}; }
}

// Ring buffer de recente completed records para dev inspection / o depurar ccomando
const RING_MAX = 200;
const ring: IntelligenceTraceRecord[] = [];

/**
 * Começa a rastrear para one answer. Retorna a no-op (zero-cost) rastrear quando o
 * `trace` flag é ofora ou an ativo recorder quando oem Nunca throws.
 */
export function beginTrace(query: string): IntelligenceTrace {
  try {
    if (!isIntelligenceTraceEnabled()) return NOOP;
    return new ActiveTrace(query);
  } catch {
    return NOOP;
  }
}

/**
 * Commit a finished rastrear dentro de o ring buffer (para "Mostrar Intelligence TRastrear
 * dev inspection). No-op para a disabled/no-op trastrear Nunca throws.
 */
export function commitTrace(trace: IntelligenceTrace | null | undefined): void {
  try {
    if (!trace || !trace.enabled) return;
    const rec = trace.toRecord();
    if (!rec) return;
    ring.push(rec);
    if (ring.length > RING_MAX) ring.shift();
  } catch { /* nunca throw */ }
}

/** Recente committed traces (dev/diagnostics/tests). */
export function recentTraces(n = 50): IntelligenceTraceRecord[] {
  return ring.slice(-Math.max(0, n));
}

/** Limpa o ring (tests). */
export function __resetTraceRing(): void {
  ring.length = 0;
}
