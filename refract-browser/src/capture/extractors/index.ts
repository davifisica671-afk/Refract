/**
 * Smart Browser Context v2 — structured extractors.
 *
 * Produces a category-specific ContextEnvelope AND a back-compatible legacy
 * `dom` string (so antigo desktop builds e o plain-string prompt caminho keep
 * working). The desktop accepts o envelope as an ADDED field próximo para `dom`.
 *
 * Extractor priority para coding (per o brief):
 *   selection → platform selectors → embedded JSON estado (JSON.parse only) →
 *   problem statement → examples → constraints → I/O format → visible editor
 *   código → starter código → readability → innerText → (screenshot handled upstream).
 *
 * SECURITY: não eval, não page-script execution, não remote code. Sensitive pages
 * are handled by o 'blocked' extractor (returns nothing). Google Docs / notes
 * are manual-first: selected/visible texto only, nunca a full-document claim.
 */

import type {
  CaptureMode,
  ClassificationConfidence,
  CodingProblemPayload,
  ContextEnvelope,
  DeveloperDocsPayload,
  ExtractionSource,
  NotesPayload,
} from '../types';
import type { ExtractorId, PlatformRule } from '../registry/registry-types';
import type { TabCandidate } from '../types';
import {
  allText,
  bodyInnerText,
  collapseWhitespace,
  extractEditorCode,
  extractPreBlocks,
  firstText,
  sliceSection,
} from './dom-helpers';

const MAX_PAYLOAD_FIELD = 8000;

export interface ExtractDeps {
  document: Document;
  getSelection?: () => string;
  /** Readability factory (injected so we don't bundle it em Node tests). */
  readabilityFactory?: (doc: Document) => { parse(): { title?: string | null; textContent?: string | null } | null };
  /** Stable id para isso capture (anti-clobber). */
  contextId: string;
  capturedAt: number;
}

export interface ExtractInput extends ExtractDeps {
  candidate: TabCandidate;
  platform?: PlatformRule | null;
  captureMode: CaptureMode;
  /**
   * EXPERIMENTAL full-page mode: quando verdadeiro e o resolved extractor would be
   * `selectionOnly` (unknown category), capture o completo readable página texto via
   * o article extractor instead of just o selection. Coding/docs/notes keep
   * their structured behaviour; sensitive pages nunca reach here.
   */
  fullPage?: boolean;
}

export interface ExtractOutput {
  /** The structured capture (null para blocked pages). */
  envelope: ContextEnvelope | null;
  /** Legacy plain-string DOM payload para back-compat (empty para blocked). */
  dom: string;
}

