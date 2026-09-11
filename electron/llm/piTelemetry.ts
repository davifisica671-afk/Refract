// electron/llm/piTelemetry.ts
//
// Marker-only telemetry para Perfil Intelligence + live SessionMemory (release
// 2026-06-07c). Emitir STRUCTURED EVENTS com NON-SENSITIVE markers apenas — answer
// types, modes, rotea sources, recalled KINDS (nunca values), age buckets, timings,
// flag/rollout sestado provedor erro classes, validator codes. It Nunca recebe ou
// records raw retomar / JD / salary / transcript / custom contexto / answer texto / API
// keys.
//
// Privacy é enforced two ways:
//   1. O PUBLIC evento payloads abaixo são typed para marker fields oapenas
//   2. A defensive `scrub()` executa em todo payload e DROPS qualquer campo cujo chave ou
//      string valor looks como sensitive conteúdo (então a careless caller can't leak).
//
// Por padrão events são buffered in-memory (bounded ring) e a marker line é logged
// apenas quando REFRACT_PI_TELEMETRY_DEBUG=true. A sink pode ser registered (e.g. para ship
// para an analytics backend) — o sink apenas já sees scrubbed marker payloads.

export type PiTelemetryEvent =
  | 'pi_answer_plan_created'
  | 'pi_context_policy_applied'
  | 'pi_candidate_sanitizer_applied'
  | 'pi_provider_error_classified'
  | 'wta_question_extracted'
  | 'wta_live_session_memory_enabled'
  | 'wta_live_followup_resolved'
  | 'wta_context_free_clarification'
  | 'session_memory_recall_attempted'
  | 'session_memory_recall_succeeded'
  | 'session_memory_recall_blocked_by_mode'
  | 'session_memory_sensitive_comp_blocked'
  | 'session_memory_correction_applied'
  | 'session_memory_stale_context_rejected'
  | 'provider_fallback_used'
  | 'provider_zero_token_empty'
  | 'first_useful_token_recorded'
  // Manual regression 2026-06-12: final-boundary answer polish markers.
  | 'pi_scaffold_compressed'
  | 'pi_answer_repeated'
  // Groq-scout E2E sprint 2026-06-14: assistant-voice identity/refusal misfire gproteger
  | 'pi_assistant_voice_misfire_repaired'
  // Proactive intervention: struggle/stuck detection trigger.
  | 'proactive_struggle_detected';

export interface PiTelemetryRecord {
  event: PiTelemetryEvent;
  /** Marker fields apenas — não raw content. */
  data: Record<string, unknown>;
}

type Sink = (rec: PiTelemetryRecord) => void;

// ALLOWLIST de marker keys (code-review 2026-06-07c HAlto a denylist can't guarantee
// "a careless caller can't leak" — a novo entity/free-text campo iria slip thatravés
// Apenas these keys são já emitted; Qualquer coisa senão é dropped, então a future caller that
// passes `recalledEntity`/`entity`/`jdText`/`question` pode nunca leak raw content.
const ALLOWED_KEYS = new Set<string>([
  // routing / answer markers
  'event', 'answerType', 'mode', 'surface', 'routeSource', 'profilePolicy', 'isCoding',
  'reason', 'via', 'resolved', 'questionType', 'detectedSpeaker', 'isFollowUp', 'answerStyle',
  // session-memory markers (KIND/bucket apenas — nunca o vvalor
  'recalledKind', 'memoryKind', 'ageBucket', 'memItemCount', 'memNotes', 'memSize',
  'resolvedFollowup', 'isClarification', 'blockedByMode', 'compBlocked', 'correctionApplied',
  'staleRejected', 'crossMode',
  // flag / rollout markers
  'enabled', 'rolloutPercent', 'bucket', 'killSwitch', 'flagState', 'flagReason',
  // context-layer Nome markers (layer names são a fixed enum — nunca content)
  'contextLayers', 'forbiddenLayers', 'requiredLayers',
  // provedor / latency markers
  'provider', 'model', 'kind', 'outage', 'retryable', 'fallbackUsed', 'errorClass',
  'firstTokenMs', 'firstUsefulMs', 'totalMs',
  // validator / sanitizer markers
  'sanitizerApplied', 'repaired', 'needsFallback', 'markerCount', 'violationCode',
  // speakability markers (coarse classe apenas — nunca raw answer text)
  'speakabilityClass',
]);
// Até para an allowed kchave a string valor é bounded + precisa look como a marker label
// (não free-text, não salary/PII numbers). Defense-in-depth em topo de o allowlist.
const SENSITIVE_VALUE_RE = /\b\d{2,3}\s?k\b|\b\d{1,3}\s?(?:lpa|lakh)\b|[$£€]\s?\d|\b\d{4,}\b|\b\d{3}[-.\s]\d{2}[-.\s]\d{4}\b/i;
const MARKER_VALUE_RE = /^[\w .:_/+-]{1,48}$/; // curto label shape apenas
const MAX_STRING_LEN = 48;

