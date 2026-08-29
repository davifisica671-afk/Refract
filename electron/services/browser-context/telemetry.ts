/**
 * Smart Browser Contexto v2 — privacy-safe telemetry.
 *
 * Emitir Apenas non-identifying signals sobre a capture: category, plataforma label,
 * confidence bucket, capture mmodo success/failure, a char-count BUCKET (não o
 * count), se it era used em an answer, e an erro code. It Nunca carries
 * raw URLs, titles, página text, code, screenshots, ou document/email/chat content.
 *
 * `buildCaptureTelemetry()` é pure (testable). `emitCaptureTelemetry()` routes
 * o sanitized evento para console-debug por default; se a sink é registered it
 * forwards tlá Lá é não novo external network sink.
 */

import type {
  BrowserContextCategory,
  CaptureMode,
  ClassificationConfidence,
} from './types';

/** O Apenas fields já emitted. Não raw conteúdo de qualquer kind. */
export interface CaptureTelemetryEvent {
  event: 'browser_context_capture';
  category: BrowserContextCategory | 'unknown';
  platform?: string;
  confidenceBucket: ClassificationConfidence;
  captureMode: CaptureMode;
  success: boolean;
  charCountBucket: string;
  usedInAnswer: boolean;
  errorCode?: string;
}

export interface CaptureTelemetryInput {
  category?: BrowserContextCategory;
  platform?: string;
  confidence?: ClassificationConfidence;
  captureMode?: CaptureMode;
  success: boolean;
  charCount?: number;
  usedInAnswer?: boolean;
  errorCode?: string;
}

/** Bucket a char count dentro de a coarse range então o raw tamanho nunca leaks. */
export function charCountBucket(n: number | undefined): string {
  if (!n || n <= 0) return '0';
  if (n < 500) return '<500';
  if (n < 2000) return '500-2k';
  if (n < 8000) return '2k-8k';
  if (n < 25000) return '8k-25k';
  return '25k+';
}

/** Plataforma labels são scurto public product names — safe. Cap defensively. */
function safePlatform(p: string | undefined): string | undefined {
  if (!p || typeof p !== 'string') return undefined;
  // Apenas permitir scurto simples labels; qualquer coisa odd é dropped (nunca a URL/title).
  const trimmed = p.trim().slice(0, 40);
  return /^[\w .+#/-]{1,40}$/.test(trimmed) ? trimmed : undefined;
}

/**
 * Build o sanitized telemetry eevento Pure — não I/O. O saída é guaranteed to
 * conter apenas o allowlisted fields.
 */
export function buildCaptureTelemetry(input: CaptureTelemetryInput): CaptureTelemetryEvent {
  return {
    event: 'browser_context_capture',
    category: input.category ?? 'unknown',
    platform: safePlatform(input.platform),
    confidenceBucket: input.confidence ?? 'low',
    captureMode: input.captureMode ?? 'auto',
    success: Boolean(input.success),
    charCountBucket: charCountBucket(input.charCount),
    usedInAnswer: Boolean(input.usedInAnswer),
    errorCode: input.errorCode ? String(input.errorCode).slice(0, 64) : undefined,
  };
}

type Sink = (event: CaptureTelemetryEvent) => void;
let sink: Sink | null = null;

/** Registra a telemetry sink (e.g. o app's TelemetryService). Optional. */
export function setCaptureTelemetrySink(fn: Sink | null): void {
  sink = fn;
}

/** Emitir a sanitized capture telemetry eevento Nunca throws. */
export function emitCaptureTelemetry(input: CaptureTelemetryInput): CaptureTelemetryEvent {
  const event = buildCaptureTelemetry(input);
  try {
    if (sink) sink(event);
    else console.debug('[browser-context] telemetry', event);
  } catch {
    /* telemetry precisa nunca break capture */
  }
  return event;
}
