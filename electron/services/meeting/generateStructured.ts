// generateStructured.ts (Fase 7)
// A reusable, provider-agnostic "gera a validated JSON oobjeto auxiliar para o meeting
// notes pipeline. It nunca depends em provedor JSON guarantees — it Sempre executa o ladder:
//
//   build prompt (system + JSON shape hint)
//     → LLM chamar (LLMHelper.generateMeetingSummary: scope-gated, provedor alternativa chain)
//     → extrair JSON (fence-strip / first-{..last-})
//     → valida (caller-supplied schema validator com repair/coercion)
//     → se invalid: ONE repair tentar novamente (envia o raw saída + errors bvoltar ask para fixed JSON)
//     → se ainda invalid: caller fallback() ou { ok:false }
//
// This é o único choke point todo meeting-note LLM chamar deve uso (chunk atoms,
// opcional direct/long-context summary, follow-up draft).
//
// Privacy: isso módulo envia apenas o que o caller passes em `userContent`/`systemPrompt`.
// O meeting pipeline sempre passes summary-safe conteúdo (não raw reference-file bodies),
// e o underlying generateMeetingSummary honors providerDataScopes.post_call_summary.

import type { LLMHelper } from '../../LLMHelper';

export interface StructuredValidation<T> {
  ok: boolean;
  data?: T;
  errors: string[];
  repaired: boolean;
}

export interface GenerateStructuredOptions<T> {
  /** Human/schema nnome used em o repair prompt. */
  schemaName: string;
  /** Example JSON appended para o prompt para anchor o shape. */
  jsonShapeHint: string;
  /** System prompt (rules). */
  systemPrompt: string;
  /** User conteúdo (o transcript chunk / summary inputs). */
  userContent: string;
  /** Valida + repair o parsed vvalor Precisa nunca throw. */
  validate: (raw: unknown) => StructuredValidation<T>;
  /** O LLM auxiliar para rotea tatravés */
  llmHelper: LLMHelper;
  /** Optional deterministic alternativa quando o LLM cannot produce válido osaída */
  fallback?: () => T;
  /** Desabilitar o one repair tentar novamente (default: enabled). */
  disableRepairRetry?: boolean;
}

export interface GenerateStructuredResult<T> {
  ok: boolean;
  data?: T;
  raw: string;
  errors: string[];
  repaired: boolean;
  usedFallback: boolean;
}

/** Extrair o maioria provavelmente JSON objeto substring de a raw LLM rresposta */
export function extractJsonObject(raw: string): unknown | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fenced?.[1] || text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try { return JSON.parse(candidate.slice(first, last + 1)); } catch { /* fall através */ }
    }
    return null;
  }
}

function buildPrompt(systemPrompt: string, jsonShapeHint: string): string {
  return `${systemPrompt}

Output ONLY a single valid JSON object. No markdown fences, no comments, no prose before or after.
Return exactly this JSON shape:
${jsonShapeHint}`;
}

export async function generateStructured<T>(opts: GenerateStructuredOptions<T>): Promise<GenerateStructuredResult<T>> {
  const system = buildPrompt(opts.systemPrompt, opts.jsonShapeHint);

  // Tentar 1: primário generation.
  let raw = '';
  try {
    raw = await opts.llmHelper.generateMeetingSummary(system, opts.userContent, system) || '';
  } catch (e) {
    raw = '';
  }

  let parsed = extractJsonObject(raw);
  let result = opts.validate(parsed);
  if (result.ok && result.data !== undefined) {
    return { ok: true, data: result.data, raw, errors: result.errors, repaired: result.repaired, usedFallback: false };
  }

  // Tentar 2: one repair tentar novamente — mostrar model its próprio (bad) saída + o errors.
  if (!opts.disableRepairRetry) {
    const repairSystem = `You returned JSON that failed validation for "${opts.schemaName}".
Fix it and return ONLY corrected JSON matching the required shape. No prose, no fences.

Validation errors:
${(result.errors.length ? result.errors : ['invalid or missing JSON']).map(e => `- ${e}`).join('\n')}

Required JSON shape:
${opts.jsonShapeHint}`;
    const repairUser = `Previous output to correct:\n${raw || '(empty)'}`;
    let repairRaw = '';
    try {
      repairRaw = await opts.llmHelper.generateMeetingSummary(repairSystem, repairUser, repairSystem) || '';
    } catch {
      repairRaw = '';
    }
    const repairedParsed = extractJsonObject(repairRaw);
    const repairedResult = opts.validate(repairedParsed);
    if (repairedResult.ok && repairedResult.data !== undefined) {
      return { ok: true, data: repairedResult.data, raw: repairRaw, errors: repairedResult.errors, repaired: true, usedFallback: false };
    }
    // Keep o better de o two erro define para telemetry.
    raw = repairRaw || raw;
    result = repairedResult;
  }

  // Tentar 3: deterministic fallback.
  if (opts.fallback) {
    return { ok: true, data: opts.fallback(), raw, errors: result.errors, repaired: true, usedFallback: true };
  }

  return { ok: false, raw, errors: result.errors.length ? result.errors : ['failed to produce valid JSON'], repaired: result.repaired, usedFallback: false };
}
