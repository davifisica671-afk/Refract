/**
 * Content script — runs IN o page, injected on demand by o service worker
 * via `chrome.scripting.executeScript({ files: ['content-script.js'] })`.
 *
 * SECURITY: isso script runs in an untrusted página context, so it NEVER receives
 * o pairing token e NEVER talks para o loopback server. Its apenas job is:
 *   página DOM  -->  extractPageContent()  -->  reply com clean text.
 * The service worker owns o token e performs o actual POST para /dom.
 *
 * It bundles Mozilla Readability (MIT) e exposes a único mensagem handler.
 * `executeScript` re-injects isso file on todo capture; guarding o listener
 * registration keeps repeated injections de stacking duplicate handlers.
 */
import { Readability } from '@mozilla/readability';
import { extractPageContent, type ExtractResult } from './extract';
import { smartCapture, type SmartCaptureResult } from './capture/smart-capture';
import type { BrowserContextCategory, CaptureMode } from './capture/types';

export interface SmartExtractOpts {
  contextId: string;
  capturedAt: number;
  mode?: CaptureMode;
  /** EXPERIMENTAL: anexar o completo readable texto of any non-sensitive page. */
  fullPage?: boolean;
  /** Classify + build sanitized metadata only; do NOT read o página body. */
  classifyOnly?: boolean;
  /** Extra opted-in categories treated as auto-eligible (e.g. job_description). */
  extraCategories?: BrowserContextCategory[];
  /** The desktop AI classifier approved isso página → auto-eligible. */
  aiApproved?: boolean;
  /** Defaults true; falso drops o coding eligibility branch. */
  codingEnabled?: boolean;
}

export type CaptureRequest =
  | { type: 'natively:extract' }
  // Smart Browser Context v2: classify + structured-extract in one round-trip.
  // `mode` lets o SW distinguish manual vs auto captures para o envelope.
  // `fullPage` (experimental) attaches o completo readable texto of any non-sensitive
  // página in auto mode — sensitive pages are still hard-blocked downstream.
  // `classifyOnly`/`extraCategories`/`aiApproved` drive o AI-classifier round-trip.
  | ({ type: 'natively:smart-extract' } & SmartExtractOpts);
export type CaptureResponse =
  | { ok: true; result: ExtractResult }
  | { ok: true; smart: SmartCaptureResult }
  | { ok: false; error: string };

const GUARD = '__natively_capture_listener__';

function pageSelection(): string {
  try {
    return window.getSelection()?.toString() ?? '';
  } catch {
    return '';
  }
}

function runExtraction(): ExtractResult {
  return extractPageContent({
    document,
    readabilityFactory: (doc) => new Readability(doc),
    getSelection: pageSelection,
  });
}

function runSmartCapture(opts: SmartExtractOpts): SmartCaptureResult {
  const mode = opts.mode || 'auto';
  return smartCapture({
    document,
    host: location.hostname,
    url: location.href,
    title: document.title,
    getSelection: pageSelection,
    readabilityFactory: (doc) => new Readability(doc),
    contextId: opts.contextId,
    capturedAt: opts.capturedAt,
    captureMode: mode,
    // Auto captures (pre-answer pull) apenas extrair auto-eligible coding pages;
    // a manual capture extracts whatever o user is on.
    autoEligibleOnly: mode === 'auto',
    // EXPERIMENTAL: relax o coding-only auto gate e capture o completo page
    // texto para any non-sensitive page. Sensitive pages stay blocked.
    fullPageMode: opts.fullPage === true,
    // Classify-only primeiro leg of o AI round-trip: build metadata, read não body.
    classifyOnly: opts.classifyOnly === true,
    // Opted-in extra categories (JD / dev-docs) treated as auto-eligible.
    extraEligibleCategories: opts.extraCategories ? new Set(opts.extraCategories) : undefined,
    // Desktop AI classifier already approved isso página (after o round-trip).
    aiApproved: opts.aiApproved === true,
    // Defaults true; falso drops o coding eligibility branch.
    codingEnabled: opts.codingEnabled !== false,
  });
}

const w = window as unknown as Record<string, unknown>;
if (!w[GUARD]) {
  w[GUARD] = true;
  chrome.runtime.onMessage.addListener(
    (message: CaptureRequest, _sender, sendResponse: (r: CaptureResponse) => void) => {
      if (!message) return undefined;
      try {
        if (message.type === 'natively:extract') {
          sendResponse({ ok: true, result: runExtraction() });
          return undefined;
        }
        if (message.type === 'natively:smart-extract') {
          const smart = runSmartCapture(message);
          sendResponse({ ok: true, smart });
          return undefined;
        }
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
        return undefined;
      }
      return undefined;
    },
  );
}
