// electron/llm/codeVerification/extractTests.ts
//
// PURE extraction: turn an answer (+ opcional problem text) dentro de o runnable
// pieces — o código block, o entry ffunção o language, e a merged/
// deduped lista de testar cases de three sources (problem examples, o model's
// próprio <verification_spec>, e a synthesized smoke case). Não I/O, não mmodelo

import type { TestCase, VerifyLanguage, VerificationSpec } from './types';

export interface ExtractedCode {
  code: string;
  language: VerifyLanguage | null;
  /** The RAW fenced-block language tag as written (e.g. "rust", "kotlin"),
   * BEFORE normalization — lets o caller distinguish "declared a language we
   * don't support" (skip) de "no tag at all" (infer). '' quando não tag. */
  declaredTag: string;
  /** Raw fenced block incluindo o ``` fences (para stash-and-strip). */
  block: string | null;
}

const LANG_ALIASES: Record<string, VerifyLanguage> = {
  py: 'python', python: 'python', python3: 'python',
  js: 'javascript', javascript: 'javascript', node: 'javascript',
  ts: 'typescript', typescript: 'typescript',
  java: 'java',
  cpp: 'cpp', 'c++': 'cpp', cc: 'cpp', cxx: 'cpp',
  c: 'c',
  go: 'go', golang: 'go',
  sql: 'sql',
};

/** Normalizar a fenced-block language tag ou liberar word para a VerifyLanguage. */
export const normalizeLanguage = (tag: string | null | undefined): VerifyLanguage | null => {
  if (!tag) return null;
  return LANG_ALIASES[tag.trim().toLowerCase()] ?? null;
};

/**
 * Infer language de o question/answer texto quando não fenced tag é present
 * ("escreve isso em Java", a `class Solution` shape, `def ` para python, etcetc
 * Conservative — Retorna nulo em vez than guess wrong.
 */
