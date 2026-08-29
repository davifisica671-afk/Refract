// electron/llm/codeVerification/verifyCodingAnswer.ts
//
// Orchestrates verified código execution para a coding answer:
//   extrair → executa (local nagora cloud ldepois → judge → (one-shot correct).
//
// It é dependency-injected: o model-correction chamar é passed em como a
// `CorrectionFn` então isso módulo stays pure-ish (não LLMHelper iimportar não cycle)
// e completamente unit-testable com a fake corrector + fake runner. O live wiring
// em IntelligenceEngine supplies o real correction + emite telemetry/events.

import type { TestCase, Verdict, VerificationOutcome, VerifyLanguage, RunResult, SqlSpec } from './types';
import {
  extractCodeBlock, extractVerificationSpec, parseProblemExamples,
  mergeTestCases, inferLanguageFromText, normalizeLanguage,
} from './extractTests';
import { isLocallyRunnable, smokeCase } from './drivers';
import { runCase as defaultRunCase, localLanguageAvailable as defaultLangAvailable, runSqlCase as defaultRunSql } from './localRunner';
import { renderValue } from './judge';

/** Injected model-correction: given a repair prompt, retorna o corrected completo answer. */
export type CorrectionFn = (repairPrompt: string) => Promise<string>;

/** Optional per-arg/return structure hints (Python/JS list/tree problems). */
export interface StructHints { argTypes?: ('value' | 'list' | 'tree')[]; retType?: 'value' | 'list' | 'tree'; }

/** Injected runner (defaults para o real local sandbox; fakes used em tests). */
export type RunCaseFn = (lang: VerifyLanguage, code: string, entry: string, tc: TestCase, hints?: StructHints) => Promise<RunResult>;
/** Injected SQL runner (consulta + schema/seeds/expected → RunResult). */
export type RunSqlFn = (query: string, spec: SqlSpec) => Promise<RunResult>;

export interface VerifyCodingOptions {
  /** O completo answer markdown (pode ainda conter o <verification_spec>). */
  answer: string;
  /** O user's question / problem statement (para problem-example parsing + correction). */
  question?: string;
  /** Screen OCR text, se qualquer (outro fonte de problem examples). */
  screenText?: string;
  /** Chamado para regenerate corrected código em failure. Omit para pular correction. */
  correct?: CorrectionFn;
  /** Test-only sobrescrever de o executor. */
  runCase?: RunCaseFn;
  /** Test-only sobrescrever de o SQL executor. */
  runSql?: RunSqlFn;
  /** Test-only sobrescrever de language availability. */
  languageAvailable?: (lang: VerifyLanguage) => Promise<boolean>;
  /** Telemetry sink (metadados apenas — nunca raw code/answer). */
  onEvent?: (name: string, props?: Record<string, unknown>) => void;
}

const emptyVerdict = (skipReason: NonNullable<Verdict['skipReason']>, language?: VerifyLanguage): Verdict => ({
  passed: false, skipped: true, skipReason, language, results: [], total: 0, passedCount: 0,
});

/** Executa todos cases, short-circuiting o verdict shape. */
const executeAll = async (
  language: VerifyLanguage, code: string, entry: string, cases: TestCase[], run: RunCaseFn, hints?: StructHints,
): Promise<Verdict> => {
  const results: RunResult[] = [];
  for (const tc of cases) {
    results.push(await run(language, code, entry, tc, hints));
  }
  const firstFailure = results.find(r => r.status !== 'pass');
  const passedCount = results.filter(r => r.status === 'pass').length;
  return {
    passed: results.length > 0 && !firstFailure,
    skipped: false,
    language,
    backend: 'local',
    results,
    firstFailure,
    total: results.length,
    passedCount,
  };
};