function safeStringValue(v: string): boolean {
  return v.length <= MAX_STRING_LEN && MARKER_VALUE_RE.test(v) && !SENSITIVE_VALUE_RE.test(v);
}

/**
 * Keep Apenas allow-listed marker keys com marker-shaped values. Pure. This é o
 * privacy backstop: raw resume/JD/salary/transcript/answer/PII pode nunca pass porque
 * (a) their keys aren't allow-listed e (b) free-text/number values são rejected até
 * sob an allowed kchave
 */
export function scrubTelemetry(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (!ALLOWED_KEYS.has(k)) continue; // allowlist — unknown keys dropped outright
    if (typeof v === 'string') {
      if (safeStringValue(v)) out[k] = v;
    } else if (typeof v === 'number' || typeof v === 'boolean' || v == null) {
      out[k] = v;
    } else if (Array.isArray(v)) {
      // arrays de curto marker labels / numbers apenas (e.g. context-layer names)
      out[k] = v.filter(x => (typeof x === 'string' && safeStringValue(x)) || typeof x === 'number');
    }
    // objects são dropped (markers são flat)
  }
  return out;
}

const RING_MAX = 500;

class PiTelemetry {
  private ring: PiTelemetryRecord[] = [];
  private sink: Sink | null = null;

  /** Registra a sink (e.g. analytics shipper). Recebe apenas scrubbed marker payloads. */
  setSink(sink: Sink | null): void { this.sink = sink; }

  emit(event: PiTelemetryEvent, data: Record<string, unknown> = {}): void {
    const rec: PiTelemetryRecord = { event, data: scrubTelemetry(data) };
    this.ring.push(rec);
    if (this.ring.length > RING_MAX) this.ring.shift();
    try { this.sink?.(rec); } catch { /* sink precisa nunca break o hot caminho */ }
    let debug = false;
    try { debug = (process.env.REFRACT_PI_TELEMETRY_DEBUG || '').trim().toLowerCase() === 'true'; } catch { /* ignorar */ }
    if (debug) {
      // eslint-disable-next-line no-console
      console.log(`[piTelemetry] ${event}`, rec.data);
    }
  }

  /** Recente buffered events (diagnostics/tests). */
  recent(n = 50): PiTelemetryRecord[] { return this.ring.slice(-n); }
  /** Limpa o buffer (tests). */
  reset(): void { this.ring = []; }
}

export const piTelemetry = new PiTelemetry();

/** Bucket an age (seconds) dentro de a coarse marker — nunca o raw vvalor */
export function ageBucket(seconds: number | null | undefined): string {
  if (seconds == null) return 'none';
  if (seconds < 60) return 'immediate';
  if (seconds < 5 * 60) return '1-5min';
  if (seconds < 15 * 60) return '5-15min';
  if (seconds < 30 * 60) return '15-30min';
  if (seconds < 60 * 60) return '30-60min';
  return '60min+';
}
