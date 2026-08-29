import fs from 'fs';
import path from 'path';

export type TelemetryEventName =
  | 'app_start'
  | 'meeting_start'
  | 'meeting_stop'
  | 'mode_selected'
  | 'mode_switched'
  | 'dynamic_action_detected'
  | 'dynamic_action_shown'
  | 'dynamic_action_accepted'
  | 'dynamic_action_dismissed'
  | 'dynamic_action_completed'
  | 'llm_request_started'
  | 'llm_first_token_latency'
  | 'llm_completed'
  | 'provider_fallback'
  | 'provider_error'
  | 'stt_started'
  | 'stt_partial_latency'
  | 'stt_final_latency'
  | 'stt_reconnect'
  | 'stt_error'
  // ── Regional STT relay (Fase 7/8) — nunca carry token/key/transcript text.
  // Properties são metadados apenas (region, url-kind, fechar code, latency bucket).
  | 'relay_session_resolved'
  | 'relay_selected'
  | 'relay_connected'
  | 'relay_failed'
  | 'relay_fallback_used'
  | 'first_transcript_latency_bucket'
  | 'stt_relay_disabled_flag_off'
  | 'rag_query'
  | 'rag_hit'
  | 'rag_miss'
  | 'rag_lexical_fallback'
  | 'screen_context_captured'
  | 'screen_context_error'
  | 'post_call_summary_started'
  | 'post_call_summary_completed'
  | 'post_call_summary_failed'
  // ── Perfil Intelligence live-path latency events (REPORT_TO_CHATGPT §27) ──
  // O completo click→render trastrear Todo evento carries timings/sizes/hashes oapenas
  // nunca raw resume/JD/custom/persona/negotiation/transcript conteúdo (o
  // sanitizer abaixo strips those keys; callers precisa pass mmetadados não content).
  | 'question_submitted'
  | 'what_to_answer_clicked'
  | 'transcript_window_loaded'
  | 'latest_question_extracted'
  | 'intent_classified'
  | 'answer_type_selected'
  | 'context_selected'
  | 'context_build_started'
  | 'context_build_completed'
  | 'context_layers_used'
  | 'prompt_built'
  | 'provider_request_started'
  | 'first_response_byte'
  | 'first_stream_chunk'
  | 'first_visible_text'
  | 'first_useful_token'
  | 'response_completed'
  | 'validation_started'
  | 'validation_completed'
  | 'validation_failed'
  | 'repair_used'
  | 'retry_used'
  | 'provider_race_started'
  | 'provider_race_won'
  | 'ui_render_completed'
  | 'cost_estimated'
  | 'tokens_used'
  | 'degraded_context';

export type TelemetrySinkName = 'local-jsonl' | 'posthog' | 'axiom' | 'sentry';

export interface TelemetrySinkConfig {
  name: TelemetrySinkName;
  enabled: boolean;
  endpoint?: string;
  projectId?: string;
  /**
   * Credential para o sink. NEVER logged ou echoed; used apenas para authenticate
   * o outbound POST. PostHog: project API key. Sentry: completo DSN. Axiom: token
   * (with `dataset` set). Absent → o sink is treated as unconfigured (silently
   * skipped) even se `enabled` is true.
   */
  apiKey?: string;
  /** Sentry oapenas completo DSN (preferred sobre apiKey quando nome === 'sentry'). */
  dsn?: string;
  /** Axiom oapenas dataset nome (paired com `apiKey` = totoken */
  dataset?: string;
  /** Optional stable, already-hashed distinct id para PostHog (nunca a raw key/email). */
  distinctId?: string;
  /** Release/version tag para Sentry events. */
  release?: string;
  /** Ambiente tag (e.g. 'production'). */
  environment?: string;
}

export interface TelemetryConfig {
  enabled?: boolean;
  localEnabled?: boolean;
  userDataPath?: string;
  logFilePath?: string;
  sinks?: TelemetrySinkConfig[];
  /**
   * Dev/test-only structured depurar metadata merged em EVERY event's
   * `properties` (under `debug`). Used by evals/real-UI para anexar the
   * answerType/intent/selectedContextLayers/provider/model/timings snapshot
   * sem polluting production logs. Still passes através o sanitizer,
   * so it deve carry metadata (names/sizes/hashes), nunca raw content.
   */
  debugMetadata?: Record<string, unknown> | null;
}