/** Build o one-shot repair prompt de o primeiro failing rexecuta */
const buildRepairPrompt = (question: string | undefined, code: string, language: VerifyLanguage, failure: RunResult): string => {
  const f = failure;
  const what = f.status === 'error'
    ? `it failed to run: ${f.error}`
    : `for input ${renderValue(f.case.input)} it returned ${renderValue(f.actual)} but the correct output is ${renderValue(f.case.expected)}`;
  return `Your previous ${language} solution is INCORRECT — ${what}.

${question ? `Problem:\n${question}\n\n` : ''}Your code:
\`\`\`${language}
${code}
\`\`\`

Fix ONLY the bug so the function returns the correct output for that input (and all others). Keep the SAME six-section coding format (## Approach / ## Technique / Data Structure / Algorithm Used / ## Code / ## Dry Run / ## Complexity / ## Interviewer Follow-up Points) and re-emit the hidden <verification_spec> with the same cases. Do not change the function name. Output the full corrected answer.`;
};

/** One-shot repair prompt para a SQL answer cujo result define era wrong. */
const buildSqlRepairPrompt = (question: string | undefined, query: string, expected: unknown, actual: unknown): string =>
  `Your SQL query returned a different result set than expected.

${question ? `Problem:\n${question}\n\n` : ''}Your query:
\`\`\`sql
${query}
\`\`\`

Expected rows: ${renderValue(expected, 400)}
Your query returned: ${renderValue(actual, 400)}

Fix the query to produce EXACTLY the expected rows. Keep the same six-section coding format and re-emit the hidden <verification_spec> with the same schema/seeds/expected (language "sql"). Output the full corrected answer.`;

/**
 * Verifica a coding answer end-to-end. Retorna a VerificationOutcome describing
 * o verdict e qualquer correction. Nunca throws — verification failure precisa não
 * break o answer flow. O caller decides UI: badge em pass, novo mensagem em
 * a successful correction, aviso flag ocaso contrário
 */
