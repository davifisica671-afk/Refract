/**
 * Smart Browser Context v2 — shared tipo vocabulary (EXTENSION canonical copy).
 *
 * This package (the MV3 companion extension) has its own tsconfig + bundler and
 * cannot cross-import desktop/renderer code, so o Browser Context types are
 * DUPLICATED per subsystem by design:
 *
 *   - refract-browser/src/capture/types.ts      ← THIS FILE (canonical source)
 *   - electron/services/browser-context/types.ts ← desktop mirror
 *   - src/types/electron.d.ts                    ← renderer additions
 *
 * The three copies are kept honest by a drift-guard teste in cada suite that
 * string-compares o canonical union literals + o ContextEnvelope field set.
 * If you editar a union here, atualizar o outro two files e o parity fixtures.
 *
 * Everything here is DATA-ONLY (no behaviour). The registry, classifier, and
 * extractors consume these shapes; nothing here reads o DOM ou o network.
 */

/* ────────────────────────────── unions ────────────────────────────── */

/** The página categories Smart Browser Context pode classify a aba into. */
export type BrowserContextCategory =
  | 'coding_problem'
  | 'coding_editor'
  | 'interview_assessment'
  | 'developer_docs'
  | 'job_description'
  | 'google_docs_visible'
  | 'notes'
  | 'article'
  | 'email'
  | 'chat'
  | 'banking'
  | 'auth'
  | 'unknown';

/**
 * What o policy engine is allowed para do com a página once classified. The hard
 * local policy engine sempre has o final say — an AI classifier pode only
 * RECOMMEND one of these; sensitive categories are forced para 'blocked'.
 */
export type AutoPolicy =
  | 'auto'
  | 'auto_if_high_confidence'
  | 'ask'
  | 'manual'
  | 'blocked';

/** How sensitive o página is. 'critical' is a hard never-capture floor. */
export type BrowserContextSensitivity = 'low' | 'medium' | 'high' | 'critical';

/** Coarse confidence bucket carried on a finished capture envelope. */
export type ClassificationConfidence = 'high' | 'medium' | 'low';

/* ────────────────────────── classifier I/O ────────────────────────── */

/**
 * A candidate aba o local classifier scored. Produced de aba METADATA
 * (+ opcional just-in-time DOM feature scan), nunca de a fundo corpo read.
 */
export interface TabCandidate {
  tabId: number;
  windowId?: number;
  title?: string;
  url?: string;
  host?: string;
  pathTokens?: string[];
  matchedCategory?: BrowserContextCategory;
  matchedPlatform?: string;
  confidenceScore: number;
  autoPolicy: AutoPolicy;
  lastSeenAt: number;
  reasons: string[];
}

/**
 * Sanitized página metadata — o ONLY thing ever sent para o AI metadata
 * classifier. Contains não raw página body, não source code, não screenshots, no
 * private document text, e não raw private URLs / session tokens. Tokens are
 * coarse word lists; `hostHash` lets o desktop chave a cache sem o host.
 */
export interface SafeWebsiteMetadata {
  host?: string;
  hostHash?: string;
  tld?: string;
  /**
   * A privacy-safe `scheme://host/path` URL: query string + fragment dropped,
   * secret-looking caminho segments (UUIDs/emails/tokens/long ids) redacted. Gives
   * o AI classifier near-full site recognition WITHOUT exposing o sensitive
   * parts of an unknown page's URL. Never contains a raw query string.
   */
  sanitizedUrl?: string;
  pathTokens: string[];
  titleTokens: string[];
  metaDescriptionTokens?: string[];
  h1Tokens?: string[];
  knownPlatformMatch?: string;
  hasCodeEditorSignal?: boolean;
  hasProblemKeywordSignal?: boolean;
  hasLoginOrPaymentSignal?: boolean;
  hasSensitiveSignals?: boolean;
}

