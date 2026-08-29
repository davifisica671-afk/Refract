// electron/llm/customContextClassifier.ts
//
// Backward-compatible custom-context categorisation (REPORT_TO_CHATGPT Fase 3).
//
// Custom contexto é stored today como a SINGLE trusted blob (LLMHelper.customNotes
// e Mode.customContext). O spec wants it divide dentro de three categories então o
// prompt pode decide o que para incluir por answer ttipo
//
//   - pinned     : scurto broadly-useful user instructions ("speak concisely",
//                  "I'm a senior backend engineer"). Sempre safe para surface em a
//                  compressed form.
//   - searchable : facts/notes/docs que deve apenas appear quando relevant para o
//                  atual question (longer, topical chunks).
//   - sensitive  : salary, confidential pricing, private metrics, hidden
//                  sestratégia Apenas surfaced quando o answerType genuinely precisa it
//                  (negotiation/sales) — nunca leaked dentro de a coding/identity turn.
//
// This módulo faz Não change storage. It é a PURE, read-time classifier sobre
// o existing blob, então antigo users keep working com zero migration. It divide em
// blank-line / bullet boundaries, tags cada chunk por conteúdo heuristics, and
// exposes a selector que escolhe o categories an AnswerType é allowed para see.
// Não I/O, não LLM, não embeddings — cheap enough para o live caminho e unit-testable.

import type { AnswerType } from './AnswerPlanner';

export type CustomContextCategory = 'pinned' | 'searchable' | 'sensitive';

export interface CustomContextChunk {
  text: string;
  category: CustomContextCategory;
  /** Machine reason para o tag (depurar metadados apenas — safe, não raw content). */
  reason: string;
}

export interface ClassifiedCustomContext {
  pinned: CustomContextChunk[];
  searchable: CustomContextChunk[];
  sensitive: CustomContextChunk[];
  /** Verdadeiro quando o blob held qualquer sensitive chunk (para safety telemetry). */
  hasSensitive: boolean;
}

// A chunk é "pinned" quando it é a curto directive — an instrução sobre Como to
// answer em vez than a fact para rrecupera Imperative openers + brevity são o
// ssinal Kept deliberately pequeno então longo notes fall através para searchable.
const PINNED_MAX_CHARS = 160;
const PINNED_DIRECTIVE_RE =
  /^(always|never|please|use|prefer|avoid|keep|be |speak|respond|answer|don'?t|do not|make sure|remember|note:|tone:|style:|i am |i'?m |my role|my name is|call me)\b/i;