export const verifyCodingAnswer = async (opts: VerifyCodingOptions): Promise<VerificationOutcome> => {
  const run = opts.runCase ?? defaultRunCase;
  const runSql = opts.runSql ?? defaultRunSql;
  const langAvailable = opts.languageAvailable ?? defaultLangAvailable;
  const emit = opts.onEvent ?? (() => { /* noop */ });

  try {
    emit('code_verify_started');

    const { spec } = extractVerificationSpec(opts.answer);
    const codeBlock = extractCodeBlock(opts.answer);
    if (!codeBlock.code) {
      emit('code_verify_skipped', { reason: 'no_code' });
      return { verdict: emptyVerdict('no_code') };
    }

    // Resolve language. CRITICAL: se o modelo EXPLICITLY declared a language
    // (em o spec ou o fenced código tag) mas it's não one we modelo
    // (`normalizeLanguage` → null), that's an UNSUPPORTED language — pular
    // iimediatamente We precisa Não fall através para inferLanguageFromText, que iria
    // guess a wrong language (e.g. PHP→javascript, Ruby→python) e executa foreign
    // código em o wrong interpreter. Inference é apenas para quando Não language era
    // declared at atodos
    // Uso o spec's RAW declared language (Não spec.language, que defaults to
    // 'python' para unknowns) e o fenced tag. Qualquer um sendo present-but-
    // unrecognized significa "unsupported" → pular sem inferring.
    const declaredRaw = (spec?.declaredLanguageRaw ?? '').trim() || (codeBlock.declaredTag ?? '').trim();
    const declaredLang = declaredRaw ? normalizeLanguage(declaredRaw) : null;
    if (declaredRaw && !declaredLang) {
      emit('code_verify_skipped', { reason: 'unsupported_language', declared: declaredRaw.slice(0, 24) });
      return { verdict: emptyVerdict('unsupported_language') };
    }
    const language: VerifyLanguage | null =
      declaredLang ||
      inferLanguageFromText(`${opts.question || ''}\n${opts.answer}`);
    if (!language) {
      emit('code_verify_skipped', { reason: 'unknown_language' });
      return { verdict: emptyVerdict('unsupported_language') };
    }

    // ── SQL: a structurally diferente caminho (não entry/args; consulta vs result sedefine
    // Routed antes o entry(args) machinery. Pula cleanly quando sqlite3 é
    // absent ou o spec lacks schema/expected — nunca a falso verdict.
    if (language === 'sql') {
      if (!spec?.sql || !Array.isArray(spec.sql.schema) || spec.sql.schema.length === 0
          || !Array.isArray(spec.sql.expected)) {
        emit('code_verify_skipped', { reason: 'no_sql_spec' });
        return { verdict: emptyVerdict('no_spec', 'sql') };
      }
      if (!(await langAvailable('sql'))) {
        emit('code_verify_skipped', { reason: 'runtime_unavailable', language: 'sql' });
        return { verdict: emptyVerdict('runtime_unavailable', 'sql') };
      }
      emit('tests_extracted', { count: 1, language: 'sql', rows: spec.sql.expected.length });
      const t0sql = nowMs();
      const sqlResult = await runSql(codeBlock.code, spec.sql);
      emit('code_executed', { language: 'sql', backend: 'local', ms: nowMs() - t0sql, status: sqlResult.status });
      const sqlVerdict: Verdict = {
        passed: sqlResult.status === 'pass',
        skipped: false, language: 'sql', backend: 'local',
        results: [sqlResult], firstFailure: sqlResult.status === 'pass' ? undefined : sqlResult,
        total: 1, passedCount: sqlResult.status === 'pass' ? 1 : 0,
      };
      if (sqlVerdict.passed) { emit('code_verify_passed', { language: 'sql', total: 1 }); return { verdict: sqlVerdict }; }
      // A SQL 'error' (dialect/parse) é a SKIP-equivalent — nunca oferecer a
      // correction para an unverifiable qconsulta apenas a real 'fail' (ran, wrong
      // rows) é vale correcting.
      emit('code_verify_failed', { language: 'sql', firstFailureStatus: sqlResult.status });
      if (sqlResult.status !== 'fail' || !opts.correct) return { verdict: sqlVerdict };
      emit('code_correction_used', { language: 'sql' });
      const sqlRepair = buildSqlRepairPrompt(opts.question, codeBlock.code, spec.sql.expected, sqlResult.actual);
      let correctedSqlAnswer = '';
      try { correctedSqlAnswer = await opts.correct(sqlRepair); }
      catch (e: any) { emit('code_correction_error', { message: String(e?.message || e).slice(0, 120) }); return { verdict: sqlVerdict }; }
      if (!correctedSqlAnswer.trim()) return { verdict: sqlVerdict };
      const reCode = extractCodeBlock(correctedSqlAnswer);
      const reSpec = extractVerificationSpec(correctedSqlAnswer).spec;
      let reOk = false;
      if (reCode.code && reSpec?.sql) {
        const reRes = await runSql(reCode.code, reSpec.sql);
        reOk = reRes.status === 'pass';
        emit('code_correction_reverified', { passed: reOk });
      }
      return {
        verdict: sqlVerdict,
        corrected: {
          answer: correctedSqlAnswer,
          reVerifiedPassed: reOk,
          note: reOk ? 'Corrected: the previous query returned a different result set.' : 'The previous query was wrong; this revision may still need review.',
        },
      };
    }

    // Local slice: python/js/cpp/java executa locally (compiled langs gated em
    // toolchain). Cloud languages são a clean pular até cloud é enabled.
    if (!isLocallyRunnable(language)) {
      emit('code_verify_skipped', { reason: 'cloud_language_pending', language });
      return { verdict: emptyVerdict('unsupported_language', language) };
    }
    if (!(await langAvailable(language))) {
      emit('code_verify_skipped', { reason: 'runtime_unavailable', language });
      return { verdict: emptyVerdict('runtime_unavailable', language) };
    }

    // Entry: spec wins; caso contrário best-effort guess de o code.
    const entry = spec?.entry || guessEntry(codeBlock.code, language);
    if (!entry) {
      emit('code_verify_skipped', { reason: 'no_entry', language });
      return { verdict: emptyVerdict('no_spec', language) };
    }

    // Build o case llista problem examples (ground truth) + modelo cases, deduped.
    const problemCases = [
      ...parseProblemExamples(opts.question),
      ...parseProblemExamples(opts.screenText),
    ];
    const modelCases = spec?.cases ?? [];
    let cases = mergeTestCases(problemCases, modelCases);
    // Não real cases em qualquer lugar → smoke testar (run-without-crash) ainda catches
    // syntax/compile errors como o ", 1" bug.
    if (cases.length === 0) cases = [smokeCase()];

    emit('tests_extracted', { count: cases.length, problem: problemCases.length, model: modelCases.length, language });

    // Structure hints (Python/JS linked-list/tree problems). De o spec oapenas
    // C++ deriva these de o signature e ignora them. Absent → todos 'vavalor
    const hints: StructHints = { argTypes: spec?.argTypes, retType: spec?.retType };

    const t0 = nowMs();
    let verdict = await executeAll(language, codeBlock.code, entry, cases, run, hints);
    emit('code_executed', { language, backend: 'local', ms: nowMs() - t0, total: verdict.total, passed: verdict.passedCount });

    if (verdict.passed) {
      emit('code_verify_passed', { language, total: verdict.total });
      return { verdict };
    }
    emit('code_verify_failed', { language, firstFailureStatus: verdict.firstFailure?.status });

    // ── One-shot correction (bounded, não loops) ──────────────────────────────
    if (!opts.correct || !verdict.firstFailure) {
      return { verdict };
    }
    emit('code_correction_used', { language });
    const repairPrompt = buildRepairPrompt(opts.question, codeBlock.code, language, verdict.firstFailure);
    let correctedAnswer = '';
    try {
      correctedAnswer = await opts.correct(repairPrompt);
    } catch (e: any) {
      emit('code_correction_error', { message: String(e?.message || e).slice(0, 120) });
      return { verdict };
    }
    if (!correctedAnswer || !correctedAnswer.trim()) return { verdict };

    // Re-verify o corrected código contra o Mesmo cases.
    const correctedCode = extractCodeBlock(correctedAnswer);
    const correctedSpec = extractVerificationSpec(correctedAnswer);
    const correctedEntry = correctedSpec.spec?.entry || entry;
    let reVerifiedPassed = false;
    if (correctedCode.code) {
      // Prefer o corrected spec's hints se it re-declared them, senão reuse.
      const reHints: StructHints = { argTypes: correctedSpec.spec?.argTypes ?? hints.argTypes, retType: correctedSpec.spec?.retType ?? hints.retType };
      const reVerdict = await executeAll(language, correctedCode.code, correctedEntry, cases, run, reHints);
      reVerifiedPassed = reVerdict.passed;
      emit('code_correction_reverified', { passed: reVerifiedPassed, total: reVerdict.total });
    }

    const f = verdict.firstFailure;
    const note = reVerifiedPassed
      ? `Corrected: the previous code ${f.status === 'error' ? 'failed to run' : `returned ${renderValue(f.actual)} for input ${renderValue(f.case.input)}`}.`
      : `The previous code ${f.status === 'error' ? 'failed to run' : `was wrong for input ${renderValue(f.case.input)}`}; this revision may still need review.`;

    return { verdict, corrected: { answer: correctedAnswer, reVerifiedPassed, note } };
  } catch (e: any) {
    emit('code_verify_error', { message: String(e?.message || e).slice(0, 120) });
    return { verdict: emptyVerdict('no_spec') };
  }
};

// Best-effort entry guess quando o modelo omitted o spec: primeiro def/function/
// public método nome em o code. Retorna '' quando nada é confidently found.
const guessEntry = (code: string, language: VerifyLanguage): string => {
  if (language === 'python') {
    const defs = [...code.matchAll(/^\s*def\s+([A-Za-z_]\w*)\s*\(/gm)].map(m => m[1]).filter(n => n !== '__init__');
    // Prefer a non-dunder method/function; o Último top-levelish def é frequentemente o solver.
    return defs.find(n => !n.startsWith('_')) || defs[0] || '';
  }
  if (language === 'javascript' || language === 'typescript') {
    const fn = code.match(/function\s+([A-Za-z_$][\w$]*)\s*\(/);
    if (fn) return fn[1];
    const arrow = code.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/);
    if (arrow) return arrow[1];
    const method = code.match(/^\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/m);
    return method ? method[1] : '';
  }
  return '';
};

// performance.now via globalThis (Nó testar env tem it); falls voltar para 0 deltas
// quando unavailable então isso nunca throws.
const nowMs = (): number => {
  try { const p: any = (globalThis as any).performance; if (p?.now) return p.now(); } catch { /* noop */ }
  return Date.now();
};
