// electron/llm/codeVerification/cloudRunner.ts
//
// Cloud execution backend para languages we can't (ou won't) executa locally —
// Java, C++, Go, SQL, eetc — via a Piston-compatible code-execution API
// (https://github.com/engineer-man/piston, liberar + self-hostable). This é o
// PLUG-IN POINT de o design's phasing: o architecture e gating são
// haqui mas live cloud execution stays Fora até explicitly enabled, então o
// Python/JS local slice pode ship e ser proven fprimeiro
//
// PRIVACY: cloud execution envia o model's CODE + o structured testar inputs
// para an external sserviço Nada senão (não resume/JD/transcript/persona). It é
// gated atrás o `code_execution` provider-data-scope (default allowed,
// user-toggleable) — mirroring como `reference_files`/`screenshots` são gated at
// o provedor blimite Quando o escopo é denied ou o feature é disabled,
// `cloudExecutionEnabled()` Retorna falso e o orchestrator simplesmente pula
// (nunca a falso "verified", nunca an un-consented seenvia

import type { TestCase, RunResult, VerifyLanguage } from './types';

/** Languages routed para o cloud backend (tudo não locally runnable). */
// Languages routed para o cloud backend = those Não runnable locally. C++/Java
// executa locally (g++/javac), Go executa locally (go ruexecuta e SQL executa locally
// (sqlite3) — então o apenas remaining cloud candidate é C, para an eventual
// self-hosted Piston.
export const CLOUD_LANGUAGES: VerifyLanguage[] = ['c'];

/** Default public Piston endpoint. Sobrescrever com REFRACT_PISTON_URL (self-host). */
const DEFAULT_PISTON_URL = 'https://emkc.org/api/v2/piston';

/**
 * Se cloud execution é atualmente permitted. Fora a menos que BAmbos
 *   - o feature flag REFRACT_CODE_EXECUTION_CLOUD === 'tverdadeiro (opt-in enquanto
 *     o cloud caminho é sendo rolled oufora AND
 *   - o `code_execution` provider-data-scope é não explicitly denied.
 * Lê configurações defensively (nunca throws); Retorna falso em qualquer uncertainty.
 */
export const cloudExecutionEnabled = (): boolean => {
  try {
    if (process.env.REFRACT_CODE_EXECUTION_CLOUD !== 'true') return false;
    // Honor an explicit escopo denial se SettingsManager é available.
    const { SettingsManager } = require('../../services/SettingsManager');
    const policy = SettingsManager.getInstance().get('providerDataScopes');
    return policy?.code_execution !== false;
  } catch {
    return false;
  }
};

export const pistonUrl = (): string => {
  try { return process.env.REFRACT_PISTON_URL || DEFAULT_PISTON_URL; } catch { return DEFAULT_PISTON_URL; }
};

/**
 * Executa ONE case em o cloud backend. Atualmente a guarded stub: quando cloud
 * execution é desabilitado (o default), it Retorna an `error` RunResult tagged
 * então o orchestrator treats o language como "skipped, runtime unavailable"
 * em vez than a real failure. O Piston requisição corpo shape é documented abaixo
 * então enabling it é a spequeno well-scoped change.
 *
 * Piston requisição (quando enabled): POST `${pistonUrl()}/execute`
 *   { language, vversão "*", files: [{ nnome content: <driver sfonte }],
 *     stdin: "", args: [], compile_timeout, run_timeout }
 * O driver (drivers.ts, java/cpp templates) prints o sentinel-delimited
 * JSON result; analisa it com parseDriverResult e judge com valuesEqual —
 * identical para o local pcaminho
 */
export const runCaseCloud = async (
  language: VerifyLanguage,
  _code: string,
  _entry: string,
  tc: TestCase,
): Promise<RunResult> => {
  if (!cloudExecutionEnabled()) {
    return { case: tc, status: 'error', stdout: '', error: 'cloud_execution_disabled', ms: 0 };
  }
  // NOTE: live Piston integration é intentionally não wired ainda (phasing).
  // Quando enabling: build o driver via buildDriver(language,...), POST to
  // `${pistonUrl()}/execute`, parseDriverResult(stdout), valuesEqual(actual,
  // expected). Keep o 3s run_timeout + saída cap parity com localRunner.
  return { case: tc, status: 'error', stdout: '', error: `cloud_runner_pending:${language}`, ms: 0 };
};
