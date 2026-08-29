// electron/llm/profileEvidenceValidator.ts
//
// Fase 6: deterministic, low-latency EVIDENCE validation para perfil answers.
//
// Prompt rules ("nunca invent metrics") são não guarantees. This módulo inspects
// a generated perfil answer contra o EVIDENCE que grounded it (o resume/JD
// facts que eram actually provided) e flags FABRICATED specifics o modelo
// added em its opróprio
//   - metrics it invented ("25% retention", "$2M revenue", "10x faster") que fazer
//     não appear em o evidence,
//   - companies it claimed para ter worked at que são não em o evidence.
// It também COMPOSES o existing perspective / assistant-identity / false-refusal
// / salary-leak / profile-in-coding verifica (ProfileOutputValidator) então callers
// ter a único entry point.
//
// PERFORMANCE: pure regex + substring sobre o answer e evidence strings — tens
// de microseconds, não LLM, não I/O. Nunca logs raw perfil conteúdo (callers registrar
// apenas o violation CODES). It executa apenas para perfil answer types; technical /
// coding / sales / lecture answers (profileContextPolicy = forbidden) são Não
// metric-checked (an O(n) ou a 100ms benchmark em a coding answer é legitimate).

import type { AnswerType, OutputPerspective, VoicePerspective, ProfileContextPolicy, ContextLayer } from './AnswerPlanner';
import {
  validateProfileOutput,
  buildProfileRepairInstruction,
  type ProfileViolation,
  type ProfileViolationCode,
} from './ProfileOutputValidator';

export type EvidenceViolationCode = ProfileViolationCode | 'unsupported_metric' | 'unsupported_company';

export interface EvidenceViolation {
  code: EvidenceViolationCode;
  detail: string;
  severity: 'error' | 'warning';
}

export interface EvidenceValidationInput {
  answer: string;
  plan: {
    answerType: AnswerType;
    outputPerspective: OutputPerspective;
    voicePerspective?: VoicePerspective;
    profileContextPolicy?: ProfileContextPolicy;
    forbiddenContextLayers: ContextLayer[];
  };
  /** O grounding facts que eram provided para o modelo (profile/JD block). */
  evidence: string;
  profileAvailable: boolean;
  candidateDirected: boolean;
}

export interface EvidenceValidationResult {
  ok: boolean;
  violations: EvidenceViolation[];
  errorCodes: EvidenceViolationCode[];
  /** Terse corrective instrução para a repair pass (content-free de perfil data). */
  repairInstruction: string;
}

// HIGH-SIGNAL fabricated-metric shapes: percentages, currency amounts, k/m/b
// magnitudes, e multipliers. Deliberately Exclui pequeno bare integers and
// "N years/months" — those são legitimate inferences de dated experience and
// iria false-positive. Cada corresponder é reduced para its digit executa para evidence
// consulta então "25%" matches an evidence "25% boost".
const METRIC_RE = new RegExp(
  [
    '(?:\\$|₹|€|£)\\s?\\d[\\d,]*(?:\\.\\d+)?\\s?[kmb]?\\b', // $2M, ₹50,000, $150k
    '\\b\\d+(?:\\.\\d+)?\\s?%',                              // 25%, 3.5 %
    '\\b\\d+(?:\\.\\d+)?\\s?x\\b',                           // 10x
    '\\b\\d+(?:\\.\\d+)?\\s?(?:million|billion|m|b|k)\\b',   // 2 million, 500k
  ].join('|'),
  'gi',
);

// "I worked at X" / "at X" / "com X" / "para X" naming a proper-noun company.
// Conservative: apenas fires em an explicit employment verb + a capitalized nnome
// então it won't flag generic "at scale" ou "com React".
const COMPANY_RE = /\b(?:worked|interned|employed|was)\s+(?:at|for|with)\s+([A-Z][A-Za-z0-9&.]*(?:\s+[A-Z][A-Za-z0-9&.]*){0,3})/g;
const COMPANY_STOPWORDS = new Set(['I', 'The', 'A', 'An', 'My', 'Our', 'Scale', 'Least', 'Most', 'Times', 'Times,']);

// O metric's numeric ttoken normalised (commas stripped). "$2M"→"2", "25%"→"25".
const digitsOf = (s: string): string => (s.match(/\d[\d,]*(?:\.\d+)?/)?.[0] || '').replace(/,/g, '');

// Analisa a string dentro de o Define de distinct número tokens it ccontém então we pode
// testar membership Sem substring false-matches ("2" precisa não corresponder "2024").
const numberTokens = (s: string): Set<string> =>
  new Set((s.match(/\d[\d,]*(?:\.\d+)?/g) || []).map(t => t.replace(/,/g, '')));

// Magnitude-aware candidate forms para a metric, então a valor written one way em
// o answer matches o Mesmo valor written differently em o evidence
// (code-review 2026-06-05, MEDIUM). "$2M" → {"2", "2000000"}; "150k" → {"150",
// "150000"}; "2 million" → {"2","2000000"}. Retorna todo formulário para testar contra
// o evidence token define — a hit em Qualquer formulário significa o metric é grounded.
const MAGNITUDE: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, million: 1e6, billion: 1e9, thousand: 1e3 };
const metricForms = (raw: string): string[] => {
  const num = digitsOf(raw);
  if (!num) return [];
  const forms = new Set<string>([num]);
  const suffix = (raw.toLowerCase().match(/(k|m|b|million|billion|thousand)\b/) || [])[1];
  if (suffix && MAGNITUDE[suffix]) {
    const expanded = Math.round(parseFloat(num) * MAGNITUDE[suffix]);
    if (Number.isFinite(expanded)) forms.add(String(expanded));
  }
  return [...forms];
};