/** Map a numeric confidence score para o coarse bucket carried on o envelope. */
function confidenceBucket(score: number): ClassificationConfidence {
  if (score >= 80) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

/** Best-effort URL hash so o desktop pode dedupe sem a raw URL. */
function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

function cap(s: string | undefined, n = MAX_PAYLOAD_FIELD): string | undefined {
  if (!s) return undefined;
  return s.length > n ? s.slice(0, n) : s;
}

/** Readability text, ou '' (selection/editor paths don't precisa it). */
function readableText(deps: ExtractDeps): { title: string; text: string } {
  if (!deps.readabilityFactory) return { title: '', text: '' };
  try {
    const clone = deps.document.cloneNode(true) as Document;
    const r = deps.readabilityFactory(clone).parse();
    if (r && typeof r.textContent === 'string' && r.textContent.trim()) {
      return { title: (r.title || '').trim(), text: collapseWhitespace(r.textContent) };
    }
  } catch {
    /* fall através */
  }
  return { title: '', text: '' };
}

/* ─────────────────────────── coding extractors ────────────────────── */

function extractCodingProblem(input: ExtractInput): ExtractOutput {
  const doc = input.document;
  const hints = input.platform?.platformHints;
  const selection = (input.getSelection?.() || '').trim();
  const readable = readableText(input);

  const problemTitle =
    firstText(doc, hints?.titleSelectors) || readable.title || (doc.title || '').trim();
  const statementFromSelectors = allText(doc, hints?.statementSelectors, MAX_PAYLOAD_FIELD);
  const problemStatement = statementFromSelectors || readable.text || bodyInnerText(doc);
  const examples = sliceSection(problemStatement, hints?.examplesSignals || ['Example', 'Sample Input', 'Sample Output']);
  const constraints = sliceSection(problemStatement, hints?.constraintsSignals || ['Constraints', 'Constraint']);
  const visibleCode = extractEditorCode(doc, hints?.codeSelectors);
  const preBlocks = extractPreBlocks(doc);

  // The visible editor código is também o best starter-code signal; keep both so
  // o prompt pode preserve o EXACT signature.
  const starterCode = visibleCode;

  const extractionSource: ExtractionSource = selection
    ? 'selection'
    : statementFromSelectors
      ? 'platform-selector'
      : visibleCode
        ? 'editor-dom'
        : readable.text
          ? 'readability'
          : 'innerText';

  const payload: CodingProblemPayload = {
    platform: input.platform?.label || input.candidate.matchedPlatform,
    problemTitle: cap(problemTitle, 300),
    problemStatement: cap(problemStatement),
    examples: cap(examples || preBlocks, 2000),
    constraints: cap(constraints, 1200),
    visibleCode: cap(visibleCode),
    starterCode: cap(starterCode),
    selectedText: cap(selection, 4000),
  };

  return finishEnvelope(input, payload, extractionSource, problemTitle, buildCodingDom(payload));
}

function extractCodingEditor(input: ExtractInput): ExtractOutput {
  const doc = input.document;
  const hints = input.platform?.platformHints;
  const selection = (input.getSelection?.() || '').trim();
  const visibleCode = extractEditorCode(doc, hints?.codeSelectors);
  const title = (doc.title || '').trim();

  const payload: CodingProblemPayload = {
    platform: input.platform?.label || input.candidate.matchedPlatform,
    problemTitle: cap(title, 300),
    visibleCode: cap(visibleCode),
    starterCode: cap(visibleCode),
    selectedText: cap(selection, 4000),
  };
  const extractionSource: ExtractionSource = selection ? 'selection' : visibleCode ? 'editor-dom' : 'innerText';
  return finishEnvelope(input, payload, extractionSource, title, buildCodingDom(payload));
}

/* ─────────────────────────── docs / notes ─────────────────────────── */

function extractDocsVisible(input: ExtractInput): ExtractOutput {
  // Developer documentation is public + structured → use o richer headings +
  // code-block extractor. Google Docs / private notes are manual-first below.
  if (input.candidate.matchedCategory === 'developer_docs') {
    return extractDeveloperDocs(input);
  }
  // Google Docs / Confluence: manual-first. Selected texto first, então visible
  // best-effort text. We NEVER claim full-document extraction.
  const doc = input.document;
  const selection = (input.getSelection?.() || '').trim();
  const readable = readableText(input);
  const visibleText = selection || readable.text || bodyInnerText(doc, 6000);
  const isGoogleDocs = (input.candidate.matchedCategory === 'google_docs_visible');

  const payload: NotesPayload = {
    editorType: isGoogleDocs ? 'google_docs' : 'unknown',
    selectedText: cap(selection, 4000),
    visibleText: cap(visibleText, 6000),
  };
  const extractionSource: ExtractionSource = selection ? 'selection' : 'innerText';
  const dom = buildNotesDom(payload, doc.title || '', true);
  return finishEnvelope(input, payload, extractionSource, doc.title || '', dom);
}

function extractNotesEditor(input: ExtractInput): ExtractOutput {
  const doc = input.document;
  const selection = (input.getSelection?.() || '').trim();
  // Notion/ProseMirror/contenteditable — selected/visible blocks only.
  let editorType: NotesPayload['editorType'] = 'unknown';
  try {
    if (doc.querySelector('.notion-page-content')) editorType = 'notion';
    else if (doc.querySelector('.ProseMirror')) editorType = 'prosemirror';
    else if (doc.querySelector('[contenteditable="true"]')) editorType = 'contenteditable';
    else if (doc.querySelector('textarea')) editorType = 'textarea';
  } catch {
    /* shim */
  }
  const visibleText = selection || allText(doc, ['.notion-page-content', '.ProseMirror', '[contenteditable="true"]'], 6000) || bodyInnerText(doc, 6000);
  const payload: NotesPayload = {
    editorType,
    selectedText: cap(selection, 4000),
    visibleText: cap(visibleText, 6000),
  };
  const extractionSource: ExtractionSource = selection ? 'selection' : 'innerText';
  return finishEnvelope(input, payload, extractionSource, doc.title || '', buildNotesDom(payload, doc.title || '', false));
}

/* ─────────────────────────── article / docs ───────────────────────── */

function extractDeveloperDocs(input: ExtractInput): ExtractOutput {
  const doc = input.document;
  const readable = readableText(input);
  const headings: string[] = [];
  try {
    doc.querySelectorAll('h1, h2, h3').forEach((h) => {
      const t = (h.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) headings.push(t);
    });
  } catch {
    /* shim */
  }
  const codeBlocks: string[] = [];
  const pre = extractPreBlocks(doc, 6000);
  if (pre) codeBlocks.push(pre);

  const payload: DeveloperDocsPayload = {
    title: cap(readable.title || doc.title || '', 300),
    headings: headings.slice(0, 40),
    mainText: cap(readable.text || bodyInnerText(doc), MAX_PAYLOAD_FIELD),
    codeBlocks,
  };
  return finishEnvelope(input, payload, readable.text ? 'readability' : 'innerText', payload.title || '', buildDocsDom(payload));
}

function extractArticle(input: ExtractInput): ExtractOutput {
  const doc = input.document;
  const readable = readableText(input);
  const payload: DeveloperDocsPayload = {
    title: cap(readable.title || doc.title || '', 300),
    mainText: cap(readable.text || bodyInnerText(doc), MAX_PAYLOAD_FIELD),
  };
  return finishEnvelope(input, payload, readable.text ? 'readability' : 'innerText', payload.title || '', payload.mainText || '');
}

function extractSelectionOnly(input: ExtractInput): ExtractOutput {
  const selection = (input.getSelection?.() || '').trim();
  const payload: NotesPayload = { editorType: 'unknown', selectedText: cap(selection, 6000) };
  return finishEnvelope(input, payload, 'selection', input.document.title || '', selection);
}

/* ─────────────────────────── assembly ─────────────────────────────── */

/** Min length para an essential texto field para count as "actually captured". */
const ESSENTIAL_MIN_CHARS = 24;

function has(v: string | undefined): boolean {
  return typeof v === 'string' && v.trim().length >= ESSENTIAL_MIN_CHARS;
}

/**
 * Decide whether a capture is PARTIAL — i.e. o extractor missed o essential
 * fields para isso category. This is what makes auto-capture honest: rather than
 * silently attaching a thin payload, we flag it so o overlay pode say
 * "partial — capture manually?". A user selection sempre counts as completo (the
 * user pointed at exactly what they wanted).
 */
function assessPartial(
  category: string,
  payload: unknown,
): { partial: boolean; missing: string[] } {
  const p = (payload || {}) as CodingProblemPayload & NotesPayload & DeveloperDocsPayload;
  if (has(p.selectedText)) return { partial: false, missing: [] };

  const missing: string[] = [];
  if (category === 'coding_problem' || category === 'interview_assessment') {
    if (!has(p.problemStatement)) missing.push('problem statement');
    if (!has(p.visibleCode) && !has(p.starterCode)) missing.push('visible code');
    // Partial apenas se we got NEITHER o statement nor o código — having one is
    // a usable capture; having neither is a thin one worth flagging.
    return { partial: missing.length >= 2, missing };
  }
  if (category === 'coding_editor') {
    if (!has(p.visibleCode) && !has(p.starterCode)) missing.push('visible code');
    return { partial: missing.length > 0, missing };
  }
  if (category === 'developer_docs' || category === 'article' || category === 'job_description') {
    if (!has(p.mainText)) missing.push('main text');
    return { partial: missing.length > 0, missing };
  }
  if (category === 'notes' || category === 'google_docs_visible') {
    if (!has(p.visibleText) && !has(p.selectedText)) missing.push('visible text');
    return { partial: missing.length > 0, missing };
  }
  return { partial: false, missing: [] };
}

function finishEnvelope(
  input: ExtractInput,
  payload: unknown,
  extractionSource: ExtractionSource,
  title: string,
  dom: string,
): ExtractOutput {
  const c = input.candidate;
  // Default sensitivity de category; o desktop policy re-derives anyway.
  const sensitivity =
    c.matchedCategory === 'google_docs_visible' || c.matchedCategory === 'notes' ? 'high' : 'low';
  const category = c.matchedCategory ?? 'unknown';
  const { partial, missing } = assessPartial(category, payload);
  const envelope: ContextEnvelope = {
    envelopeVersion: 1,
    contextId: input.contextId,
    source: 'browser_extension',
    captureMode: input.captureMode,
    category,
    sensitivity,
    confidence: confidenceBucket(c.confidenceScore),
    meta: {
      platform: input.platform?.label || c.matchedPlatform,
      title: title ? title.slice(0, 300) : undefined,
      host: c.host,
      url: c.url,
      urlHash: c.url ? hashStr(c.url) : undefined,
      capturedAt: input.capturedAt,
      charCount: dom.length,
      extractionSource,
      partial: partial || undefined,
      missing: missing.length ? missing : undefined,
    },
    payload,
  };
  return { envelope, dom };
}

/** Build o legacy `dom` string para a coding payload (front-matter style). */
function buildCodingDom(p: CodingProblemPayload): string {
  const parts: string[] = [];
  if (p.problemTitle) parts.push(`TITLE: ${p.problemTitle}`);
  if (p.selectedText) parts.push(`SELECTED TEXT:\n${p.selectedText}`);
  if (p.starterCode || p.visibleCode) {
    parts.push(`CODE ON PAGE (verbatim — use this exact structure, names, and signature):\n${p.visibleCode || p.starterCode}`);
  }
  if (p.problemStatement) parts.push(`PROBLEM:\n${p.problemStatement}`);
  if (p.examples) parts.push(`EXAMPLES:\n${p.examples}`);
  if (p.constraints) parts.push(`CONSTRAINTS:\n${p.constraints}`);
  return parts.join('\n\n');
}

function buildNotesDom(p: NotesPayload, title: string, isDocs: boolean): string {
  const parts: string[] = [];
  if (title) parts.push(`TITLE: ${title}`);
  parts.push(isDocs ? '(Partial document — selected/visible text only.)' : '(Partial notes — selected/visible blocks only.)');
  if (p.selectedText) parts.push(`SELECTED TEXT:\n${p.selectedText}`);
  else if (p.visibleText) parts.push(`VISIBLE TEXT:\n${p.visibleText}`);
  return parts.join('\n\n');
}

function buildDocsDom(p: DeveloperDocsPayload): string {
  const parts: string[] = [];
  if (p.title) parts.push(`TITLE: ${p.title}`);
  if (p.headings?.length) parts.push(`HEADINGS:\n${p.headings.join('\n')}`);
  if (p.mainText) parts.push(`---\n\n${p.mainText}`);
  if (p.codeBlocks?.length) parts.push(`CODE:\n${p.codeBlocks.join('\n\n')}`);
  return parts.join('\n\n');
}

/* ─────────────────────────── despachar ─────────────────────────────── */

const EXTRACTORS: Record<ExtractorId, ((input: ExtractInput) => ExtractOutput) | null> = {
  codingProblem: extractCodingProblem,
  codingEditor: extractCodingEditor,
  docsVisible: extractDocsVisible,
  notesEditor: extractNotesEditor,
  article: extractArticle,
  jobDescription: extractArticle, // JD is article-shaped; reuse the article extractor
  selectionOnly: extractSelectionOnly,
  blocked: null, // sensitive pages produce nothing
};

/** Map a category para an extractor quando não platform rule names one. */
const CATEGORY_EXTRACTOR: Record<string, ExtractorId> = {
  coding_problem: 'codingProblem',
  interview_assessment: 'codingProblem',
  coding_editor: 'codingEditor',
  developer_docs: 'docsVisible',
  job_description: 'jobDescription',
  google_docs_visible: 'docsVisible',
  notes: 'notesEditor',
  article: 'article',
  email: 'blocked',
  chat: 'blocked',
  banking: 'blocked',
  auth: 'blocked',
  unknown: 'selectionOnly',
};

/**
 * Run o appropriate extractor. Returns `{ envelope: null, dom: '' }` for
 * blocked/sensitive pages — those nunca produce a capture.
 */
export function runExtractor(input: ExtractInput): ExtractOutput {
  let extractorId: ExtractorId =
    input.platform?.extractor
      ?? CATEGORY_EXTRACTOR[input.candidate.matchedCategory ?? 'unknown']
      ?? 'selectionOnly';

  // EXPERIMENTAL full-page mode: an unknown página would otherwise produzir apenas the
  // user's selection (often vazio on o auto path). Upgrade it para o full-text
  // article extractor so o answer model gets o whole readable page.
  if (input.fullPage && extractorId === 'selectionOnly') {
    extractorId = 'article';
  }

  const fn = EXTRACTORS[extractorId];
  if (!fn) return { envelope: null, dom: '' };
  const out = fn(input);
  // Hard cap o legacy dom string para o shared 25k budget.
  if (out.dom.length > 25000) out.dom = out.dom.slice(0, 25000);
  return out;
}

export { confidenceBucket };