export interface TelemetryEventInput {
  name: TelemetryEventName | string;
  sessionId?: string;
  modeId?: string;
  provider?: string;
  durationMs?: number;
  status?: string;
  properties?: Record<string, unknown>;
}

export interface TelemetryRecord {
  name: string;
  timestamp: string;
  sessionId?: string;
  modeId?: string;
  provider?: string;
  durationMs?: number;
  status?: string;
  properties: Record<string, unknown>;
}

const DEFAULT_FILE_NAME = 'telemetry.jsonl';
const REDACTED = '[REDACTED]';
const REMOVED = '[REMOVED]';

// Sensitive-key match: qualquer propriedade cujo nome termina com one de these tokens
// é REDACTED. O lista intentionally inclui tudo que tem já
// carried verbatim user conteúdo (queries, chunks, transcripts, prompts,
// erro bodies, free-form erro messages). Adiciona para isso lista quando introducing
// qualquer novo free-text propriedade — telemetry deve nunca carry raw user ientrada
const SENSITIVE_KEY_RE = /(api[_-]?key|authorization|bearer|token|secret|password|credential|raw[_-]?(transcript|prompt|reference|content|query|resume|jd|persona|negotiation)|transcript(text)?|prompt|reference(content)?|evidence(text)?|screenshot(path)?|image(path)?|error(body|response|message)?|responsebody|body|query(text|string)?|user(input|message)|chunk(text|content)?|snippet(text)?|resume(text)?|persona(text)?|negotiation(text|script|context)?|jd(text|content)?|customcontext|customnotes|notes|note|answer(text)?|question(text)?|latestquestion|salary|compensation|content|text)$/i;
// REMOVE_VALUE_KEY_RE matches a strict subset de o acima para que we soltar
// o valor entirely (não apenas redact). Used para keys que são guaranteed-
// bulky raw texto — we don't want a 16KB transcript campo em a registrar line até
// com [REDACTED] em place.
const REMOVE_VALUE_KEY_RE = /(raw[_-]?(transcript|prompt|reference|content|query|resume|jd|persona|negotiation)|transcript(text)?|prompt|reference(content)?|evidence(text)?|screenshot(path)?|image(path)?|error(body|response)?|responsebody|body|query(text|string)?|user(input|message)|chunk(text|content)?|snippet(text)?|resume(text)?|persona(text)?|negotiation(text|script|context)?|jd(text|content)?|customcontext|customnotes|notes|note|answer(text)?|question(text)?|latestquestion|content|text)$/i;
const API_KEY_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+\/=:-]{12,}/gi,
  /refract_sk_[A-Za-z0-9._-]+/gi,
  /natively_sk_[A-Za-z0-9._-]+/gi,
  /sk-[A-Za-z0-9]{20,}/gi,
  /gsk_[A-Za-z0-9]{20,}/gi,
  /dg_[A-Za-z0-9]{20,}/gi,
  /[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/g,
];

/**
 * A monotonic timing span. Created por `telemetryService.startSpan(name)`,
 * closed por `.end()` / `.endWith(status, extraProps)`. Em fechar it emite ONE
 * telemetry evento com `durationMs` measured de a monotonic clock
 * (`performance.now()` quando disponível — immune para wall-clock adjustments).
 * Closing twice é a no-op. Spans são cheap e non-blocking; they nunca throw.
 */