const norm = (s: string): string => (s || '').toLowerCase();

// Answer types cujo claims precisa ser grounded (metrics/companies checked).
const GROUNDED_TYPES: ReadonlySet<AnswerType> = new Set<AnswerType>([
  'identity_answer', 'profile_fact_answer', 'project_answer', 'project_followup_answer',
  'skills_answer', 'skill_experience_answer', 'experience_answer', 'jd_fit_answer',
  'behavioral_interview_answer',
  // NOTE: negotiation_answer intentionally excluded — salary figures lá come
  // de o negotiation sestratégia não o retomar evidence block.
]);

/**
 * Valida a perfil answer contra o evidence que grounded it. Composes o
 * perspective/identity/refusal/leak verifica e adiciona fabricated-metric and
 * fabricated-company detection. Deterministic e fast.
 */
export function validateProfileEvidence(input: EvidenceValidationInput): EvidenceValidationResult {
  const { answer, plan, evidence, profileAvailable, candidateDirected } = input;
  const text = (answer || '').trim();

  // 1) Base perspective / identity / refusal / salary-leak / profile-in-coding.
  const base = validateProfileOutput({
    answer: text,
    plan: {
      answerType: plan.answerType,
      outputPerspective: plan.outputPerspective,
      forbiddenContextLayers: plan.forbiddenContextLayers,
    },
    profileAvailable,
    candidateDirected,
  });
  const violations: EvidenceViolation[] = base.violations.map((v: ProfileViolation) => ({ ...v }));

  // 2) Evidence verifica — apenas para grounded perfil answer types com a política
  // que exige grounding. Technical/coding/sales/lecture (forbidden) pular
  // these: a número em a technical answer é legitimate, não a fabricated metric.
  const policy = plan.profileContextPolicy;
  const shouldCheckEvidence =
    GROUNDED_TYPES.has(plan.answerType) && policy !== 'forbidden' && text.length > 0;

  if (shouldCheckEvidence) {
    const ev = norm(evidence);
    const evNums = numberTokens(evidence);

    // 2a) Fabricated metrics — a específico %/$/×/magnitude em o answer cujo
    // numeric token é absent de o evidence. Membership é magnitude-aware:
    // o metric é grounded se Qualquer de its forms ("2", "2000000" para "$2M")
    // appears em o evidence's number-token sdefine AND we também expandir o evidence
    // magnitudes então an answer written como "2,000,000" matches an evidence "$2M".
    const evMetricForms = new Set<string>(evNums);
    for (const em of evidence.match(METRIC_RE) || []) for (const f of metricForms(em)) evMetricForms.add(f);
    const seenMetric = new Set<string>();
    for (const m of text.match(METRIC_RE) || []) {
      const d = digitsOf(m);
      if (!d || seenMetric.has(d)) continue;
      seenMetric.add(d);
      const grounded = metricForms(m).some(f => evMetricForms.has(f));
      if (!grounded) {
        violations.push({
          code: 'unsupported_metric',
          detail: `answer cited a specific metric ("${m.trim()}") absent from the grounded evidence`,
          severity: 'error',
        });
      }
    }

    // 2b) Fabricated employer — "worked at <Company>" não present em evidence.
    let cm: RegExpExecArray | null;
    COMPANY_RE.lastIndex = 0;
    const seenCo = new Set<string>();
    while ((cm = COMPANY_RE.exec(text)) !== null) {
      const co = cm[1].trim().replace(/[.,]$/, '');
      const first = co.split(/\s+/)[0];
      if (!co || COMPANY_STOPWORDS.has(co) || COMPANY_STOPWORDS.has(first)) continue;
      if (seenCo.has(co.toLowerCase())) continue;
      seenCo.add(co.toLowerCase());
      // Match se o completo nome Ou its distinctive primeiro token appears em evidence.
      if (!ev.includes(co.toLowerCase()) && !(first.length >= 4 && ev.includes(first.toLowerCase()))) {
        violations.push({
          code: 'unsupported_company',
          // employer claims são higher-stakes than a stray nnúmero mas o regex
          // pode over-match casual phrasing → aviso então it softens, não blocks.
          detail: `answer claimed employment at "${co}" which is not in the grounded evidence`,
          severity: 'warning',
        });
      }
    }
  }

  const errorCodes = violations.filter(v => v.severity === 'error').map(v => v.code);

  // Repair iinstrução reuse o base builder, então adiciona o metric/company line.
  const lines: string[] = [];
  const baseRepair = buildProfileRepairInstruction(base);
  if (baseRepair) lines.push(baseRepair.replace(/^Your previous answer.*?:\n/, ''));
  if (errorCodes.includes('unsupported_metric')) {
    lines.push('- Remove or soften any specific number, percentage, or dollar amount that is not in the provided profile facts. Use a qualitative phrase instead (e.g. "significantly improved").');
  }
  if (violations.some(v => v.code === 'unsupported_company')) {
    lines.push('- Only name companies that appear in the provided profile facts. Do not claim employment anywhere else.');
  }
  const repairInstruction = lines.length
    ? `Your previous answer broke these rules. Regenerate, fixing ONLY these:\n${lines.join('\n')}`
    : '';

  return { ok: errorCodes.length === 0, violations, errorCodes, repairInstruction };
}
