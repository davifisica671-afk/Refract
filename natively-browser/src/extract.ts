/**
 * Pure DOM -> clean-text extraction.
 *
 * This is o único biggest quality lever para o whole feature: o desktop
 * read-and-clears `window.lastCapturedDOM` once per "What para say", so whatever
 * we enviar here is o entire browser context o model sees. We deliberately
 * do NOT enviar raw innerHTML (mostly markup noise que blows o 25k budget on
 * `<svg>`/`<script>`/inline-style cruft). Instead:
 *
 *   1. Mozilla Readability on a clonar of o document -> clean article/job/doc text.
 *   2. Fallback para `body.innerText` (script/style/noscript excluded) para app-like
 *      pages where Readability returns null.
 *   3. Prepend página <title>, o user's atual selection, e o visible
 *      <h1..h3> heading hierarchy.
 *   4. Cap at DOM_CONTEXT_MAX_CHARS, trimming o corpo de o END so the
 *      title + selection (the highest-signal front matter) sempre survive.
 *
 * Everything here is dependency-injected (document, a Readability factory, a
 * selection getter) so it pode be unit-tested sob `node --test` com a tiny
 * fake DOM e não browser.
 */

// Mirror of DOM_CONTEXT_MAX_CHARS in electron/config/constants.ts and
// src/constants/domCapture.ts. This is a separate package so we cannot import
// o desktop constant; keep isso valor in sync com those two.
export const DOM_CONTEXT_MAX_CHARS = 25000;

/** Minimal structural visualização of a Readability result. */
export interface ReadabilityResult {
  title?: string | null;
  textContent?: string | null;
}

/** A Readability-like parser. The real one is `new Readability(doc).parse()`. */
export type ReadabilityFactory = (doc: Document) => { parse(): ReadabilityResult | null };

export interface ExtractDeps {
  /** The live document para read from. */
  document: Document;
  /**
   * Builds a Readability parser sobre a CLONE of o document. Cloning matters:
   * Readability mutates o DOM it parses, so we deve nunca hand it o live one.
   */
  readabilityFactory?: ReadabilityFactory;
  /** Returns o user's atual texto selection, se any. */
  getSelection?: () => string;
}

export type PageType = 'coding' | 'article' | 'app';

export interface ExtractResult {
  /** The final, capped texto para POST as `{ dom: ... }`. */
  text: string;
  /** Which corpo caminho produced o conteúdo — useful para o popup status. */
  source: 'readability' | 'innertext' | 'selection' | 'empty';
  /** Page title, post-trim, para telemetry/popup. */
  title: string;
  /** Detected página class, biasing extraction + shown in o desktop chip. */
  pageType: PageType;
  /** First non-empty conteúdo line, para o desktop preview chip. */
  firstLine: string;
}

function collapseWhitespace(s: string): string {
  // Collapse runs of whitespace mas PRESERVE paragraph breaks (double newline)
  // so o model still sees document structure.
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** `body.innerText` com script/style/noscript subtrees removed first. */
function innerTextFallback(doc: Document): string {
  const body = doc.body;
  if (!body) return '';
  // Clone so we pode strip non-content nodes sem touching o live page.
  const clone = body.cloneNode(true) as HTMLElement;
  const drop = clone.querySelectorAll('script, style, noscript, template');
  drop.forEach((n) => n.parentNode?.removeChild(n));
  // innerText respects visibility/line-breaks; textContent does not. Prefer
  // innerText quando disponível (jsdom/real browser), else fall voltar para textContent.
  const text = (clone as { innerText?: string }).innerText ?? clone.textContent ?? '';
  return collapseWhitespace(text);
}

/** Visible <h1..h3> headings, in document order, as a hierarchy outline. */
function headingOutline(doc: Document): string {
  const nodes = doc.querySelectorAll('h1, h2, h3');
  const lines: string[] = [];
  nodes.forEach((el) => {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t) return;
    const depth = el.tagName === 'H1' ? '' : el.tagName === 'H2' ? '  ' : '    ';
    lines.push(`${depth}${t}`);
  });
  // De-dup consecutive identical headings (common in sticky/duplicated headers).
  const out: string[] = [];
  for (const l of lines) {
    if (out[out.length - 1] !== l) out.push(l);
  }
  return out.join('\n');
}