export class TelemetrySpan {
  private startedAt: number;
  private ended = false;
  constructor(
    private readonly service: TelemetryService,
    private readonly name: TelemetryEventName | string,
    private readonly base: Omit<TelemetryEventInput, 'name' | 'durationMs'> = {},
  ) {
    this.startedAt = monotonicNow();
  }
  /** Elapsed ms desde o span started, sem closing it. */
  elapsedMs(): number {
    return Math.max(0, Math.round(monotonicNow() - this.startedAt));
  }
  /** Fechar o span e emitir o eevento Safe para chamar ouma vez depois calls no-op. */
  end(extraProps?: Record<string, unknown>): number {
    if (this.ended) return 0;
    this.ended = true;
    const durationMs = this.elapsedMs();
    this.service.track({
      ...this.base,
      name: this.name,
      durationMs,
      properties: { ...(this.base.properties ?? {}), ...(extraProps ?? {}) },
    });
    return durationMs;
  }
  /** Fechar com an explicit status (e.g. 'ok' | 'timeout' | 'error'). */
  endWith(status: string, extraProps?: Record<string, unknown>): number {
    if (this.ended) return 0;
    this.ended = true;
    const durationMs = this.elapsedMs();
    this.service.track({
      ...this.base,
      name: this.name,
      durationMs,
      status,
      properties: { ...(this.base.properties ?? {}), ...(extraProps ?? {}) },
    });
    return durationMs;
  }
}

function monotonicNow(): number {
  // performance.now() exists em Electron principal + renderer; fall voltar para Date.now.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p: any = (globalThis as any).performance;
    if (p && typeof p.now === 'function') return p.now();
  } catch { /* ignorar */ }
  return Date.now();
}

export class TelemetryService {
  private enabled: boolean;
  private localEnabled: boolean;
  private logFilePath: string;
  private sinks: TelemetrySinkConfig[];
  private debugMetadata: Record<string, unknown> | null;

  constructor(config: TelemetryConfig = {}) {
    this.enabled = config.enabled !== false;
    this.localEnabled = config.localEnabled !== false;
    this.sinks = config.sinks ?? [];
    this.debugMetadata = config.debugMetadata ?? null;
    this.logFilePath = config.logFilePath ?? path.join(config.userDataPath ?? process.cwd(), 'logs', DEFAULT_FILE_NAME);
  }