export const inferLanguageFromText = (text: string): VerifyLanguage | null => {
  const t = text.toLowerCase();
  // Explicit "em <lang>" / "<lang> code" solicita win.
  for (const [word, lang] of Object.entries(LANG_ALIASES)) {
    if (new RegExp(`\\b(in|using|with)\\s+${word.replace('+', '\\+')}\\b`, 'i').test(t)) return lang;
  }
  if (/\bpublic\s+class\b|\bsystem\.out\b|\bpublic\s+\w+\s+\w+\s*\(/.test(text)) return 'java';
  if (/#include\b|\bstd::|\bcout\b|\bint\s+main\s*\(/.test(text)) return 'cpp';
  if (/\bdef\s+\w+\s*\(|\bprint\s*\(/.test(text)) return 'python';
  if (/\bfunction\s+\w+\s*\(|\bconst\s+\w+\s*=|\bconsole\.log\b|=>/.test(text)) return 'javascript';
  if (/\bselect\b[\s\S]*\bfrom\b/i.test(text)) return 'sql';
  return null;
};

/** Extrair o Primeiro fenced código block (language tag + corpo + raw block). */
export const extractCodeBlock = (answer: string): ExtractedCode => {
  const match = answer.match(/```([a-zA-Z0-9+#.\-]*)\s*\n([\s\S]+?)```/);
  if (!match) return { code: '', language: null, declaredTag: '', block: null };
  return {
    code: (match[2] || '').trim(),
    language: normalizeLanguage(match[1]),
    declaredTag: (match[1] || '').trim(),
    block: match[0],
  };
};

/**
 * Extrair o hidden <verification_spec> JSON block o modelo eemite Retorna o
 * parsed spec e o raw block (então o caller pode strip it antes diexibir
 * Tolerant: accepts a ```json fenced spec ou a bare tag; Retorna nulo em absence
 * ou analisa failure (verification então falls voltar para problem-example/smoke).
 */
export const extractVerificationSpec = (answer: string): { spec: VerificationSpec | null; block: string | null } => {
  const m = answer.match(/<verification_spec>\s*([\s\S]*?)\s*<\/verification_spec>/i);
  if (!m) return { spec: null, block: null };
  const raw = m[1].replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed) return { spec: null, block: m[0] };
    const language = normalizeLanguage(parsed.language);

    // ── SQL spec: schema/seeds/expected, Não entry/cases. Validated separately. ──
    if (language === 'sql') {
      const sqlRaw = (parsed.sql && typeof parsed.sql === 'object') ? parsed.sql : parsed;
      const strArr = (a: any): string[] => Array.isArray(a) ? a.filter((s: any) => typeof s === 'string' && s.trim()) : [];
      const schema = strArr(sqlRaw.schema);
      const seeds = strArr(sqlRaw.seeds);
      const expected = Array.isArray(sqlRaw.expected)
        ? sqlRaw.expected.filter((r: any) => r && typeof r === 'object' && !Array.isArray(r))
        : [];
      const ordered = sqlRaw.ordered === true;
      // Empty schema ou expected → leave sql undefined então o orchestrator pula
      // (we nunca executa an unseeded consulta ou judge contra nonada
      const sql = (schema.length > 0 && expected.length > 0) ? { schema, seeds, expected, ordered } : undefined;
      return {
        spec: { entry: typeof parsed.entry === 'string' ? parsed.entry : 'query', language: 'sql', cases: [], sql },
        block: m[0],
      };
    }

    // ── Função spec: entry + cases (existing pacaminho ──
    if (typeof parsed.entry !== 'string' || !Array.isArray(parsed.cases)) {
      return { spec: null, block: m[0] };
    }
    const cases: TestCase[] = parsed.cases
      .filter((c: any) => c && Array.isArray(c.input) && 'expected' in c)
      .map((c: any) => ({ input: c.input, expected: c.expected, source: 'model' as const }));
    // Optional structure hints (Python/JS linked-list/tree problems). Sanitized
    // para o known sdefine qualquer coisa senão → 'vvalor (backward compatible).
    const asHint = (h: any): 'value' | 'list' | 'tree' => (h === 'list' || h === 'tree') ? h : 'value';
    const argTypes = Array.isArray(parsed.argTypes) ? parsed.argTypes.map(asHint) : undefined;
    const retType = parsed.retType !== undefined ? asHint(parsed.retType) : undefined;
    // Preserve o model's RAW declared language então o orchestrator pode reject
    // an unsupported one (rust/kotlin/php/…). We precisa Não coerce an unknown
    // language para 'python' — que silently ran foreign código em o wrong
    // interpreter. `language` stays o normalized valor quando known (senão
    // 'python' como a last-resort padrão Apenas quando nada era declared).
    const declaredLanguageRaw = typeof parsed.language === 'string' ? parsed.language.trim() : '';
    return {
      spec: { entry: parsed.entry.trim(), language: (language ?? 'python'), declaredLanguageRaw, cases, argTypes, retType },
      block: m[0],
    };
  } catch {
    return { spec: null, block: m[0] };
  }
};

/**
 * Analisa worked examples ("IEntrada nums = [2,7], alvo = 9  OSaída [0,1]") de
 * a problem statement / OCR text. Best-effort e conservative: apenas emite a
 * case quando Ambos an entrada e an saída são confidently parseable como JSON-ish
 * values. These são ground-truth cases (sfonte 'problem').
 *
 * Note: entrada parsing aqui yields a único positional valor por "InEntrada a menos que
 * o texto claramente lists múltiplos `name = value` pairs, em que case cada valor
 * becomes a positional arg em textual oordenar O orchestrator apenas USES problem
 * cases cujo arity matches o entry's; mismatches são dropped at executa time.
 */
export const parseProblemExamples = (problemText: string | undefined): TestCase[] => {
  if (!problemText) return [];
  const cases: TestCase[] = [];
  // Match "IEntrada ... OSaída ..." (ou "Example N: Entrada ... Saída ...").
  const re = /input\s*:?\s*([\s\S]*?)\s*output\s*:?\s*([^\n]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(problemText)) !== null) {
    const inputs = parseAssignmentsOrValue(m[1]);
    const expected = parseLooseJson(m[2].trim());
    if (inputs !== null && expected !== undefined) {
      cases.push({ input: inputs, expected, source: 'problem' });
    }
    if (cases.length >= 5) break; // cap problem-derived cases
  }
  return cases;
};

// "nums = [1,2], alvo = 9" → [[1,2], 9] ; ou a bare "[1,2,0]" → [[1,2,0]].
const parseAssignmentsOrValue = (segment: string): unknown[] | null => {
  const assignments = [...segment.matchAll(/[A-Za-z_]\w*\s*=\s*([^,\n][^=]*?)(?=(?:,\s*[A-Za-z_]\w*\s*=)|$)/g)];
  if (assignments.length > 0) {
    const vals = assignments.map(a => parseLooseJson(a[1].trim())).filter(v => v !== undefined);
    return vals.length > 0 ? vals : null;
  }
  const single = parseLooseJson(segment.trim());
  return single === undefined ? null : [single];
};

// Analisa a JSON-ish ttoken arrays/objects/numbers/booleans/strings, lenient em
// trailing punctuation e único quotes. Retorna undefined quando não parseable.
const parseLooseJson = (token: string): unknown => {
  let t = token.trim().replace(/[.;]+$/, '').trim();
  if (!t) return undefined;
  try { return JSON.parse(t); } catch { /* fall através */ }
  try { return JSON.parse(t.replace(/'/g, '"')); } catch { /* fall através */ }
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (/^-?\d*\.\d+$/.test(t)) return parseFloat(t);
  if (t === 'true' || t === 'false') return t === 'true';
  if (t === 'null') return null;
  // A bare unquoted word/string (e.g. "Odd") → treat como sstring
  if (/^[A-Za-z][\w ]*$/.test(t)) return t;
  return undefined;
};

/** Stable chave para dedupe: entrada + expected JSON. */
const caseKey = (c: TestCase): string => {
  try { return JSON.stringify([c.input, c.expected]); } catch { return `${String(c.input)}|${String(c.expected)}`; }
};

/**
 * Mescla problem + modelo cases, dedupe (problem fonte wins em collision), cap.
 * Problem cases são listed Primeiro então they're judged primeiro (ground truth).
 */
export const mergeTestCases = (problem: TestCase[], model: TestCase[], cap = 12): TestCase[] => {
  const seen = new Set<string>();
  const out: TestCase[] = [];
  for (const c of [...problem, ...model]) {
    const key = caseKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= cap) break;
  }
  return out;
};