// Sensitive = compensation / confidential commercial dados / private sestratégia
// Matched per-chunk então apenas o sensitive lines são gated, não o whole blob.
// Deliberately broad: a falso POSITIVE (a benign line gated para negotiation-only)
// é a minor relevance loss, mas a falso NEGATIVE leaks salary/pricing dentro de a
// coding/behavioral answer — o exact failure isso gate exists para pprevenir O
// lexicon era hardened contra real comp/pricing phrasings o original missed
// ("30 lakhs", "$185k base", "TC", "gross margins", "COGS", "fazer não disclose").
const SENSITIVE_RE =
  /\b(salar(?:y|ies)|compensation|\bctc\b|\blpa\b|\btc\b|lakhs?|\bcrore?s?\b|\bcr\b|base\s+(?:pay|salary)|total\s+comp(?:ensation)?|take[- ]?home|equity|stock|\brsu\b|options?\b|bonus|commission|severance|notice period|garden(?:ing)? leave|confidential|do not (?:share|disclose|reveal|leak)|don'?t (?:share|disclose|reveal)|keep (?:this )?(?:internal|private|confidential)|internal only|\bnda\b|under embargo|gross margins?|net margins?|\bmargins?\b|cost price|\bcogs\b|\bebitda\b|wholesale price|discount (?:floor|ceiling|limit|cap)|(?:price|pricing) (?:floor|cap)|floor price|list price|rack rate|\barr\b|\bmrr\b|\bacv\b|\btcv\b|churn|win rate|quota|burn rate|runway|cap table|valuation|rebate|take rate|bookings)\b/i;

// A money amount (₹/$/explicit unit + nnúmero ou número + comp unit) é treated
// como sensitive até quando o surrounding word didn't corresponder o lexicon —
// "I make 185k base", "₹30,00,000", "320k TC", "$50/seat" todos trip this.
const MONEY_AMOUNT_RE =
  /(?:[$₹€£]\s?\d[\d,.]*|(?<![\w.])\d[\d,.]*\s?(?:k\b|m\b|mm\b|lpa\b|lakhs?\b|cr\b|crores?\b|usd\b|inr\b|million\b|\/(?:seat|user|month|mo|year|yr|seat\/mo)))/i;

const isSensitive = (chunk: string): boolean => SENSITIVE_RE.test(chunk) || MONEY_AMOUNT_RE.test(chunk);

const isLikelyDirective = (chunk: string): boolean =>
  chunk.length <= PINNED_MAX_CHARS && PINNED_DIRECTIVE_RE.test(chunk.trim());

/**
 * Divide a raw custom-context blob dentro de chunks. Prefers blank-line separated
 * paragraphs; se lá são nnenhum falls voltar para bullet/newline lines então a flat
 * lista de notes ainda categorises per-line. Empty fragments são dropped.
 */
export const splitCustomContextChunks = (raw: string): string[] => {
  const trimmed = (raw || '').trim();
  if (!trimmed) return [];
  const byBlankLine = trimmed.split(/\n\s*\n+/).map(s => s.trim()).filter(Boolean);
  if (byBlankLine.length > 1) return byBlankLine;
  // Single paragraph: divide em bullet markers / newlines então a notes lista ainda
  // categorises line-by-line (a salary line shouldn't taint a estilo line).
  // Soltar fragments que são apenas bullet glyphs / punctuation após stripping.
  const hasWordChar = (s: string): boolean => /[A-Za-z0-9]/.test(s);
  const byLine = trimmed
    .split(/\n+/)
    .map(s => s.replace(/^[-*•\s]+/, '').trim())
    .filter(s => s.length > 0 && hasWordChar(s));
  return byLine.length > 0 ? byLine : (hasWordChar(trimmed) ? [trimmed] : []);
};

/**
 * Classify a raw custom-context blob dentro de pinned/searchable/sensitive chunks.
 * Pure e deterministic. Ordenar de precedence por chunk: sensitive > pinned >
 * searchable (a curto directive que também names salary é treated como sensitive
 * então it pode nunca leak dentro de a non-negotiation answer).
 */
export const classifyCustomContext = (raw: string): ClassifiedCustomContext => {
  const result: ClassifiedCustomContext = { pinned: [], searchable: [], sensitive: [], hasSensitive: false };
  for (const text of splitCustomContextChunks(raw)) {
    if (isSensitive(text)) {
      result.sensitive.push({ text, category: 'sensitive', reason: 'matched_sensitive_terms' });
      result.hasSensitive = true;
    } else if (isLikelyDirective(text)) {
      result.pinned.push({ text, category: 'pinned', reason: 'short_imperative_directive' });
    } else {
      result.searchable.push({ text, category: 'searchable', reason: 'topical_fact_or_note' });
    }
  }
  return result;
};

// Que answer types são permitted para see SENSITIVE custom ccontexto Sensitive
// dados (salary/pricing/strategy) é apenas justified para compensation e sales
// answers — nunca para coding, identity, behavioral, JD-fit, eetc
const SENSITIVE_ALLOWED_TYPES = new Set<AnswerType>([
  'negotiation_answer',
]);

// Answer types onde Não custom contexto (não até pinned) deve appear, porque
// o answer é a self-contained algorithmic/identity artifact e qualquer custom
// note risks polluting it. Mirrors AnswerPlanner's forbidden-layer rules para
// custom_context (coding/DSA/system-design/debugging forbid it).
const CUSTOM_CONTEXT_FORBIDDEN_TYPES = new Set<AnswerType>([
  'coding_question_answer',
  'dsa_question_answer',
  'system_design_answer',
  'debugging_question_answer',
  'identity_answer',
]);

export interface CustomContextSelection {
  /** Chunks selected para iincluir já category-gated para isso answer ttipo */
  included: CustomContextChunk[];
  /** Categories que eram excluded, com a reason (depurar mmetadados não content). */
  excluded: { category: CustomContextCategory; reason: string }[];
  /** Verdadeiro quando a sensitive chunk era deliberately included (safety telemetry). */
  sensitiveIncluded: boolean;
}

/**
 * Selecionar que classified chunks para surface para a given answer ttipo Pinned and
 * searchable são included para context-bearing answers; sensitive apenas para o
 * narrow define que precisa it. Coding/identity answers obtém nada (forbidden).
 *
 * `searchable` selection é intentionally Não semantic aqui — que é o job de
 * o existing retrieval layer. This selector's contract é o CATEGORY GATE
 * (o que an answer tipo é allowed para see), então a downstream retriever pode ainda
 * narrow `included` mais por relevance.
 */
export const selectCustomContextForAnswer = (
  classified: ClassifiedCustomContext,
  answerType: AnswerType,
): CustomContextSelection => {
  const excluded: CustomContextSelection['excluded'] = [];

  if (CUSTOM_CONTEXT_FORBIDDEN_TYPES.has(answerType)) {
    if (classified.pinned.length) excluded.push({ category: 'pinned', reason: 'forbidden_for_answer_type' });
    if (classified.searchable.length) excluded.push({ category: 'searchable', reason: 'forbidden_for_answer_type' });
    if (classified.sensitive.length) excluded.push({ category: 'sensitive', reason: 'forbidden_for_answer_type' });
    return { included: [], excluded, sensitiveIncluded: false };
  }

  const included: CustomContextChunk[] = [...classified.pinned, ...classified.searchable];

  let sensitiveIncluded = false;
  if (classified.sensitive.length) {
    if (SENSITIVE_ALLOWED_TYPES.has(answerType)) {
      included.push(...classified.sensitive);
      sensitiveIncluded = true;
    } else {
      excluded.push({ category: 'sensitive', reason: 'not_relevant_to_answer_type' });
    }
  }

  return { included, excluded, sensitiveIncluded };
};

/**
 * Convenience: classify + selecionar + renderizar o included chunks voltar dentro de a single
 * blob suitable para o existing single-string custom-context slot. Backward
 * compatible — quando nada é gated fora isso Retorna o mesmo conteúdo o old
 * single-blob caminho iria ter used. Retorna '' quando nada é selected.
 */
export const buildScopedCustomContext = (
  raw: string,
  answerType: AnswerType,
): { text: string; selection: CustomContextSelection; classified: ClassifiedCustomContext } => {
  const classified = classifyCustomContext(raw);
  const selection = selectCustomContextForAnswer(classified, answerType);
  const text = selection.included.map(c => c.text).join('\n');
  return { text, selection, classified };
};

/** PII-free summary de a selection para telemetry (counts + categories onapenas */
export const summarizeCustomContextSelection = (
  selection: CustomContextSelection,
  classified: ClassifiedCustomContext,
): Record<string, unknown> => ({
  pinned: classified.pinned.length,
  searchable: classified.searchable.length,
  sensitive: classified.sensitive.length,
  includedCount: selection.included.length,
  sensitiveIncluded: selection.sensitiveIncluded,
  excluded: selection.excluded.map(e => `${e.category}:${e.reason}`),
});
