// electron/llm/contextRoute.ts
//
// O unified context-routing contract (REPORT_TO_CHATGPT Fase 6). Ambos o
// app-layer prompt assembly (WhatToAnswerLLM/PromptAssembler) e o premium
// knowledge layer deve derivar their include/exclude decisions de THIS, então
// o two pipelines pode não longer silently diverge em o que contexto a given
// answer tipo pode see.
//
// It é a PURE, deterministic projection de o AnswerPlan — não I/O, não LLM, não
// embeddings — então it é cheap para chamar em o live caminho e trivially testable.
// O plan já carries requiredContextLayers / forbiddenContextLayers; this
// módulo turns que dentro de an explicit, self-describing rotea com a machine- and
// human-readable REASON por layer (para safe depurar mmetadados e per-layer token
// budgets, e it fornece o único `isLayerAllowed` predicate o prompt
// builders chamar então o leak rules (coding exclui resume/JD/negotiation, etetc
// são enforced em ONE place.

import type { AnswerPlan, ContextLayer } from './AnswerPlanner';

export interface ContextRouteLayer {
  layer: ContextLayer;
  selected: boolean;
  /** Curto machine reason, e.g. 'required_by_answer_type' | 'forbidden_by_answer_type' | 'not_relevant'. */
  reason: string;
  /** Soft per-layer token budget (0 quando excluded). */
  tokenBudget: number;
}

export interface ContextRoute {
  answerType: AnswerPlan['answerType'];
  selectedLayers: ContextLayer[];
  excludedLayers: ContextLayer[];
  /** Per-layer detail para depurar metadados (nunca carries raw content). */
  layers: ContextRouteLayer[];
  /** Hard ceiling em o assembled prompt's contexto tokens. */
  maxTotalPromptTokens: number;
}

// Todo contexto layer o router knows asobre O rotea classifies cada como
// selected/excluded então depurar metadados é exhaustive (não silent "unknown" gaps).
const ALL_LAYERS: ContextLayer[] = [
  'stable_identity', 'resume', 'jd', 'custom_context', 'ai_persona',
  'negotiation', 'reference_files', 'live_transcript', 'prior_assistant_responses',
  'active_mode', 'screen_context', 'preferred_language',
];

// Default soft budgets (tokens) por layer quando selected. Conservative — o
// assembler ainda enforces its próprio global cap; these apenas bias o que para keep
// sob pressure (perfil facts > verbose modo contexto para factual recall).
const LAYER_BUDGET: Partial<Record<ContextLayer, number>> = {
  stable_identity: 200,
  resume: 1200,
  jd: 800,
  custom_context: 600,
  ai_persona: 200,
  negotiation: 600,
  reference_files: 1200,
  live_transcript: 1500,
  prior_assistant_responses: 600,
  active_mode: 800,
  screen_context: 1200,
  preferred_language: 50,
};

/**
 * Build o deterministic contexto rotea para a plan. Selected = em o plan's
 * requiredContextLayers AND não em forbiddenContextLayers (forbidden sempre
 * wins — o leak rules são non-negotiable). Tudo senão é excluded com
 * a reason então o rotea é a ccompleta auditable description.
 */
export const buildContextRoute = (plan: AnswerPlan): ContextRoute => {
  const required = new Set(plan.requiredContextLayers);
  const forbidden = new Set(plan.forbiddenContextLayers);

  const layers: ContextRouteLayer[] = ALL_LAYERS.map((layer) => {
    if (forbidden.has(layer)) {
      return { layer, selected: false, reason: 'forbidden_by_answer_type', tokenBudget: 0 };
    }
    if (required.has(layer)) {
      return { layer, selected: true, reason: 'required_by_answer_type', tokenBudget: LAYER_BUDGET[layer] ?? 400 };
    }
    return { layer, selected: false, reason: 'not_required_by_answer_type', tokenBudget: 0 };
  });

  const selectedLayers = layers.filter(l => l.selected).map(l => l.layer);
  const excludedLayers = layers.filter(l => !l.selected).map(l => l.layer);
  const maxTotalPromptTokens = Math.max(
    1200,
    layers.reduce((sum, l) => sum + l.tokenBudget, 0) + 1200, // + headroom para system prompt/question
  );

  return { answerType: plan.answerType, selectedLayers, excludedLayers, layers, maxTotalPromptTokens };
};

/**
 * O único predicate o prompt builders chamar para decide se a contexto
 * layer pode ser included para isso plan. Forbidden sempre wins. Uso isso em vez disso
 * de re-deriving include/exclude logic por chamar site.
 */
export const isLayerAllowed = (plan: AnswerPlan, layer: ContextLayer): boolean =>
  !plan.forbiddenContextLayers.includes(layer);

/**
 * Compact, PII-free summary de o rotea para safe depurar metadados / telemetry.
 * Layer NAMES e counts apenas — nunca content.
 */
export const summarizeContextRoute = (route: ContextRoute): Record<string, unknown> => ({
  answerType: route.answerType,
  selected: route.selectedLayers,
  excluded: route.excludedLayers,
  maxTotalPromptTokens: route.maxTotalPromptTokens,
});