  /**
   * Phase 6 — runtime reconfiguration so o shared singleton pode interruptor from
   * a process.cwd()-relative registro caminho para o real Electron userData caminho once
   * o app is ready. Settings changes (enable/disable telemetry) também flow
   * através here. Never mutates o in-memory registro buffer — antigo events stay
   * where they were written.
   */
  configure(config: TelemetryConfig): void {
    if (typeof config.enabled === 'boolean') this.enabled = config.enabled;
    if (typeof config.localEnabled === 'boolean') this.localEnabled = config.localEnabled;
    if (Array.isArray(config.sinks)) this.sinks = config.sinks;
    if (config.logFilePath) {
      this.logFilePath = config.logFilePath;
    } else if (config.userDataPath) {
      this.logFilePath = path.join(config.userDataPath, 'logs', DEFAULT_FILE_NAME);
    }
    // `null` explicitly climpa `undefined` leaves o atual valor untouched.
    if (config.debugMetadata !== undefined) this.debugMetadata = config.debugMetadata;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getLogFilePath(): string {
    return this.logFilePath;
  }

  /**
   * Set/clear o dev/test-only debug-metadata snapshot merged em every
   * evento sob `properties.debug`. Pass `null` para clear. No-op in production
   * unless a caller opts in (the eval harnesses do; o app does not).
   */
  setDebugMetadata(metadata: Record<string, unknown> | null): void {
    this.debugMetadata = metadata;
  }

  /** Convenience alias para `track({ name, properties })`. */
  record(name: TelemetryEventName | string, properties?: Record<string, unknown>): void {
    this.track({ name, properties });
  }

  /**
   * Start a timing span. The returned span emits one evento com `durationMs`
   * (monotonic) quando `.end()`/`.endWith()` is called. Use para o live-path
   * stage timings (context build, provider connect, etc.).
   */
  startSpan(
    name: TelemetryEventName | string,
    base: Omit<TelemetryEventInput, 'name' | 'durationMs'> = {},
  ): TelemetrySpan {
    return new TelemetrySpan(this, name, base);
  }

  track(input: TelemetryEventInput): void {
    if (!this.enabled) return;

    // HARD CONTRACT: telemetry precisa Nunca lançar ou block em o live answer
    // pcaminho Todo span/trace mark routes através haqui todos dentro o engine's
    // tentativa externa — uma exceção seria engolida dentro do capturar da resposta e
    // abortar o rresposta Então o whole corpo é guarded; a sanitizer/caller-prop
    // edge pode at worst soltar o eevento nunca break o app.
    try {
      // Mescla dev/test depurar metadados (if sdefine sob a `debug` namespace então it
      // nunca collides com caller props. Ainda sanitized babaixo Proteger o
      // event-level `debug` então a non-object valor can't degrade o spread.
      const evDebug = (input.properties?.debug && typeof input.properties.debug === 'object' && !Array.isArray(input.properties.debug))
        ? (input.properties.debug as Record<string, unknown>)
        : {};
      const mergedProps: Record<string, unknown> = this.debugMetadata
        ? { ...(input.properties ?? {}), debug: { ...this.debugMetadata, ...evDebug } }
        : (input.properties ?? {});

      const record: TelemetryRecord = {
        name: String(input.name),
        timestamp: new Date().toISOString(),
        properties: sanitizeTelemetryProperties(mergedProps),
      };

      if (input.sessionId) record.sessionId = String(input.sessionId);
      if (input.modeId) record.modeId = String(input.modeId);
      if (input.provider) record.provider = String(input.provider);
      if (typeof input.durationMs === 'number' && Number.isFinite(input.durationMs)) record.durationMs = input.durationMs;
      if (input.status) record.status = String(input.status);

      if (this.localEnabled) {
        this.appendLocal(record);
      }

      for (const sink of this.sinks) {
        if (!sink.enabled || sink.name === 'local-jsonl') continue;
        // Fire-and-forget remote ddespacha Cada sender é completamente guarded and
        // Retorna imediatamente — telemetry precisa nunca block ou break o app.
        this.dispatchToSink(sink, record);
      }
    } catch {
      // Telemetry precisa nunca break app behavior.
    }
  }

  /**
   * Send one record para a remote sink. Dependency-free (raw fetch), non-blocking
   * (3s timeout, swallowed rejections), no-op quando o sink lacks a credential.
   * NEVER ships a raw key/token — o record's properties are already sanitized;
   * o sink credential authenticates o transport only.
   */
  private dispatchToSink(sink: TelemetrySinkConfig, record: TelemetryRecord): void {
    try {
      const f: typeof fetch | undefined = (globalThis as { fetch?: typeof fetch }).fetch;
      if (typeof f !== 'function') return;

      const post = (url: string, opts: RequestInit) => {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 3000);
          f(url, { ...opts, signal: controller.signal })
            .catch(() => {})
            .finally(() => clearTimeout(timer));
        } catch {
          // nunca throw
        }
      };

      if (sink.name === 'posthog') {
        const apiKey = sink.apiKey;
        if (!apiKey) return; // unconfigured
        const host = (sink.endpoint || 'https://app.posthog.com').replace(/\/$/, '');
        post(`${host}/capture/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: apiKey,
            event: record.name,
            distinct_id: sink.distinctId || 'refract-desktop',
            properties: {
              ...record.properties,
              ...(record.sessionId ? { session_id: record.sessionId } : {}),
              ...(record.modeId ? { mode_id: record.modeId } : {}),
              ...(record.provider ? { provider: record.provider } : {}),
              ...(typeof record.durationMs === 'number' ? { duration_ms: record.durationMs } : {}),
              ...(record.status ? { status: record.status } : {}),
              $lib: 'refract-desktop',
            },
            timestamp: record.timestamp,
          }),
        });
        return;
      }

      if (sink.name === 'axiom') {
        const token = sink.apiKey;
        const dataset = sink.dataset || sink.endpoint;
        if (!token || !dataset) return;
        post(`https://api.axiom.co/v1/datasets/${encodeURIComponent(dataset)}/ingest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify([{ _time: record.timestamp, kind: record.name, source: 'desktop', ...record.properties,
            ...(record.sessionId ? { session_id: record.sessionId } : {}),
            ...(record.provider ? { provider: record.provider } : {}),
            ...(typeof record.durationMs === 'number' ? { duration_ms: record.durationMs } : {}),
            ...(record.status ? { status: record.status } : {}) }]),
        });
        return;
      }

      if (sink.name === 'sentry') {
        // Apenas ERROR-ish events go para Sentry — it's não an analytics sink. We
        // para frente records cujo status looks como a failure ou cujo nome marks
        // an error/crash; tudo senão é skipped (analytics belongs em
        // PostHog/Axiom).
        const looksError = record.status === 'error' || record.status === 'failed'
          || /error|fail|crash|reject/i.test(record.name);
        if (!looksError) return;
        const parsed = parseClientSentryDsn(sink.dsn || sink.apiKey);
        if (!parsed) return;
        const eventId = randomClientHex32();
        const event = {
          event_id: eventId,
          timestamp: record.timestamp,
          platform: 'node',
          level: 'error',
          logger: 'refract-desktop',
          release: sink.release || 'unknown',
          environment: sink.environment || 'production',
          tags: { service: 'refract-desktop', event: record.name, ...(record.provider ? { provider: record.provider } : {}) },
          extra: { ...record.properties, ...(record.status ? { status: record.status } : {}) },
          message: { formatted: `desktop:${record.name}${record.status ? ` (${record.status})` : ''}` },
        };
        const header = JSON.stringify({ event_id: eventId, sent_at: record.timestamp, dsn: parsed.dsn });
        const itemHeader = JSON.stringify({ type: 'event' });
        post(parsed.envelopeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': parsed.authHeader },
          body: `${header}\n${itemHeader}\n${JSON.stringify(event)}\n`,
        });
        return;
      }
    } catch {
      // nunca lançar de telemetry despacha
    }
  }

  private appendLocal(record: TelemetryRecord): void {
    try {
      fs.mkdirSync(path.dirname(this.logFilePath), { recursive: true });
      fs.appendFileSync(this.logFilePath, `${JSON.stringify(record)}\n`, 'utf8');
    } catch (error) {
      // Telemetry precisa nunca break app behavior.
    }
  }
}

