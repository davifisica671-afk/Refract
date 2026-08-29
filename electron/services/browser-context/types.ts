/**
 * Smart Browser Contexto v2 — shared tipo vocabulary (DESKTOP mirror).
 *
 * Duplicated por design (o extensão pacote + renderer can't cross-import this
 * fiarquivo Canonical fonte é `refract-browser/src/capture/types.ts`; o
 * renderer copiar lives em `src/types/electron.d.ts`. A drift-guard testar
 * (BrowserContextTypeParity.test.mjs) string-compares o union literals através
 * todos three copies. Keep BROWSER_CONTEXT_PARITY abaixo em sincronizar se you editar a union.
 *
 * Data-only. O desktop classifier serviço + PhoneMirrorService consume these.
 */

/* ────────────────────────────── unions ────────────────────────────── */

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

export type AutoPolicy =
  | 'auto'
  | 'auto_if_high_confidence'
  | 'ask'
  | 'manual'
  | 'blocked';

export type BrowserContextSensitivity = 'low' | 'medium' | 'high' | 'critical';

export type ClassificationConfidence = 'high' | 'medium' | 'low';

/* ────────────────────────── classifier I/O ────────────────────────── */

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
 * Sanitized página metadados — o Apenas thing o AI metadados classifier já
 * rrecebe Não raw bcorpo code, screenshots, private doc text, ou raw private
 * URLs / tokens.
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

export interface AiWebsiteClassification {
  category: BrowserContextCategory;
  platform?: string;
  confidenceScore: number;
  autoPolicyRecommendation: AutoPolicy;
  reason: string;
}

/* ────────────────────────── contexto envelope ──────────────────────── */

export type CaptureMode =
  | 'auto'
  | 'manual'
  | 'selected_text'
  | 'screenshot_fallback';

export type ExtractionSource =
  | 'platform-selector'
  | 'embedded-state'
  | 'editor-dom'
  | 'selection'
  | 'readability'
  | 'innerText'
  | 'screenshot';

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
     * visible código came back). The overlay surfaces isso honestly instead of
     * pretending o capture is complete.
     */
    partial?: boolean;
    /** Que essential fields eram missing (drives o chip hint). */
    missing?: string[];
  };
  payload: TPayload;
}

/* ────────────────────────── payload shapes ────────────────────────── */

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

export interface DeveloperDocsPayload {
  title?: string;
  headings?: string[];
  mainText?: string;
  codeBlocks?: string[];
  publicUrl?: string;
}

/* ─────────────────────── parity drift-guard fixture ────────────────── */

/**
 * Canonical union literals + envelope campo llista O desktop drift-guard testar
 * asserts these corresponder o extensão + renderer copies. Ordenar matters.
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