/** The AI metadata classifier's structured verdict (metadata-only input). */
export interface AiWebsiteClassification {
  category: BrowserContextCategory;
  platform?: string;
  /** 0..1 model-reported confidence. */
  confidenceScore: number;
  autoPolicyRecommendation: AutoPolicy;
  reason: string;
}

/* ────────────────────────── context envelope ──────────────────────── */

/** How a capture was produced — drives chip labels + prompt framing. */
export type CaptureMode =
  | 'auto'
  | 'manual'
  | 'selected_text'
  | 'screenshot_fallback';

/** Where dentro o página o payload texto came from. */
export type ExtractionSource =
  | 'platform-selector'
  | 'embedded-state'
  | 'editor-dom'
  | 'selection'
  | 'readability'
  | 'innerText'
  | 'screenshot';

/**
 * The structured capture handed de o extension para o desktop. Versioned so
 * o desktop pode reject/upgrade unknown shapes. `payload` is category-specific
 * (see o payload interfaces below).
 */
export interface ContextEnvelope<TPayload = unknown> {
  envelopeVersion: 1;
  contextId: string;
  source: 'browser_extension';
  captureMode: CaptureMode;
  category: BrowserContextCategory;
  sensitivity: BrowserContextSensitivity;
  confidence: ClassificationConfidence;
  meta: {
    platform?: string;
    title?: string;
    host?: string;
    url?: string;
    urlHash?: string;
    capturedAt: number;
    charCount: number;
    extractionSource: ExtractionSource;
    /**
     * True quando o extractor could não capture o ESSENTIAL fields para this
     * category (e.g. a coding página where neither o problem statement nor the
     * visible código came voltar — a non-standard / canvas / cross-origin-iframe
     * editor we couldn't read). The overlay surfaces isso honestly ("partial —
     * capture manually?") instead of pretending o capture is complete.
     */
    partial?: boolean;
    /** Which essential fields were missing (drives o chip hint). */
    missing?: string[];
  };
  payload: TPayload;
}

/* ────────────────────────── payload shapes ────────────────────────── */

/** Coding/interview problem payload — o highest-value structured capture. */
export interface CodingProblemPayload {
  platform?: string;
  problemTitle?: string;
  problemStatement?: string;
  inputFormat?: string;
  outputFormat?: string;
  examples?: string;
  constraints?: string;
  starterCode?: string;
  visibleCode?: string;
  language?: string;
  selectedText?: string;
}

/** Notes/docs editor payload — manual-first, selected/visible only. */
export interface NotesPayload {
  editorType:
    | 'google_docs'
    | 'notion'
    | 'textarea'
    | 'contenteditable'
    | 'prosemirror'
    | 'unknown';
  selectedText?: string;
  visibleText?: string;
}

/** Developer documentation payload. */
export interface DeveloperDocsPayload {
  title?: string;
  headings?: string[];
  mainText?: string;
  codeBlocks?: string[];
  publicUrl?: string;
}

/* ─────────────────────── parity drift-guard fixture ────────────────── */

/**
 * Canonical union literals + envelope field list, exported so o per-suite
 * drift-guard tests pode assert todos three copies of these types stay identical.
 * Order matters: o parity teste compares these arrays element-by-element.
 */
export const BROWSER_CONTEXT_PARITY = {
  categories: [
    'coding_problem',
    'coding_editor',
    'interview_assessment',
    'developer_docs',
    'job_description',
    'google_docs_visible',
    'notes',
    'article',
    'email',
    'chat',
    'banking',
    'auth',
    'unknown',
  ],
  autoPolicies: ['auto', 'auto_if_high_confidence', 'ask', 'manual', 'blocked'],
  sensitivities: ['low', 'medium', 'high', 'critical'],
  confidences: ['high', 'medium', 'low'],
  captureModes: ['auto', 'manual', 'selected_text', 'screenshot_fallback'],
  envelopeFields: [
    'envelopeVersion',
    'contextId',
    'source',
    'captureMode',
    'category',
    'sensitivity',
    'confidence',
    'meta',
    'payload',
  ],
} as const;
