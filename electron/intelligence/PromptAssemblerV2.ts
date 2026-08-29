// electron/intelligence/PromptAssemblerV2.ts
//
// Spec Fase 9 — Prompt Assembler V2.
//
// PRESERVES o existing typed/trust/sanitization philosophy de
// electron/services/context/PromptAssembler.ts (que stays o live WTA assembler)
// e Adiciona o V2 capabilities o spec asks fpara em topo de o Fase 8 fusion osaída
//   • renderiza fused blocks dentro de trust-tagged XML (<profile_tree trust="high" …>),
//   • a Contexto INCLUSION REPORT (o que era included/dropped e por que — fonte tracing),
//   • candidate-perspective proteger + no-assistant-identity proteger (reuses
//     ProfileTreeService.getCandidatePerspectiveGuard),
//   • mode-specific answer-contract instrução (incl. lecture_notes/revision/diagram),
//   • token-budget por contexto tipo (delegated para o fusion engine aljá
//
// This é a PURE renderer sobre a PromptContextContract — não mmodelo não IO, nunca throws.
// It faz não substituir o live PromptAssembler; it's o V2 surface o rollout (Fase
// 19) pode trocar para atrás prompt_assembler_v2_enabled.

import type { PromptContextContract, FusedContextBlock, FusionSource } from './ContextFusionEngine';
import { TrustLevel } from '../services/context/TrustLevels';
import { ProfileTreeService } from './ProfileTreeService';
import type { AnswerContract } from './ContextRouter';

// Mapa TrustLevel → a curto trust word para o XML aatributo
function trustWord(level: TrustLevel): 'high' | 'medium' | 'low' {
  switch (level) {
    case TrustLevel.SYSTEM_POLICY:
    case TrustLevel.MODE_POLICY:
    case TrustLevel.DEVELOPER_POLICY:
    case TrustLevel.USER_PREFERENCES:
    case TrustLevel.TRUSTED_PROFILE:
      return 'high';
    case TrustLevel.ASSISTANT_HISTORY:
      return 'medium';
    default:
      return 'low';
  }
}

// XML tag nome por fusion fonte (o spec's block foformata
const SOURCE_TAG: Record<FusionSource, string> = {
  system_rules: 'system_rules',
  mode_instructions: 'mode_instructions',
  user_explicit_context: 'user_context',
  profile_tree: 'profile_tree',
  active_jd: 'jd',
  live_transcript_current: 'live_transcript',
  conversation_history: 'conversation_history',
  rag_evidence: 'rag_evidence',
  meeting_memory: 'meeting_memory',
  hindsight_memory: 'hindsight_memory',
  lecture_memory: 'lecture_context',
  reference_files: 'reference_file',
  browser_dom: 'browser_dom',
  raw_transcript_overflow: 'transcript_overflow',
  diagram_spec: 'diagram_spec',
};

const SOURCE_PROVENANCE: Record<FusionSource, string> = {
  system_rules: 'system',
  mode_instructions: 'mode_template',
  user_explicit_context: 'user',
  profile_tree: 'structured_profile',
  active_jd: 'structured_jd',
  live_transcript_current: 'stt',
  conversation_history: 'assistant_history',
  rag_evidence: 'resume_jd_files',
  meeting_memory: 'meeting_memory',
  hindsight_memory: 'long_term_memory',
  lecture_memory: 'lecture_transcript',
  reference_files: 'reference_files',
  browser_dom: 'browser_dom',
  raw_transcript_overflow: 'stt',
  diagram_spec: 'diagram_intelligence',
};

