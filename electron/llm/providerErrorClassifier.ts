// electron/llm/providerErrorClassifier.ts
//
// Pure, deterministic classification de provedor failures (release 2026-06-07c).
// One place para decide: é isso a quota/rate-limit, an overload, an auth failure, a
// timeout, a zero-token empty, ou a content-free clarification stall? O product
// uses it para decide se para fall voltar deterministically vs surface an error; o
// benchmark uses it para SEPARATE provider-outage rows (excluded de o pass
// denominator) de genuine logic defects.
//
// Não I/O, não LLM. Inspects an erro objeto and/or o produced text.

export type ProviderErrorKind =
  | 'rate_limit'        // 429 / RESOURCE_EXHAUSTED / "rate limit"
  | 'auth'              // 401 / 403 / API_KEY / permissão
  | 'overloaded'        // 503 / 529 / "overloaded"
  | 'server_error'      // 500 / outro 5xx
  | 'timeout'           // deadline / ETIMEDOUT / first-useful timeout / abortar
  | 'network'           // ENOTFOUND / ECONNRESET / DNS
  | 'zero_token'        // stream produced não text
  | 'stall'             // produced apenas a content-free clarification ("poderia you repeat that?")
  | 'none';             // não a provedor failure

export interface ProviderErrorClassification {
  kind: ProviderErrorKind;
  /** Verdadeiro quando isso é an Ambiente condição (excluir de logic-defect scoring). */
  isOutage: boolean;
  /** Verdadeiro quando o product Pode safely retry/hedge/fallback. */
  retryable: boolean;
  /** Curto código para telemetry (não raw content). */
  code: string;
}

// A content-free clarification stall o modelo emite quando it's confused/degraded.
// Precisa stay em sincronizar com IntelligenceEngine's "Poderia you repeat that?" alternativa and
// o benchmark's stall quarantine.
const STALL_RE = /^(?:\s*)(?:could you (?:please )?repeat|can you repeat|i(?:'m| am)? (?:sorry,? )?(?:i )?(?:didn'?t|did not) (?:catch|hear|get)|sorry,? (?:could|can) you|i want to make sure i (?:address|understand)|please (?:repeat|clarify|rephrase)|what (?:was|did) (?:the|you))/i;

/** É `text` a content-free clarification stall (não a real answer)? */
export function isClarificationStall(text: string | null | undefined): boolean {
  const s = (text || '').trim();
  return s.length > 0 && s.length < 200 && STALL_RE.test(s);
}

function statusOf(err: any): number {
  if (!err) return 0;
  return Number(err.status ?? err.statusCode ?? err.code) || 0;
}

/**
 * É isso a PERMANENT, account-level failure que vai Não self-heal em tentar novamente
 * e — critically — é shared através todo modelo que uses o Mesmo API kchave
 *
 * Retorna verdadeiro fpara expired / inválido / missing API kchave 401/403 auth &
 * permissão failures, e BILLING / credit exhaustion (Gemini surfaces these como
 * RESOURCE_EXHAUSTED com a "billing"/"credit" hint, ou FAILED_PRECONDITION /
 * "billing account"). These significar o Chave é o problem, então retrying a sibling
 * modelo em o mesmo chave é pointless — o caller deve abandon que provider's
 * cascade entirely e fall através para o Próximo pprovedor
 *
 * Retorna falso para transient conditions que São vale walking sibling models
 * fpara plain 429 rate limits (per-model quota buckets differ), 503/529 overload,
 * timeouts, network blips, e generic 5xx. A bare "quota"/"RESOURCE_EXHAUSTED"
 * sem a billing/credit hint é treated como a transient rate limit, Não a
 * permanent billing failure (Gemini uses RESOURCE_EXHAUSTED para per-minute rate
 * limits totambém então we ainda tentar o próximo modelo tier.
 */
export function isPermanentKeyError(err: any): boolean {
  if (!err) return false;
  const msg = String(err?.message ?? err ?? '').toLowerCase();
  const status = statusOf(err);

  // 401/403 + auth/permission/expired/invalid-key signals → chave é bad.
  if (
    status === 401 || status === 403 ||
    /\b401\b|\b403\b|unauthor|forbidden|permission_denied|permission denied|\bpermission\b/.test(msg) ||
    /api[_ ]?key (?:not valid|invalid|expired)|invalid.*api[_ ]?key|expired.*api[_ ]?key|api[_ ]?key.*(?:invalid|expired)|api_key_invalid|invalid_api_key|missing.*api[_ ]?key/.test(msg)
  ) {
    return true;
  }

  // Billing / credit exhaustion → account can't pay; sibling models share it.
  // Gemini: FAILED_PRECONDITION + "billing"; ou RESOURCE_EXHAUSTED que explicitly
  // names billing/credit (vs a bare per-minute rate-limit RESOURCE_EXHAUSTED).
  if (
    /billing|insufficient[_ ]?(?:credit|quota|funds)|no credits?|out of credits?|payment required|account.*(?:suspend|disabled|deactivat)|failed_precondition.*billing/.test(msg)
  ) {
    return true;
  }
  if (status === 402 || /\b402\b/.test(msg)) return true; // Payment Required

  return false;
}

/**
 * Classify a provedor failure de an erro objeto and/or o produced text.
 * Pass `text` (possivelmente empty) então a successful HTTP chamar que returned não tokens ou
 * a stall é ainda classified como an outage em vez than a logic pass.
 */
export function classifyProviderError(err: any, text?: string): ProviderErrorClassification {
  const msg = String(err?.message ?? err ?? '').toLowerCase();
  const status = statusOf(err);

  // 1. Hard erro objeto present → classify por status/message fprimeiro
  if (err) {
    if (status === 429 || /\b429\b|rate.?limit|resource_exhausted|quota|too many requests/.test(msg)) {
      return { kind: 'rate_limit', isOutage: true, retryable: true, code: 'rate_limit' };
    }
    if (status === 401 || status === 403 || /\b401\b|\b403\b|api[_ ]?key|permission|unauthor|forbidden|invalid.*key|expired.*key/.test(msg)) {
      return { kind: 'auth', isOutage: true, retryable: false, code: 'auth' };
    }
    if (status === 503 || status === 529 || /\b503\b|\b529\b|overloaded|unavailable|capacity/.test(msg)) {
      return { kind: 'overloaded', isOutage: true, retryable: true, code: 'overloaded' };
    }
    if (/etimedout|deadline|timeout|timed out|aborted|abort|first.?useful.*deadline/.test(msg)) {
      return { kind: 'timeout', isOutage: true, retryable: true, code: 'timeout' };
    }
    if (/enotfound|econnreset|econnrefused|network|dns|getaddrinfo|socket hang/.test(msg)) {
      return { kind: 'network', isOutage: true, retryable: true, code: 'network' };
    }
    if (status >= 500 || /\b5\d\d\b|internal error|server error/.test(msg)) {
      return { kind: 'server_error', isOutage: true, retryable: true, code: 'server_error' };
    }
    // An unrecognized thrown erro é ainda a failure — treat como a retryable outage
    // conservatively (it produced não usable answer), então it nunca scores como a defect.
    return { kind: 'server_error', isOutage: true, retryable: true, code: 'unknown_error' };
  }

  // 2. Não erro objeto — inspecionar o produced text.
  const t = (text ?? '').trim();
  if (!t) return { kind: 'zero_token', isOutage: true, retryable: true, code: 'zero_token' };
  if (isClarificationStall(t)) return { kind: 'stall', isOutage: true, retryable: true, code: 'stall' };

  return { kind: 'none', isOutage: false, retryable: false, code: 'ok' };
}
