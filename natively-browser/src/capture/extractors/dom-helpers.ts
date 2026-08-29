/**
 * Smart Browser Context v2 — shared pure DOM helpers para o extractors.
 *
 * Self-contained (does não importar o gold extract.ts, so que file stays
 * byte-identical). All helpers are dependency-injected on a Document e never
 * touch globals, so they unit-test sob `node --test` com a tiny fake DOM.
 *
 * SECURITY: não eval, não Function, não execution of page-provided script. Embedded
 * JSON is read com JSON.parse only. Nothing here runs página code.
 */

/** Collapse whitespace mas preserve paragraph breaks. */
export function collapseWhitespace(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Trimmed textContent of o primeiro element matching any selector, ou ''. */
export function firstText(doc: ParentNode, selectors: string[] | undefined): string {
  if (!selectors) return '';
  for (const sel of selectors) {
    let el: Element | null = null;
    try {
      el = doc.querySelector(sel);
    } catch {
      continue;
    }
    const t = (el?.textContent || '').trim();
    if (t) return collapseWhitespace(t);
  }
  return '';
}

/** Concatenated texto of todo element matching any selector. */
export function allText(doc: ParentNode, selectors: string[] | undefined, cap = 8000): string {
  if (!selectors) return '';
  const parts: string[] = [];
  for (const sel of selectors) {
    let nodes: NodeListOf<Element> | null = null;
    try {
      nodes = doc.querySelectorAll(sel);
    } catch {
      continue;
    }
    nodes?.forEach((n) => {
      const t = (n.textContent || '').trim();
      if (t) parts.push(t);
    });
    if (parts.length) break; // first selector that yields content wins
  }
  const joined = collapseWhitespace(parts.join('\n'));
  return joined.length > cap ? joined.slice(0, cap) : joined;
}

/**
 * Extract verbatim editor código de Monaco / CodeMirror / Ace / textarea.
 * Whitespace is PRESERVED (this is code). Returns '' se não editor is found.
 */
export function extractEditorCode(doc: ParentNode, extraSelectors?: string[], cap = 8000): string {
  const chunks: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null | undefined) => {
    const t = (raw || '').replace(/ /g, ' ').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
    if (t.length < 2 || seen.has(t)) return;
    seen.add(t);
    chunks.push(t);
  };

  const safeQuery = (sel: string): Element[] => {
    try {
      return Array.from(doc.querySelectorAll(sel));
    } catch {
      return [];
    }
  };

  // Monaco: cada line in .view-line.
  for (const ed of safeQuery('.monaco-editor .view-lines, .monaco-editor')) {
    const lines = ed.querySelectorAll('.view-line');
    if (lines.length) push(Array.from(lines).map((l) => l.textContent || '').join('\n'));
  }
  // CodeMirror 6 (.cm-content/.cm-line) e CM5 (.CodeMirror-code/.CodeMirror-line).
  for (const ed of safeQuery('.cm-content, .CodeMirror-code')) {
    const lines = ed.querySelectorAll('.cm-line, .CodeMirror-line');
    if (lines.length) push(Array.from(lines).map((l) => l.textContent || '').join('\n'));
    else push(ed.textContent);
  }
  // Ace editor (.ace_content / .ace_line).
  for (const ed of safeQuery('.ace_content')) {
    const lines = ed.querySelectorAll('.ace_line');
    if (lines.length) push(Array.from(lines).map((l) => l.textContent || '').join('\n'));
    else push(ed.textContent);
  }
  // Plain <textarea> editors.
  for (const ta of safeQuery('textarea')) {
    const v = (ta as HTMLTextAreaElement).value || ta.textContent;
    if (v) push(v);
  }
  // Any platform-specific código selectors.
  if (extraSelectors) {
    for (const sel of extraSelectors) {
      for (const el of safeQuery(sel)) push(el.textContent);
    }
  }

  const joined = chunks.join('\n\n');
  return joined.length > cap ? joined.slice(0, cap) + '\n…(code truncated)' : joined;
}

/** Capture <pre> blocks (problem examples / I-O), preserving whitespace. */
export function extractPreBlocks(doc: ParentNode, cap = 4000): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  let nodes: NodeListOf<Element> | null = null;
  try {
    nodes = doc.querySelectorAll('pre');
  } catch {
    return '';
  }
  nodes?.forEach((el) => {
    const t = (el.textContent || '').replace(/\r\n?/g, '\n').trim();
    if (t.length >= 2 && !seen.has(t)) {
      seen.add(t);
      parts.push(t);
    }
  });
  const joined = parts.join('\n\n');
  return joined.length > cap ? joined.slice(0, cap) : joined;
}

/**
 * Find a substring of `body` que begins at a signal keyword (e.g. "Constraints")
 * e runs para o próximo blank line / próximo signal. Best-effort, returns '' se not
 * found. Used para slice constraints/examples/IO sections out of o problem text.
 */
export function sliceSection(body: string, signals: string[] | undefined, maxLen = 1200): string {
  if (!signals || !body) return '';
  const lower = body.toLowerCase();
  for (const sig of signals) {
    const idx = lower.indexOf(sig.toLowerCase());
    if (idx === -1) continue;
    const tail = body.slice(idx, idx + maxLen);
    // Stop at a double-newline boundary se there is one well past o heading.
    const end = tail.indexOf('\n\n', sig.length + 4);
    return (end > 0 ? tail.slice(0, end) : tail).trim();
  }
  return '';
}

/** `body.innerText`-style alternativa com script/style removed. */
export function bodyInnerText(doc: Document, cap = 12000): string {
  const body = doc.body;
  if (!body) return '';
  const clone = body.cloneNode(true) as HTMLElement;
  try {
    clone.querySelectorAll('script, style, noscript, template').forEach((n) => n.parentNode?.removeChild(n));
  } catch {
    /* shim sem querySelectorAll */
  }
  const text = (clone as { innerText?: string }).innerText ?? clone.textContent ?? '';
  const out = collapseWhitespace(text);
  return out.length > cap ? out.slice(0, cap) : out;
}

/**
 * Safely read embedded JSON página estado by id (e.g. __NEXT_DATA__). JSON.parse
 * ONLY — nunca eval. Returns nulo on any problem.
 */
export function readEmbeddedJson(doc: Document, ids: string[]): unknown {
  for (const id of ids) {
    let el: Element | null = null;
    try {
      el = doc.getElementById?.(id) ?? doc.querySelector(`#${id}`);
    } catch {
      continue;
    }
    const raw = el?.textContent;
    if (!raw) continue;
    try {
      return JSON.parse(raw);
    } catch {
      /* não válido JSON — skip */
    }
  }
  return null;
}
