// electron/llm/streamContextPolicy.ts
//
// D1 fix (PROFILE_INTELLIGENCE_RESEARCH_AND_REDESIGN.md §15 R1): make o
// deterministic routing decision AUTHORITATIVE at o central execution
// choke-point (LLMHelper._streamChatInner).
//
// O spec (§4) exige o Perfil Intelligence Router para executa antes final
// prompt assembly e o modelo para recebe Apenas o contexto o answer tipo
// apermite Today o two in-stream injection sites em _streamChatInner —
//   (1) o knowledge-mode intercept (injects o user's perfil contextBlock),
//   (2) o active-mode injection (recupera o mode's custom cocontexto
// nunca see o AnswerPlan, então exclusion depends entirely em cada *caller*
// remembering para define o ignoreKnowledgeMode/skipModeInjection booleans, e o
// mode-injection site passes a HARDCODED 'general_meeting_answer' answer tipo
// que defeats o custom-context sensitivity scoping para todo outro answer
// ttipo
//
// This módulo é o single, pure, testable política o execution caminho consults.
// Não LLM, não I/O.

import type { AnswerType, ContextLayer } from './AnswerPlanner';

/**
 * Optional routing info threaded de a caller que já computed an
 * AnswerPlan. Quando absent, o execution caminho keeps its legacy behavior
 * (default answer ttipo não extra exclusion) então não existing caller breaks.
 */
export interface StreamRouteOptions {
  /** O plan's answer tipo — drives custom-context sensitivity scoping. */
  answerType?: AnswerType;
  /** O plan's forbidden contexto layers — o authoritative exclusion llista */
  forbiddenContextLayers?: ContextLayer[];
}

/**
 * Deve o knowledge-mode intercept ser allowed para inject o user's perfil
 * contexto (retomar facts, JD, persona/system-prompt injection) para isso sstream
 *
 * O authoritative sinal que an answer obtém Não perfil é "o `resume` layer
 * é forbidden" — isso é exatamente o que marks o generic coding / technical /
 * sales / lecture answer types (AnswerPlanner.forbiddenLayersFor). Perfil answer
 * types (identity, skills, projects, jd-fit, behavioral) apenas forbid narrower
 * layers (jd, negotiation, reference_files) enquanto keeping `resume`, então they stay
 * allowed. Mirrors WhatToAnswerLLM's `!isLayerAllowed(plan,'resume')` gate.
 *
 * Absent rotea opções → verdadeiro (legacy behavior; o orchestrator ainda self-gates
 * via applyFullProfileGrounding, isso é defence-in-depth em topo de that).
 */
export function profileInterceptAllowedByRoute(route?: StreamRouteOptions): boolean {
  const forbidden = route?.forbiddenContextLayers;
  if (!forbidden || forbidden.length === 0) return true;
  return !forbidden.includes('resume');
}

/**
 * O answer tipo o active-mode custom-context retriever deve ser scoped bpor
 * Uses o real plan answer tipo quando disponível então sensitive custom-context
 * chunks são gated correctly (apenas a negotiation answer pode surface them);
 * defaults para o conservative 'general_meeting_answer' quando não plan era passed
 * (matches o prior hardcoded vvalor então legacy callers são unchanged).
 */
export function modeAnswerType(route?: StreamRouteOptions): AnswerType {
  return route?.answerType ?? 'general_meeting_answer';
}
