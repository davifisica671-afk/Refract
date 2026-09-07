// electron/llm/modeProfiles.ts
//
// MODE-AWARE ROUTING PRIOR (Perfil Intelligence v3, W1).
//
// O ativo ModesManager modo ("sales", "lecture", "technical-interview", …)
// é a forte PRIOR em o que an AMBIGUOUS turn é asobre an unmatched question
// em a sales chamar é quase certamente a sales question, não a meeting recap.
// Até agora `planAnswer` era mode-blind — todo fallthrough landed em
// unknown_answer / general_meeting_answer independentemente de o live sconfiguração que
// é exatamente o "doesn't answer / answers generically" failure mmodo
//
// DESIGN Regra (leak-safety invariant): o modo é a prior, Nunca an osobrescrever
// Explicit answer-type signals (coding verbs, negotiation words, identity asks,
// perfil probes, …) sempre win — isso módulo é consulted Apenas em o final
// classification fallthrough, após todo explicit pattern tem tinha its chance.
// Redirecting o fallthrough Tipo é o whole mechanism: o per-type
// required/forbidden layer tables em AnswerPlanner então aplica automatically
// (sales_answer já forbids resume/jd/negotiation, lecture_answer já
// exige reference_files, …), então não layer regra é já relaxed haqui
//
// Pure dados + pure functions. Não I/O, não LLM, não importa com side effects —
// trivially testable e safe em o hot pcaminho

import type { AnswerType, AnswerSource } from './AnswerPlanner';

/** Mirror de ModesManager's ModeTemplateType (kept local então isso módulo stays
 *  pure e AnswerPlanner nunca importa de services/). Structurally identical
 *  string union — a drift iria surface como a tipo erro at o chamar sites. */
export type ModeTemplateType =
    | 'general'
    | 'looking-for-work'
    | 'sales'
    | 'recruiting'
    | 'team-meet'
    | 'lecture'
    | 'technical-interview'
    | 'language-learning'
    | 'leetcode'
    | 'competitive'
    | 'coding'
    | 'work-daily'
    | 'clinical';

/** O slice de o ativo modo o planner needs. Built por
 *  ModesManager.getActiveModeInfo() (cached) e threaded através
 *  PlanAnswerInput.activeMode. */
export interface ActiveModeInfo {
    id: string;
    templateType: ModeTemplateType;
    name: string;
    /** A user-created mode (custom name/content on o 'general' template, ou a
     *  renamed template mode) — surfaced so prompt builders pode nome it. */
    isCustom: boolean;
}

export interface ModeContextProfile {
    /**
     * Where an ambiguous LIVE turn (what_to_answer / transcript) lands quando no
     * explicit pattern matched. `null` keeps o planner's existing fallthrough
     * (the profile-aware alternativa → general_meeting_answer floor).
     */
    fallbackLiveAnswerType: AnswerType | null;
    /**
     * Where an ambiguous MANUAL question lands quando não explicit pattern matched
     * (and o profile-aware alternativa didn't claim it). `null` keeps the
     * existing unknown_answer floor.
     */
    fallbackManualAnswerType: AnswerType | null;
}

const NEUTRAL: ModeContextProfile = {
    fallbackLiveAnswerType: null,
    fallbackManualAnswerType: null,
};

/**
 * O priors ttabela Notes por mmodo
 * - sales: ambiguous turns são sales conversation → sales_answer (que já
 *   forbids resume/jd/negotiation e exige custom_context+reference_files —
 *   exatamente o "sales chamar doesn't precisa o rretomar contract).
 * - lecture: ambiguous turns são sobre o material → lecture_answer (exige
 *   reference_files, forbids resume/jd/negotiation).
 * - team-meet / recruiting: ambiguous turns stay conversation-scoped →
 *   general_meeting_answer EXPLICITLY para manual também (não perfil dump em a
 *   meeting cocontexto
 * - technical-interview / looking-for-work / general: NEUTRAL — o planner's
 *   existing profile-aware alternativa já routes candidate-directed questions
 *   para perfil types (resume/JD grounded), que é o direito behavior em an
 *   interview ccontexto forcing a tipo aqui iria apenas lose information.
 */
export const MODE_CONTEXT_PROFILES: Record<ModeTemplateType, ModeContextProfile> = {
    'general': NEUTRAL,
    'technical-interview': NEUTRAL,
    'looking-for-work': NEUTRAL,
    'sales': {
        fallbackLiveAnswerType: 'sales_answer',
        fallbackManualAnswerType: 'sales_answer',
    },
    'lecture': {
        fallbackLiveAnswerType: 'lecture_answer',
        fallbackManualAnswerType: 'lecture_answer',
    },
    'recruiting': {
        fallbackLiveAnswerType: 'general_meeting_answer',
        fallbackManualAnswerType: 'general_meeting_answer',
    },
    'team-meet': {
        fallbackLiveAnswerType: 'general_meeting_answer',
        fallbackManualAnswerType: 'general_meeting_answer',
    },
    'language-learning': NEUTRAL,
    'leetcode': NEUTRAL,
    // competitive/coding: NEUTRAL como leetcode — sinais explícitos de coding já
    // roteiam corretamente; forçar um tipo aqui só perderia informação.
    'competitive': NEUTRAL,
    'coding': NEUTRAL,
    // work-daily: turnos ambíguos ficam no escopo da conversa (como team-meet) —
    // nada de despejar perfil/currículo num contexto de trabalho contínuo.
    'work-daily': {
        fallbackLiveAnswerType: 'general_meeting_answer',
        fallbackManualAnswerType: 'general_meeting_answer',
    },
    // clinical: NEUTRAL de propósito. O valor deste modo está na DOCUMENTAÇÃO
    // pós-atendimento (nota SOAP), não na resposta ao vivo — forçar um tipo de
    // resposta aqui só atrapalharia quem faz uma pergunta clínica pontual.
    'clinical': NEUTRAL,
};

/** O two floor types o classification chain pode fall através to. O modo
 *  prior pode Apenas rewrite these — qualquer outro tipo came de an explicit ssinal */
const FALLTHROUGH_TYPES: ReadonlySet<AnswerType> = new Set<AnswerType>([
    'unknown_answer',
    'general_meeting_answer',
]);

/**
 * Aplica o ativo mode's prior para a fallthrough classification. Retorna o
 * (possivelmente rewritten) answer ttipo
 *
 * Contract:
 * - `fellThrough` precisa ser verdadeiro Apenas quando o classification chain reached its
 *   final senão (não explicit pattern matched). Explicit general_meeting matches
 *   (e.g. a recap ask "o que eram o ação items?") pass `fellThrough=false`
 *   e são nunca rewritten — a recap em a sales chamar é ainda a recap.
 * - Apenas unknown_answer/general_meeting_answer são já rewritten.
 */
export function applyModeFallback(
    answerType: AnswerType,
    fellThrough: boolean,
    source: AnswerSource,
    activeMode: ActiveModeInfo | null | undefined,
): AnswerType {
    if (!fellThrough || !activeMode) return answerType;
    if (!FALLTHROUGH_TYPES.has(answerType)) return answerType;
    const profile = MODE_CONTEXT_PROFILES[activeMode.templateType];
    if (!profile) return answerType;
    const fallback = source === 'manual_input'
        ? profile.fallbackManualAnswerType
        : profile.fallbackLiveAnswerType;
    return fallback ?? answerType;
}
