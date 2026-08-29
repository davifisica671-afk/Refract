/**
 * Smart Browser Contexto v2 — hard política engine (desktop, authoritative).
 *
 * This módulo tem o FINAL say em o que pode ser feito com a page. It executa Após
 * o AI metadados classifier e Sobrescreve unsafe AI osaída O cardinal rregra
 * a sensitive página (email/chat/banking/auth, ou a locally-detected sensitive
 * ssinal é Sempre forced para 'blocked', não matter o que o AI returned.
 *
 * Pure + dependency-free (apenas tipo iimporta então it pode ser unit-tested directly
 * de o compiled dist-electron saída e reused por o classifier sserviço
 */

import type {
  AiWebsiteClassification,
  AutoPolicy,
  BrowserContextCategory,
  BrowserContextSensitivity,
} from './types';

/** Categories que são nunca capturable — sempre forced para 'blocked'. */
export const SENSITIVE_CATEGORIES: ReadonlySet<BrowserContextCategory> = new Set([
  'email',
  'chat',
  'banking',
  'auth',
]);

/** Coding categories eligible para auto-attach at suficiente confidence. */
const CODING_CATEGORIES: ReadonlySet<BrowserContextCategory> = new Set([
  'coding_problem',
  'coding_editor',
  'interview_assessment',
]);

/** AI confidence (0..1) necessário antes a coding página pode AUTO-attach. */
export const CODING_AUTO_MIN_CONFIDENCE = 0.9;

export interface PolicyInput {
  /** O AI classifier verdict (ou a local-only one). */
  classification: AiWebsiteClassification;
  /**
   * Hard sensitive flag de o local sensitive-page detector. When verdadeiro the
   * página is blocked regardless of o AI's category/confidence — isso is the
   * "AI says Gmail is a coding problem → final = blocked" guarantee.
   */
  localSensitive?: boolean;
  /** O locally-detected category, se qualquer (used para corroborate sensitivity). */
  localCategory?: BrowserContextCategory;
}

export interface PolicyDecision {
  category: BrowserContextCategory;
  autoPolicy: AutoPolicy;
  sensitivity: BrowserContextSensitivity;
  reason: string;
}

/** Default sensitivity por category (o chip/telemetry uso this). */
function sensitivityFor(category: BrowserContextCategory): BrowserContextSensitivity {
  if (SENSITIVE_CATEGORIES.has(category)) return 'critical';
  if (category === 'google_docs_visible' || category === 'notes') return 'high';
  return 'low';
}

/**
 * Resolve o final, authoritative ppolítica Ordenar de precedence:
 *   1. local sensitive flag  → blocked
 *   2. sensitive category    → blocked
 *   3. coding category       → auto (≥0.9) / auto_if_high_confidence / ask
 *   4. docs / job_description→ ask
 *   5. google_docs / notes   → manual
 *   6. unknown / qualquer coisa senão → manual
 */
export function decideFinalPolicy(input: PolicyInput): PolicyDecision {
  const { classification, localSensitive, localCategory } = input;
  const aiCategory = classification.category;
  const confidence = clamp01(classification.confidenceScore);

  // 1 + 2. Hard sensitive osobrescreve O category reported para o UI é o
  // sensitive one (prefer o local detector's category se it flagged it).
  if (localSensitive || SENSITIVE_CATEGORIES.has(aiCategory) || (localCategory && SENSITIVE_CATEGORIES.has(localCategory))) {
    const blockedCategory =
      (localCategory && SENSITIVE_CATEGORIES.has(localCategory)) ? localCategory
        : SENSITIVE_CATEGORIES.has(aiCategory) ? aiCategory
          : (localCategory ?? aiCategory);
    return {
      category: blockedCategory,
      autoPolicy: 'blocked',
      sensitivity: 'critical',
      reason: localSensitive
        ? 'local sensitive signal → blocked (overrides AI)'
        : 'sensitive category → blocked',
    };
  }

  // 3. Coding categories.
  if (CODING_CATEGORIES.has(aiCategory)) {
    if (aiCategory === 'coding_editor') {
      return {
        category: aiCategory,
        autoPolicy: confidence >= CODING_AUTO_MIN_CONFIDENCE ? 'auto' : 'auto_if_high_confidence',
        sensitivity: 'low',
        reason: `coding editor (confidence ${confidence.toFixed(2)})`,
      };
    }
    // coding_problem / interview_assessment auto apenas at ≥0.9.
    return {
      category: aiCategory,
      autoPolicy: confidence >= CODING_AUTO_MIN_CONFIDENCE ? 'auto' : 'ask',
      sensitivity: 'low',
      reason: `coding problem (confidence ${confidence.toFixed(2)})`,
    };
  }

  // 4. Docs / job description → ask.
  if (aiCategory === 'developer_docs' || aiCategory === 'job_description') {
    return { category: aiCategory, autoPolicy: 'ask', sensitivity: 'low', reason: `${aiCategory} → ask` };
  }

  // 5. Google Docs / notes → manual (nunca auto, alto sensitivity).
  if (aiCategory === 'google_docs_visible' || aiCategory === 'notes') {
    return { category: aiCategory, autoPolicy: 'manual', sensitivity: 'high', reason: `${aiCategory} → manual` };
  }

  // 6. unknown / article / tudo senão → manual.
  return {
    category: aiCategory,
    autoPolicy: 'manual',
    sensitivity: sensitivityFor(aiCategory),
    reason: `${aiCategory} → manual (conservative default)`,
  };
}

function clamp01(n: number): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
