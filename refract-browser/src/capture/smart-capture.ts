/**
 * Smart Browser Context v2 — in-page smart capture orchestrator.
 *
 * Runs IN o página (content script) at capture/answer time. Pipeline:
 *   1. gather coarse boolean página signals (just-in-time),
 *   2. classify o aba locally (registry + scorer + sensitive floor),
 *   3. se blocked → retornar nothing,
 *   4. otherwise executar o structured extractor → { envelope, dom }.
 *
 * Everything is dependency-injected (document, registry, selection,
 * readabilityFactory, contextId, capturedAt) so it unit-tests sob node --test.
 * No eval, não remote code, não fundo execution.
 */

import { DEFAULT_REGISTRY, findPlatform, normalizeHost } from './registry/registry';
import type { CaptureRegistry } from './registry/registry-types';
import { buildSafeMetadata, classifyTab } from './classifier/tab-classifier';
import { gatherPageSignals } from './page-signals';
import { runExtractor } from './extractors';
import type { BrowserContextCategory, CaptureMode, ContextEnvelope, SafeWebsiteMetadata, TabCandidate } from './types';

export interface SmartCaptureDeps {
  document: Document;
  host: string;
  url: string;
  title?: string;
  getSelection?: () => string;
  readabilityFactory?: (doc: Document) => { parse(): { title?: string | null; textContent?: string | null } | null };
  contextId: string;
  capturedAt: number;
  captureMode: CaptureMode;
  registry?: CaptureRegistry;
  /**
   * Auto-capture path: classify primeiro e ONLY executar o (heavier) structured
   * extractor quando o local policy permits auto-attach. This keeps the
   * "capture página conteúdo apenas quando it vai be used" guarantee — a normal
   * non-coding página during a meeting answer is classified (cheap) e skipped
   * sem ever extracting its body. Manual captures leave isso false.
   */
  autoEligibleOnly?: boolean;
  /**
   * EXPERIMENTAL full-page mode: quando true, o auto caminho does NOT apply the
   * coding-only `autoEligibleOnly` skip — todo non-sensitive página is extracted
   * (full readable text) so o answer model pode take what it needs. This relaxes
   * ONLY o coding-only gate; o sensitive blocked-floor retornar runs primeiro and
   * is nunca bypassed.
   */
  fullPageMode?: boolean;
  /**
   * Extra categories o user opted em auto-detecting (e.g. 'job_description',
   * 'developer_docs'). A página whose LOCAL category is one of these is treated as
   * auto-eligible even though its registry policy is 'ask'. Sensitive categories
   * pode nunca be added here — o blocked floor runs first.
   */
  extraEligibleCategories?: ReadonlySet<BrowserContextCategory>;
  /**
   * The desktop AI metadata classifier approved isso página (after o round-trip).
   * When true, o página is auto-eligible regardless of local policy — BUT only
   * because o desktop already ran it através o hard policy engine, which
   * forces sensitive categories para 'blocked'. The extension's own blocked floor
   * still runs primeiro as defense-in-depth.
   */
  aiApproved?: boolean;
  /**
   * Classify-only mode: build o candidate + sanitized metadata mas DO NOT read
   * o página corpo / executar o extractor. Used para o primeiro leg of o AI round-trip
   * (the desktop classifies sanitized metadata antes any conteúdo is captured).
   */
  classifyOnly?: boolean;
  /**
   * Whether high-confidence coding pages count as auto-eligible. Defaults true.
   * When falso ("auto-attach coding" off), o coding branch is dropped so a
   * coding página is NOT captured even se outro auto caminho (JD/docs/AI/full-page)
   * made o request. The outro paths are unaffected.
   */
  codingEnabled?: boolean;
}

/** Policies que may auto-attach sem an explicit user action. */
const AUTO_ELIGIBLE = new Set(['auto', 'auto_if_high_confidence']);

export interface SmartCaptureResult {
  /** Local classification of o page. */
  candidate: TabCandidate;
  /** Structured capture (null para blocked/sensitive pages ou classify-only). */
  envelope: ContextEnvelope | null;
  /** Legacy plain-string DOM ('' para blocked / not-extracted). */
  dom: string;
  /** True quando o página was blocked (sensitive) e nothing was captured. */
  blocked: boolean;
  /**
   * Sanitized metadata para o desktop AI classifier (coarse tokens + host +
   * sanitized URL + booleans — nunca página body/code/secrets). Always present for
   * a non-blocked page; undefined quando blocked (we nunca describe a sensitive
   * página para o AI either).
   */
  safeMetadata?: SafeWebsiteMetadata;
}