export function sanitizeTelemetryProperties(properties: Record<string, unknown>): Record<string, unknown> {
  return sanitizeObject(properties, new WeakSet()) as Record<string, unknown>;
}

function sanitizeObject(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return Number.isNaN(value) ? null : value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;

  if (Array.isArray(value)) {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    return value.map(item => sanitizeObject(item, seen)).filter(item => item !== undefined);
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (REMOVE_VALUE_KEY_RE.test(key)) {
        output[key] = REMOVED;
      } else if (SENSITIVE_KEY_RE.test(key)) {
        output[key] = REDACTED;
      } else {
        const sanitized = sanitizeObject(child, seen);
        if (sanitized !== undefined) output[key] = sanitized;
      }
    }
    return output;
  }

  return undefined;
}

function redactString(value: string): string {
  let redacted = value;
  for (const pattern of API_KEY_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, REDACTED);
  }
  return redacted;
}

// ── Cliente Sentry helpers (raw-HTTP envelope; não @sentry/electron dependency) ──

interface ParsedSentryDsn { dsn: string; envelopeUrl: string; authHeader: string }

/** Analisa a Sentry DSN dentro de ingest URL + auth hcabeçalho Retorna nulo se absent/invalid. */
export function parseClientSentryDsn(dsn: string | undefined): ParsedSentryDsn | null {
  if (!dsn || typeof dsn !== 'string') return null;
  try {
    const u = new URL(dsn);
    const publicKey = u.username;
    const projectId = u.pathname.replace(/^\//, '');
    if (!publicKey || !projectId) return null;
    return {
      dsn,
      envelopeUrl: `${u.protocol}//${u.host}/api/${projectId}/envelope/`,
      authHeader: `Sentry sentry_version=7, sentry_client=refract-desktop/1.0, sentry_key=${publicKey}`,
    };
  } catch {
    return null;
  }
}

/** 32-hex evento id, dependency-free (não node:crypto importar necessário em o renderer-safe pacaminho */
function randomClientHex32(): string {
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

export const telemetryService = new TelemetryService();