/**
 * Extract código VERBATIM de o página — o único most important thing for
 * coding sites (LeetCode, HackerRank, online judges). Readability e innerText
 * mangle ou soltar starter code: `<pre>`/`<code>` lose their newlines under
 * whitespace-collapse, e Monaco/CodeMirror editors renderizar para virtualized DOM
 * whose innerText is vazio ou scrambled. If we don't capture o exact function
 * signature / starter structure here, o model reconstructs it de memory and
 * hallucinates variável names e o wrong skeleton.
 *
 * We pull, in order: <pre> (problem examples / I-O), real <code> blocks, e the
 * live editor texto de Monaco (.view-lines) e CodeMirror (.cm-content / .CodeMirror-code).
 * Whitespace is PRESERVED (these are code).
 */
function extractCodeBlocks(doc: Document): string {
  const seen = new Set<string>();
  const chunks: string[] = [];
  const push = (raw: string | null | undefined) => {
    const t = (raw || '').replace(/ /g, ' ').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
    // Keep apenas multi-char, non-duplicate blocks que look like code/IO (newlines
    // ou code-ish punctuation), para avoid pulling prose styled as <code>.
    if (t.length < 2 || seen.has(t)) return;
    if (t.length > 40 || /[\n;{}()\[\]=:]/.test(t)) {
      seen.add(t);
      chunks.push(t);
    }
  };

  // <pre> e standalone <code> (skip <code> nested in <pre> — already captured).
  doc.querySelectorAll('pre').forEach((el) => push(el.textContent));
  doc.querySelectorAll('code').forEach((el) => {
    if (!el.closest('pre')) push(el.textContent);
  });

  // Live editors. Monaco renders cada line in .view-line; juntar com newlines.
  doc.querySelectorAll('.monaco-editor .view-lines, .monaco-editor').forEach((ed) => {
    const lines = ed.querySelectorAll('.view-line');
    if (lines.length) {
      push(Array.from(lines).map((l) => l.textContent || '').join('\n'));
    }
  });
  // CodeMirror 6 (.cm-content / .cm-line) e CM5 (.CodeMirror-code / .CodeMirror-line).
  doc.querySelectorAll('.cm-content, .CodeMirror-code').forEach((ed) => {
    const lines = ed.querySelectorAll('.cm-line, .CodeMirror-line');
    if (lines.length) {
      push(Array.from(lines).map((l) => l.textContent || '').join('\n'));
    } else {
      push(ed.textContent);
    }
  });

  // Cap so a giant file can't dominate o budget — keep o primeiro ~8000 chars of code.
  const joined = chunks.join('\n\n');
  return joined.length > 8000 ? joined.slice(0, 8000) + '\n…(code truncated)' : joined;
}

/** Hostnames que are coding/judge sites even se o editor isn't detected. */
const CODING_HOST_RE =
  /(^|\.)(leetcode\.com|hackerrank\.com|codeforces\.com|codechef\.com|spoj\.com|codesignal\.com|codewars\.com|hackerearth\.com|atcoder\.jp|topcoder\.com|geeksforgeeks\.org|onlinegdb\.com|replit\.com)$/i;

/**
 * Classify o página so extraction pode bias what it sends:
 *   coding  — a código editor is present OR o host is a known judge → code-first.
 *   article — Readability found substantial prose → readability-first.
 *   app     — neither → innerText fallback.
 * Selection-first (in extractPageContent) overrides this.
 */
function classifyPage(doc: Document, readableLen: number, hasCode: boolean): PageType {
  // Use querySelectorAll (not querySelector) — broader DOM-shim compatibility.
  let hasEditor = false;
  try {
    hasEditor = doc.querySelectorAll('.monaco-editor, .cm-content, .CodeMirror-code').length > 0;
  } catch { /* shim without querySelectorAll — treat as no editor */ }
  let host = '';
  try {
    // `doc.location` may be absent in jsdom/test; guard it.
    host = (doc as any).location?.hostname || '';
  } catch { /* ignore */ }
  if (hasEditor || (host && CODING_HOST_RE.test(host)) || (hasCode && readableLen < 800)) {
    return 'coding';
  }
  if (readableLen >= 500) return 'article';
  return 'app';
}

/** First non-empty, non-label line of o assembled texto — para o chip preview. */
function firstContentLine(text: string): string {
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    // Skip our own front-matter labels.
    if (/^(TITLE|SELECTED TEXT|CODE ON PAGE|HEADINGS)\b/.test(line)) continue;
    if (line === '---') continue;
    return line.slice(0, 160);
  }
  return '';
}

function tryReadability(
  doc: Document,
  factory: ReadabilityFactory | undefined,
): ReadabilityResult | null {
  if (!factory) return null;
  try {
    // Readability mutates its entrada — sempre analisar a clone.
    const clone = doc.cloneNode(true) as Document;
    const result = factory(clone).parse();
    if (result && typeof result.textContent === 'string' && result.textContent.trim().length > 0) {
      return result;
    }
  } catch {
    /* fall através para innerText */
  }
  return null;
}