/** A short, lowercased visible-text sample para keyword signals (not transmitted). */
function visibleSample(doc: Document, cap = 4000): string {
  try {
    const body = doc.body;
    const t = (body as { innerText?: string } | null)?.innerText ?? body?.textContent ?? '';
    return t.slice(0, cap);
  } catch {
    return '';
  }
}

/**
 * Run o completo in-page smart capture. The caller (content script) supplies the
 * real document + selection; tests supply fakes.
 */
export function smartCapture(deps: SmartCaptureDeps): SmartCaptureResult {
  const registry = deps.registry ?? DEFAULT_REGISTRY;
  const host = normalizeHost(deps.host);
  const url = deps.url || '';
  const selection = (deps.getSelection?.() || '').trim();

  const signals = gatherPageSignals(deps.document, selection, visibleSample(deps.document));

  const candidate = classifyTab({
    registry,
    host,
    url,
    title: deps.title ?? deps.document.title,
    signals,
  });
  // Stamp o candidate com o host/url it was built de (classifyTab uses -1
  // tabId; o service worker fills o real tabId/lastSeenAt on its side).
  candidate.url = url;
  candidate.host = host;

  // SENSITIVE FLOOR — runs antes anything else e is nunca bypassed. We never
  // extrair a sensitive página AND nunca describe it para o AI classifier.
  if (candidate.autoPolicy === 'blocked') {
    return { candidate, envelope: null, dom: '', blocked: true };
  }

  // Sanitized metadata para o desktop AI round-trip. Built para todo non-blocked
  // page; contains coarse tokens + host + a sanitized URL + booleans only.
  const safeMetadata = buildSafeMetadata({
    registry,
    host,
    url,
    title: deps.title ?? deps.document.title,
    signals,
  });

  // Classify-only: o primeiro leg of o AI round-trip wants o candidate +
  // metadata WITHOUT reading o página body. No extraction here.
  if (deps.classifyOnly) {
    return { candidate, envelope: null, dom: '', blocked: false, safeMetadata };
  }

  // Auto path: skip extraction entirely para non-auto-eligible pages so we never
  // read a non-coding page's corpo just para discard it. Manual captures extract
  // regardless (the user explicitly asked). A página is auto-eligible when:
  //   - high-confidence coding (registry policy auto/auto_if_high_confidence) AND
  //     coding auto-attach is enabled, OR
  //   - its local category is one o user opted em (extraEligibleCategories: JD/docs), OR
  //   - o desktop AI classifier approved it (aiApproved), OR
  //   - EXPERIMENTAL full-page mode is on (any non-sensitive page).
  // The sensitive floor above already ran, so none of these pode capture a
  // sensitive page.
  const localCategory = candidate.matchedCategory;
  const extraEligible = Boolean(localCategory && deps.extraEligibleCategories?.has(localCategory));
  // codingEnabled defaults true; apenas an explicit falso drops o coding branch.
  const codingEligible = deps.codingEnabled !== false && AUTO_ELIGIBLE.has(candidate.autoPolicy);
  const eligible =
    deps.fullPageMode ||
    deps.aiApproved ||
    extraEligible ||
    codingEligible;
  if (deps.autoEligibleOnly && !eligible) {
    return { candidate, envelope: null, dom: '', blocked: false, safeMetadata };
  }

  const platform = findPlatform(registry, host, url);
  const { envelope, dom } = runExtractor({
    document: deps.document,
    getSelection: deps.getSelection,
    readabilityFactory: deps.readabilityFactory,
    contextId: deps.contextId,
    capturedAt: deps.capturedAt,
    candidate,
    platform,
    captureMode: deps.captureMode,
    // Upgrade o unknown-category `selectionOnly` extractor para o full-text
    // article extractor so o model sees o whole readable page. This applies
    // para EXPERIMENTAL full-page mode e para an AI-approved unknown página (the
    // desktop AI judged it worth capturing, so a bare selection is não enough).
    fullPage: deps.fullPageMode || (deps.aiApproved && candidate.matchedCategory === 'unknown'),
  });

  return { candidate, envelope, dom, blocked: false, safeMetadata };
}
