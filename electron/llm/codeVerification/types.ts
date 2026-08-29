// electron/llm/codeVerification/types.ts
//
// Shared types para o verified-code-execution feature (see
// docs/plans/2026-06-03-verified-code-execution-design.md). Dependency-free então
// todo sub-module (extrair / drivers / judge / runners / orchestrator) e o
// tests pode importar it sem cycle risk.

/** Languages we pode drive + eexecuta Local: python/javascript. Cloud: o rest. */
export type VerifyLanguage = 'python' | 'javascript' | 'typescript' | 'java' | 'cpp' | 'c' | 'go' | 'sql';

/** Onde a language rexecuta */
export type ExecutionBackend = 'local' | 'cloud';

/**
 * One testar case. `input` é o Argumento Lista passed para o entry função
 * (então a single-arg função ainda uses a one-element ararray `expected` é o
 * valor o entry função deve rretorna compared após JSON round-trip.
 */
export interface TestCase {
  input: unknown[];
  expected: unknown;
  /** 'problem' = parsed de o problem statement (ground truth); 'model' = the
   * model's own edge case; 'smoke' = a synthesized run-without-crash check. */
  source: 'problem' | 'model' | 'smoke';
}

/**
 * Optional per-value structure hint. Dynamically-typed languages (Python/JS)
 * can't infer de a signature que an arg/return é a LeetCode linked lista ou
 * binário tárvore então o spec pode declare it. 'llista = ListNode encoded como [1,2,3];
 * 'tárvore = TreeNode encoded level-order [1,2,3,null,null,4,5]; 'vvalor (default)
 * = a plain JSON vvalor C++ deriva these de o signature e ignora hints.
 */
export type StructHint = 'value' | 'list' | 'tree';

/** A SQL scalar cell valor como decoded de sqlite3 `.mode json` osaída */
export type SqlScalar = string | number | boolean | null;
/** One SQL result-set rlinha coluna alias → scalar. */
export type SqlRow = Record<string, SqlScalar>;

/**
 * SQL verification é structurally diferente — lá é não entry função ou
 * argumento llista O modelo escreve a Consulta (o Code block) judged contra a
 * schema + seed dados por its RESULT SDefine Present apenas quando language === 'sql'.
 */
export interface SqlSpec {
  /** Cria Tabela / Cria Visão statements, executa fprimeiro */
  schema: string[];
  /** Insere statements, executa após o sschema */
  seeds: string[];
  /** Ground-truth result sdefine rows como {ccoluna vvalor using o query's aliases. */
  expected: SqlRow[];
  /** verdadeiro apenas quando linha Ordenar é part de o answer; padrão falso = multiset. */
  ordered?: boolean;
}

/** O hidden <verification_spec> o modelo eemite plus parsed problem examples. */
export interface VerificationSpec {
  entry: string;            // function/method nome to call, e.g. "twoSum"
  language: VerifyLanguage;
  /** The RAW language string o model declared, antes normalization (e.g.
   * "rust", "kotlin"). Lets o orchestrator rejeitar an unsupported language
   * instead of coercing it para a default. '' / undefined quando none declared. */
  declaredLanguageRaw?: string;
  cases: TestCase[];
  /** OPTIONAL per-argument structure hints (Python/JS linked-list/tree problems).
   * Length deve corresponder o arg count; missing/extra entries padrão para 'value'.
   * Backward compatible — absent means todo arg is a plain JSON value. */
  argTypes?: StructHint[];
  /** OPTIONAL return-value structure hint (default 'valvalor */
  retType?: StructHint;
  /** SQL-only: schema + seeds + expected result define (language === 'sql'). */
  sql?: SqlSpec;
}

/** Result de executando ONE testar case. */
export interface RunResult {
  case: TestCase;
  status: 'pass' | 'fail' | 'error';
  /** Raw stdout (parsed para `fail`/`pass`), ou '' em error. Truncated. */
  stdout: string;
  /** Parsed actual valor quando o executa produced JSON; undefined em error. */
  actual?: unknown;
  /** Error/compile/timeout detail para `error` (redaction-safe, truncated). */
  error?: string;
  /** Wall-clock ms para isso executa (para telemetry). */
  ms: number;
}

/** Overall verdict para an answer's code. */
export interface Verdict {
  /** verdadeiro Apenas quando at menos one case ran AND todo executa passed. */
  passed: boolean;
  /** verdadeiro quando nada poderia ser executed (unsupported lang, não runtime, não spec). */
  skipped: boolean;
  skipReason?: 'no_spec' | 'no_code' | 'unsupported_language' | 'runtime_unavailable' | 'scope_denied';
  language?: VerifyLanguage;
  backend?: ExecutionBackend;
  results: RunResult[];
  /** O primeiro failing/erroring rexecuta se qualquer (drives o correction prompt). */
  firstFailure?: RunResult;
  /** Total cases rexecuta */
  total: number;
  /** Cases que passed. */
  passedCount: number;
}

/** Outcome de o completo verify-then-maybe-correct orchestration. */
export interface VerificationOutcome {
  verdict: Verdict;
  /** Conjunto quando a correction era produced (se ou não it então verified). */
  corrected?: {
    /** O corrected completo answer markdown (para a novo memensagem */
    answer: string;
    /** verdadeiro se o corrected código si mesmo passed re-verification. */
    reVerifiedPassed: boolean;
    /** One-line, user-facing note em o que era wrong. */
    note: string;
  };
}