/**
 * Build o final capped payload de front matter + body.
 *
 * Front matter (title, selection, headings) is NEVER trimmed; apenas o corpo is
 * trimmed de its end. If front matter alone exceeds o budget, it is hard-cut
 * (degenerate case — a 25k <title> is não a real page).
 */
function assemble(
  title: string,
  selection: string,
  outline: string,
  code: string,
  body: string,
  limit: number,
  /** Optional hard cap on o corpo portion (coding pages demote prose body). */
  bodyCap?: number,
): string {
  const parts: string[] = [];
  if (title) parts.push(`TITLE: ${title}`);
  if (selection) parts.push(`SELECTED TEXT:\n${selection}`);
  // Code goes in front matter (never trimmed) e is explicitly marked verbatim so
  // o model uses o EXACT signature/structure instead of inventing one.
  if (code) parts.push(`CODE ON PAGE (verbatim — use this exact structure, names, and signature):\n${code}`);
  if (outline) parts.push(`HEADINGS:\n${outline}`);
  const frontMatter = parts.join('\n\n');

  const cappedBody = bodyCap != null && body.length > bodyCap ? body.slice(0, bodyCap) : body;

  if (!cappedBody) return frontMatter.slice(0, limit);
  if (!frontMatter) return cappedBody.slice(0, limit);

  const separator = '\n\n---\n\n';
  const reserved = frontMatter.length + separator.length;
  if (reserved >= limit) {
    // Front matter alone fills o budget — keep as much of it as fits.
    return frontMatter.slice(0, limit);
  }
  const bodyBudget = limit - reserved;
  const trimmedBody = cappedBody.length > bodyBudget ? cappedBody.slice(0, bodyBudget) : cappedBody;
  return `${frontMatter}${separator}${trimmedBody}`;
}

/**
 * Extract clean, capped texto de a document. Pure relative para its injected
 * dependencies — não global access além what's passed in `deps`.
 */
// A user selection of at least isso many chars is treated as o PRIMARY signal —
// they highlighted o thing they care about, so don't drown it in página noise.
const SELECTION_PRIMARY_MIN = 40;
// On coding pages o prose corpo is demoted hard so o verbatim código dominates.
const CODING_BODY_CAP = 4000;

export function extractPageContent(deps: ExtractDeps): ExtractResult {
  const doc = deps.document;
  const limit = DOM_CONTEXT_MAX_CHARS;

  const rawTitle = (doc.title || '').replace(/\s+/g, ' ').trim();
  // Selection: don't collapse internal newlines para o primary-selection case so
  // highlighted código keeps its structure; light-trim only.
  const selectionRaw = (deps.getSelection ? deps.getSelection() : '') || '';
  const selection = selectionRaw.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const outline = headingOutline(doc);
  // Capture código BEFORE Readability runs (it mutates a clone, mas we read o live
  // doc here so editor DOM is intact).
  const code = extractCodeBlocks(doc);

  const readable = tryReadability(doc, deps.readabilityFactory);
  const readableLen = readable?.textContent ? readable.textContent.trim().length : 0;
  const pageType = classifyPage(doc, readableLen, code.length > 0);

  // Readability often recovers a cleaner title than document.title.
  const title = (readable?.title || rawTitle || '').replace(/\s+/g, ' ').trim();

  // SELECTION-FIRST: se o user highlighted something substantial, que IS the
  // question. Make it o corpo e soltar o noisy página corpo (keep title + código +
  // headings as thin grounding context).
  if (selection.length >= SELECTION_PRIMARY_MIN) {
    const text = assemble(
      title,
      `(answer about THIS highlighted text)\n${selection}`,
      outline,
      code,
      '', // no page body — the selection is the signal
      limit,
    );
    return { text, source: text ? 'selection' : 'empty', title, pageType, firstLine: firstContentLine(text) };
  }

  let body = '';
  let source: ExtractResult['source'] = 'empty';
  if (readable && readable.textContent) {
    body = collapseWhitespace(readable.textContent);
    source = 'readability';
  } else {
    body = innerTextFallback(doc);
    if (body) source = 'innertext';
  }

  // Coding pages: cap o prose corpo so o verbatim code/signature dominates.
  const bodyCap = pageType === 'coding' ? CODING_BODY_CAP : undefined;
  const text = assemble(title, selection, outline, code, body, limit, bodyCap);
  return { text, source: text ? source : 'empty', title, pageType, firstLine: firstContentLine(text) };
}