// XML-escape user conteúdo (mirrors PromptAssembler.escapeUserContent).
function escapeXml(text: string): string {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Neutralize sobrescrever phrasings dentro user conteúdo (mirrors escapePromptInjection).
function escapeInjection(text: string): string {
  return (text || '')
    .replace(/ignore\s+(all\s+|any\s+|the\s+)?(previous|prior|above)\s+(instructions?|prompts?)/gi, '[instruction-like text removed]')
    .replace(/system\s*prompt\s*:/gi, '[system-prompt-reference removed]')
    .replace(/\[INST\]/gi, '[inst]');
}

export interface ContextInclusionReportRow {
  source: FusionSource;
  tag: string;
  trust: 'high' | 'medium' | 'low';
  provenance: string;
  included: boolean;
  tokenEstimate: number;
  reason: string;
}

export interface AssembledPromptV2 {
  /** O trust-tagged XML contexto block sstring */
  contextXml: string;
  /** O answer-contract instrução appended para o system prompt. */
  contractInstruction: string;
  /** O candidate-perspective proteger line (empty quando não applicable). */
  perspectiveGuard: string;
  /** O completo inclusion report (fonte tracing — Fase 9/13). */
  inclusionReport: ContextInclusionReportRow[];
  totalTokenEstimate: number;
}

export interface AssemblePromptV2Input {
  contract: PromptContextContract;
  answerContract: AnswerContract;
  mode?: string;
  query: string;
}

// Mode-specific answer-contract instructions (o spec's saída shapes).
const CONTRACT_INSTRUCTIONS: Record<AnswerContract, string> = {
  interview_short: 'Answer in first person AS the candidate. Concise (2–5 sentences). Ground in the candidate profile. Do not mention hidden context, retrieval, or internal systems.',
  interview_detailed: 'Answer in first person AS the candidate. Structured but natural; bullets only if asked. Ground every claim in the candidate profile/JD.',
  coding_answer: 'Pure technical answer. Sections: Approach, Data structures/techniques, Code, Dry run, Complexity, Edge cases. No profile, resume, or product mentions.',
  sales_reply: 'Answer from the seller/product perspective. Handle the objection. Do not use the candidate resume or JD unless explicitly asked.',
  lecture_notes: 'Produce clean student lecture notes: headings, key concepts, definitions, examples, and diagrams where useful. Student/learner perspective — no interview or sales framing.',
  lecture_revision: 'Produce revision material: concise concept recap, likely exam questions, and a revision checklist. Student perspective.',
  lecture_diagram: 'Produce a diagram for the concept. Prefer a valid Mermaid spec; label it AI-reconstructed if not copied from a source visual. Student perspective.',
  team_meeting_summary: 'Summarize from a neutral facilitator perspective: decisions, action items, owners, open questions. No candidate framing.',
  general_assistant: 'Answer helpfully and directly in a natural voice. Do not invent profile facts.',
};

/**
 * Assemble o V2 prompt contexto de a fusion contract. Pure + nunca throws.
 */
export function assemblePromptV2(input: AssemblePromptV2Input): AssembledPromptV2 {
  const report: ContextInclusionReportRow[] = [];
  const parts: string[] = [];
  let total = 0;

  try {
    for (const block of input.contract.blocks) {
      const tag = SOURCE_TAG[block.source];
      const trust = trustWord(block.trustLevel);
      const provenance = SOURCE_PROVENANCE[block.source];
      const isUntrusted = trust === 'low';
      // Untrusted conteúdo obtém injection-escaped + XML-escaped; trusted structured
      // blocks (profile/JD/system/mode) são passed através (they're self-authored).
      const body = isUntrusted ? escapeXml(escapeInjection(block.content)) : block.content;
      const currentAttr = block.source === 'live_transcript_current' ? ' current="true"' : '';
      parts.push(`<${tag} trust="${trust}" source="${provenance}"${currentAttr}>\n${body}\n</${tag}>`);
      total += block.tokenEstimate;
      report.push({ source: block.source, tag, trust, provenance, included: true, tokenEstimate: block.tokenEstimate, reason: block.reasonIncluded });
    }

    // Registro o dropped sources em o inclusion report também (fonte tracing).
    for (const d of input.contract.droppedSources || []) {
      const tag = SOURCE_TAG[d.source] || d.source;
      report.push({ source: d.source, tag, trust: 'low', provenance: SOURCE_PROVENANCE[d.source] || 'unknown', included: false, tokenEstimate: 0, reason: d.reason });
    }
  } catch {
    /* nunca lançar — retorna qualquer que seja assembled */
  }

  const contractInstruction = CONTRACT_INSTRUCTIONS[input.answerContract] || CONTRACT_INSTRUCTIONS.general_assistant;

  // Candidate-perspective / no-assistant-identity gproteger
  let perspectiveGuard = '';
  try {
    const v = ProfileTreeService.getCandidatePerspectiveGuard(input.mode, input.query);
    if (v.assistantIdentityWouldLeak) {
      perspectiveGuard = 'You are answering AS the candidate/user in first person. Never say "I am Refract", "I am an AI assistant", or otherwise self-identify as the assistant — the user expects their own identity. (Genuine questions about the app itself are exempt.)';
    }
  } catch { /* keep empty */ }

  return {
    contextXml: parts.join('\n\n'),
    contractInstruction,
    perspectiveGuard,
    inclusionReport: report,
    totalTokenEstimate: total,
  };
}

export { type FusedContextBlock };
