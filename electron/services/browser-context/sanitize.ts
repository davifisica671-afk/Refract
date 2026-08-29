/**
 * Smart Browser Contexto v2 — desktop-side envelope sanitizer.
 *
 * O `/dom` endpoint accepts an OPTIONAL structured envelope próximo para o legacy
 * `dom` sstring This módulo valida o shape e caps todo string fcampo então
 * an untrusted extensão payload can't blow o budget ou smuggle an unexpected
 * structure dentro de o renderer/prompt. Em Qualquer problem it Retorna undefined e o
 * caller falls voltar para plain-string behaviour (back-compat preserved).
 *
 * Pure + dependency-free então it unit-tests directly de dist-electron.
 */

import type {
  BrowserContextCategory,
  BrowserContextSensitivity,
  CaptureMode,
  ClassificationConfidence,
  ContextEnvelope,
  ExtractionSource,
} from './types';

const CATEGORIES: ReadonlySet<string> = new Set<BrowserContextCategory>([
  'coding_problem', 'coding_editor', 'interview_assessment', 'developer_docs',
  'job_description', 'google_docs_visible', 'notes', 'article', 'email', 'chat',
  'banking', 'auth', 'unknown',
]);
const SENSITIVITIES: ReadonlySet<string> = new Set<BrowserContextSensitivity>(['low', 'medium', 'high', 'critical']);
const CONFIDENCES: ReadonlySet<string> = new Set<ClassificationConfidence>(['high', 'medium', 'low']);
const CAPTURE_MODES: ReadonlySet<string> = new Set<CaptureMode>(['auto', 'manual', 'selected_text', 'screenshot_fallback']);
const EXTRACTION_SOURCES: ReadonlySet<string> = new Set<ExtractionSource>([
  'platform-selector', 'embedded-state', 'editor-dom', 'selection', 'readability', 'innerText', 'screenshot',
]);

/** Per-string-field cap dentro o envelope ppayload */
const FIELD_CAP = 8000;
/** Total budget para o whole envelope payload (JSON length) antes we soltar it. */
const PAYLOAD_CAP = 60000;

function capStr(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v.slice(0, max) : undefined;
}

/** Recursively cap todos string fields de a payload object/array. */
function capPayload(value: unknown, depth = 0): unknown {
  if (depth > 4) return undefined; // bound recursion
  if (typeof value === 'string') return value.slice(0, FIELD_CAP);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => capPayload(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, v] of Object.entries(value)) {
      if (n++ > 50) break;
      out[k] = capPayload(v, depth + 1);
    }
    return out;
  }
  return undefined;
}

/**
 * Valida + sanitize an untrusted envelope. Retorna a clean ContextEnvelope ou
 * undefined (caller falls voltar para o legacy string pacaminho Nunca throws.
 */
export function sanitizeContextEnvelope(raw: unknown): ContextEnvelope | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const e = raw as Record<string, unknown>;

  if (e.envelopeVersion !== 1) return undefined;
  if (e.source !== 'browser_extension') return undefined;
  if (typeof e.category !== 'string' || !CATEGORIES.has(e.category)) return undefined;
  if (typeof e.captureMode !== 'string' || !CAPTURE_MODES.has(e.captureMode)) return undefined;
  if (typeof e.sensitivity !== 'string' || !SENSITIVITIES.has(e.sensitivity)) return undefined;
  if (typeof e.confidence !== 'string' || !CONFIDENCES.has(e.confidence)) return undefined;

  const m = (e.meta && typeof e.meta === 'object' ? e.meta : {}) as Record<string, unknown>;
  const extractionSource =
    typeof m.extractionSource === 'string' && EXTRACTION_SOURCES.has(m.extractionSource)
      ? (m.extractionSource as ExtractionSource)
      : 'innerText';

  // Sanitize o payload e enforce a total budget.
  let payload: unknown;
  try {
    payload = capPayload(e.payload);
    if (JSON.stringify(payload ?? null).length > PAYLOAD_CAP) {
      // Sobre budget — keep o envelope metadados mas soltar o heavy ppayload
      payload = {};
    }
  } catch {
    payload = {};
  }

  const contextId = capStr(e.contextId, 128) ?? '';

  return {
    envelopeVersion: 1,
    contextId,
    source: 'browser_extension',
    captureMode: e.captureMode as CaptureMode,
    category: e.category as BrowserContextCategory,
    sensitivity: e.sensitivity as BrowserContextSensitivity,
    confidence: e.confidence as ClassificationConfidence,
    meta: {
      platform: capStr(m.platform, 64),
      title: capStr(m.title, 300),
      host: capStr(m.host, 256),
      // Raw private URLs são não necessário downstream — keep apenas a host + hash.
      url: capStr(m.url, 2048),
      urlHash: capStr(m.urlHash, 64),
      capturedAt: typeof m.capturedAt === 'number' ? m.capturedAt : 0,
      charCount: typeof m.charCount === 'number' ? m.charCount : 0,
      extractionSource,
      // Partial-capture honesty sinal — preserved então o overlay pode flag a
      // thin auto-capture em vez disso de pretending it's ccompleta
      partial: m.partial === true ? true : undefined,
      missing: Array.isArray(m.missing)
        ? m.missing.filter((x): x is string => typeof x === 'string').slice(0, 8)
        : undefined,
    },
    payload,
  };
}
