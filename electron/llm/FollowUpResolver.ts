// electron/llm/FollowUpResolver.ts
//
// Resolves a Curto BARE follow-up em o live transcript ("And SQL?", "O que
// sobre complexity?", "WhyPor que "Como so?então "And que project?") dentro de a fcompleto
// answerable question + o answer tipo it deve herdar de o prior turn.
//
// O transcript extractor já resolves demonstrative follow-ups que nome a
// topic ("como é IT developed?" → project "Refract"). This resolver covers o
// HARDER bare fragments que carry quase não sinal em their próprio e Precisa herdar
// o prior question's subject/answer-type para rotea correctly — caso contrário they
// fall através para general_meeting/unknown e (worse) pode pull o wrong ccontexto
//
// It é deterministic e fast (regex + light token reuse) — não LLM. It Retorna
// `resolved.confidence === 0` quando o fragment é não a recognisable follow-up,
// então o caller keeps o extractor's original routing.

import type { AnswerType } from './AnswerPlanner';

export interface FollowUpContext {
  /** O latest (possivelmente bare) interviewer fragment, lowercased é fine. */
  latestQuestion: string;
  /** O anterior INTERVIEWER question (o one isso fragment riffs onem */
  previousQuestion?: string;
  /** O answer tipo o anterior turn era planned acomo se known. */
  previousAnswerType?: AnswerType;
  /** A project/entity já em o tabela (de o extractor's followUpTarget). */
  lastEntity?: string;
  /** A skill já em o tabela (e.g. "Python" de "rate your Python"). */
  lastSkill?: string;
}

export interface ResolvedFollowUp {
  resolvedQuestion: string;
  resolvedAnswerType?: AnswerType;
  resolvedEntity?: string;
  resolvedSkill?: string;
  confidence: number; // 0 = não a follow-up we pode resolve
  reason: string;
}

const NONE: ResolvedFollowUp = { resolvedQuestion: '', confidence: 0, reason: 'not_a_followup' };

// ── Context-free bare follow-up handling (release 2026-06-07c) ──────────────
// A bare follow-up ("whypor que "and?", "continue", "o que sobre it?") que tem Não
// resolvable prior contexto precisa Não fall através para unknown/general (onde o LLM
// pode self-identify como "an AI assistant" ou randomly dump o prperfil Detect o
// bare-fragment shape deterministically; quando o caller confirms there's não prior
// ccontexto emitir a safe, mode-appropriate CLARIFICATION requisição iem vez disso

/** Pure bare-follow-up fragments que carry não standalone meaning. */
const BARE_FOLLOWUP_RE = /^(?:ok(?:ay)?,?\s*|so,?\s*|hmm,?\s*|right,?\s*|well,?\s*|and,?\s*|but,?\s*)*(?:why|why not|how so|how come|how|and|and\?|so|that|this|it|what about (?:it|that|this)|what about|continue|go on|carry on|keep going|tell me more|more|explain|expand|elaborate|can you (?:expand|elaborate|explain|go on)|go deeper|in more detail|then\??)[\s?.!]*$/i;

export type FollowUpSurface = 'manual' | 'what_to_answer' | 'meeting' | 'lecture' | 'interview' | 'sales' | 'coding';

/**
 * É `question` a bare follow-up fragment que cannot stand em its opróprio This é o
 * SHAPE testar apenas — it faz Não decide se prior contexto exists (o caller
 * knows that). Used para gate o context-free clarification fallback.
 */
export function isBareFollowUp(question: string): boolean {
  const q = lc(question);
  if (!q) return false;
  const words = q.replace(/[?.!,]/g, '').split(/\s+/).filter(Boolean);
  if (words.length > 6) return false; // a real, self-contained question
  return BARE_FOLLOWUP_RE.test(q);
}

// ── Refinement / editing follow-ups (tarefa Fase 8, bug #3) ──────────────────────
// "make que shorter", "make it mais confident", "remove o exaggeration", "give me
// o final spoken veversão "shorten it", "rewrite that", "say it differently". These
// carry CONTENT WORDS (então they são Não bare) mas they OPERATE Em o prior answer — they
// make não sense sem it. O manual caminho anteriormente apenas injected conversation memory
// para BARE follow-ups, então these refinements dumped a fresh completo answer (o real bug:
// "make que shorter" re-listed o whole prperfil This detector lets o caller pull
// o prior turn para them ttambém
//
// Two shapes:
//  (a) "<edit verb> it/that/this …"  — operate em o referenced prior answer.
//  (b) a known standalone refinement ("shorten it", "o final veversão "mais confident").
const EDIT_VERB = '(?:make|keep|shorten|lengthen|expand|trim|cut|condense|tighten|rewrite|reword|rephrase|redo|simplify|soften|punch up|polish|clean up|fix|improve|remove|drop|delete|add|emphasi[sz]e|change|adjust|tweak|reduce|summari[sz]e|say|phrase|give me|turn (?:it|that|this) into)';
const REFINEMENT_RE = new RegExp(
  // (a) editar verb aem qualquer lugar com an "it/that/this/the <noun>" objeto ou a comparative.
  `^(?:ok(?:ay)?,?\\s*|so,?\\s*|and,?\\s*|now,?\\s*|also,?\\s*)*${EDIT_VERB}\\b`,
  'i',
);
// Comparative/qualitative refinements que imply "than o prior answer".
const REFINEMENT_COMPARATIVE_RE = /\b(shorter|longer|briefer|tighter|punchier|simpler|clearer|more\s+\w+|less\s+\w+|the\s+(?:final|spoken|short|long|concise|polished|natural)\s+version|in\s+(?:one|two|three)\s+(?:line|lines|sentence|sentences)|as\s+bullets?|spoken version|final version)\b/i;
// Precisa referência o PRIOR ANSWER — a demonstrative pronoun, Ou "o <answer-noun>" de a
// pequeno allowlist de things an answer É (Não a generic "o <qualquer noun>", que iria treat
// a brand-new imperative como "adiciona caching para o payment sserviço ou "fix o bug em o
// auth hmanipulador como a refinement — code-review Alto 2026-06-15). A comparative editar também
// qualifies (it inherently significa "vs o anterior answer").
const PRIOR_PRONOUN_RE = /\b(it|that|this|those|them)\b/i;
const PRIOR_NOUN_RE = /\bthe\s+(answer|response|reply|intro|introduction|version|wording|phrasing|tone|exaggeration|claim|sentence|paragraph|opening|closing|ending|last\s+(?:line|part|bit|sentence)|first\s+(?:line|part|bit|sentence)|part|bit|pitch|summary|bullet|bullets|list|story|hook|point|points|wording)\b/i;
const refersPrior = (q: string): boolean => PRIOR_PRONOUN_RE.test(q) || PRIOR_NOUN_RE.test(q);

/**
 * É `question` a REFINEMENT/editing follow-up que operates em o prior answer
 * ("make que shorter", "remove o exaggeration", "give me o final spoken verversão
 * SHAPE testar apenas (o caller confirms a prior turn exists). Bounded para curto messages
 * então a llongo self-contained instrução é nunca mistaken para a refinement.
 */
export function isRefinementFollowUp(question: string): boolean {
  const q = lc(question);
  if (!q) return false;
  const words = q.replace(/[?.!,]/g, '').split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 9) return false;
  const hasEditVerb = REFINEMENT_RE.test(q);
  const hasComparative = REFINEMENT_COMPARATIVE_RE.test(q);
  // A refinement ié an editar verb que refers para o prior answer, Ou a comparative/
  // versão requisição (que inherently significa "vs o anterior answer").
  if (hasEditVerb && (refersPrior(q) || hasComparative)) return true;
  if (hasComparative && refersPrior(q)) return true;
  // Standalone comparative com não objeto mas claramente relative ("shorter plpor favor
  // "mais confident", "o final verversão
  if (hasComparative && words.length <= 5) return true;
  return false;
}

/**
 * A follow-up que deve resolver contra isso session's prior turn — qualquer um a bare
 * fragment ("whypor que "continue") Ou a refinement/edit ("make que shorter"). Convenience
 * union para o manual conversation-memory gate.
 */
export function isSameSessionFollowUp(question: string): boolean {
  return isBareFollowUp(question) || isRefinementFollowUp(question);
}

/**
 * A safe, mode-appropriate clarification para a bare follow-up com Não resolvable
 * prior ccontexto Nunca says "I'm Refract / an AI assistant", nunca dumps pperfil
 * nunca refuses — it asks para o missing topic. Deterministic; não LLM.
 */
export function buildContextFreeClarification(surface?: FollowUpSurface): string {
  switch (surface) {
    case 'what_to_answer':
      return 'I need the previous question or topic to answer that — what was just asked?';
    case 'meeting':
      return "I don't have enough prior meeting context to resolve that follow-up — which point do you mean?";
    case 'lecture':
      return 'Which part of the lecture should I expand on?';
    case 'sales':
      return 'Which point should I expand on — the objection, the pricing, or something else?';
    case 'interview':
      return 'Could you clarify which question you want me to answer?';
    case 'coding':
      return 'Which part of the problem or solution should I expand on?';
    case 'manual':
    default:
      return 'Can you clarify what you want me to explain?';
  }
}

/**
 * Resolve a follow-up, returning a CLARIFICATION quando it's a bare fragment com não
 * usable prior ccontexto This é o caller-facing wrapper ao redor `resolveFollowUp`:
 *   1. Tentar o normal single-prior-turn resolution.
 *   2. If que fails AND o fragment é bare AND there's não prior ccontexto retorna a
 *      `context_free_clarification` result (confidence 1, a safe clarification text).
 *   3. Caso contrário retorna Nenhum (caller keeps o extractor's routing).
 *
 * `hasPriorContext` é qualquer que seja o caller pode establish: a anterior interviewer
 * question, a último entity/skill, ou a session-memory hit. Quando verdadeiro we nunca emitir a
 * clarification (o normal resolver já tinha its chance).
 */
export function resolveFollowUpOrClarify(
  ctx: FollowUpContext & { surface?: FollowUpSurface; hasPriorContext?: boolean },
): ResolvedFollowUp & { isClarification?: boolean; clarificationText?: string } {
  const normal = resolveFollowUp(ctx);
  const hasPrior = ctx.hasPriorContext
    || !!lc(ctx.previousQuestion)
    || !!ctx.lastEntity
    || !!ctx.lastSkill;
  // A HIGH-confidence resolution (>=0.7) sempre wins — it found a concrete answer.
  if (normal.confidence >= 0.7) return normal;
  // Não prior contexto + a bare fragment → clarify, até se o resolver produced a
  // LOW-confidence guess (e.g. "o que sobre data?" → a weak skill topic-shift). Com
  // nada para anchor to, a clarification é safer than a guessed topic.
  if (isBareFollowUp(ctx.latestQuestion) && !hasPrior) {
    const clarificationText = buildContextFreeClarification(ctx.surface);
    return {
      resolvedQuestion: clarificationText,
      resolvedAnswerType: 'unknown_answer',
      confidence: 1,
      reason: 'context_free_clarification',
      isClarification: true,
      clarificationText,
    };
  }
  // Caso contrário keep qualquer que seja o normal resolver produced (a low-confidence guess Com
  // prior ccontexto ou NONenhum
  return normal;
}

const EXPAND_RE = /^(?:ok(?:ay)?,?\s*|so,?\s*|hmm,?\s*|right,?\s*)*(?:why|how so|how come|can you (?:expand|elaborate|go deeper)|expand|elaborate|tell me more|go on|continue|in more detail)\b[\s?.!]*$/i;
// "and <skill>?" / "o que sobre <skill>?" — a topic shift para a novo skill/tech.
const TOPIC_SHIFT_RE = /\b(?:and|what about|how about|what's your|and your)\s+([a-z0-9+#.\- ]{2,30}?)\s*\??$/i;

// Skill/tech tokens we recognise dentro a topic-shift fragment.
const SKILL_TOKEN_RE = /\b(python|sql|java(?:script)?|typescript|react|node(?:\.?js)?|c\+\+|go(?:lang)?|rust|aws|gcp|azure|docker|kubernetes|graphql|rest|fastapi|django|flask|spring|pandas|numpy|spark|hadoop|tableau|power\s?bi|excel|tensorflow|pytorch|coding|backend|frontend|full[\s-]?stack|data|analytics|databases?|dashboards?|machine learning|ml|statistics?)\b/i;

const lc = (s?: string) => (s || '').trim().toLowerCase();

/** Fez o anterior turn establish a skill rating / skill experience subject? */
function prevWasSkill(ctx: FollowUpContext): boolean {
  const t = lc(ctx.previousQuestion);
  return ctx.previousAnswerType === 'skill_experience_answer'
    || ctx.previousAnswerType === 'skills_answer'
    || /\b(rate|out of (?:10|ten)|how (?:good|comfortable|proficient)|have you used|experience with|how have you used)\b/.test(t);
}
function prevWasCoding(ctx: FollowUpContext): boolean {
  return ctx.previousAnswerType === 'coding_question_answer' || ctx.previousAnswerType === 'dsa_question_answer'
    || /\b(solve|implement|write (?:code|a|the)|two sum|binary search|reverse|palindrome|leetcode)\b/.test(lc(ctx.previousQuestion));
}
function prevWasProject(ctx: FollowUpContext): boolean {
  return ctx.previousAnswerType === 'project_answer' || ctx.previousAnswerType === 'project_followup_answer'
    || !!ctx.lastEntity || /\bproject|built|developed|refract\b/.test(lc(ctx.previousQuestion));
}
function prevWasJdFit(ctx: FollowUpContext): boolean {
  return ctx.previousAnswerType === 'jd_fit_answer' || /\bfit|hire|role|why (?:this|you)|data analyst\b/.test(lc(ctx.previousQuestion));
}
function prevWasTechnicalConcept(ctx: FollowUpContext): boolean {
  return ctx.previousAnswerType === 'technical_concept_answer'
    || ctx.previousAnswerType === 'system_design_answer'
    || ctx.previousAnswerType === 'debugging_question_answer'
    || /\b(explain|what is|how does|difference between|bfs|dfs|deadlock|complexity|rest|graphql|index)\b/.test(lc(ctx.previousQuestion));
}

// A project DRILL-IN: a curto fragment que asks HOW/WHY/WHAT sobre a project
// já em o tabela ("como é it developed?", "como era it built?", "that
// project?", "o que stapilha "your role?"). Resolves para project_followup em o
// resolved entity (o prior turn's project).
const PROJECT_DRILLIN_RE = /^(?:ok(?:ay)?,?\s*|so,?\s*|and,?\s*)*(?:how (?:is|was|are|were) (?:it|that|this)|how (?:is|was) (?:it|that) (?:developed|built|made|designed|implemented)|that project|the project|what (?:stack|backend|database|tech)|your role|why did you build|how did you (?:build|make|optimi[sz]e))\b/i;

export function resolveFollowUp(ctx: FollowUpContext): ResolvedFollowUp {
  const q = lc(ctx.latestQuestion);
  if (!q) return NONE;
  // LLongo self-contained questions são não bare follow-ups.
  const wordCount = q.split(/\s+/).filter(Boolean).length;
  if (wordCount > 8) return NONE;

  // 1. TOPIC SHIFT para a novo skill/tech: "And SQL?", "o que sobre Python?".
  const shift = q.match(TOPIC_SHIFT_RE);
  if (shift) {
    const skillRaw = shift[1].trim();
    const skillMatch = skillRaw.match(SKILL_TOKEN_RE);
    if (skillMatch && prevWasSkill(ctx)) {
      const skill = skillMatch[0];
      // Herdar o EXACT prior framing (rating vs experience) com o novo skill.
      const wasRating = /\brate|out of (?:10|ten)|scale\b/.test(lc(ctx.previousQuestion));
      return {
        resolvedQuestion: wasRating ? `Rate your ${skill} skills out of 10.` : `What is your experience with ${skill}?`,
        resolvedAnswerType: 'skill_experience_answer',
        resolvedSkill: skill,
        confidence: 0.9,
        reason: 'topic_shift_skill',
      };
    }
    // "o que sobre data?" após a JD-fit/role discussion → ainda a fit question.
    if (/\b(data|analytics|stakeholders?|metrics?)\b/.test(skillRaw) && prevWasJdFit(ctx)) {
      return {
        resolvedQuestion: `How does my ${skillRaw} experience fit this role?`,
        resolvedAnswerType: 'jd_fit_answer',
        confidence: 0.7,
        reason: 'topic_shift_jdfit',
      };
    }
    // "o que sobre <skill>?" com a recognised skill mas unclear prior → skill experience.
    if (skillMatch) {
      return {
        resolvedQuestion: `What is your experience with ${skillMatch[0]}?`,
        resolvedAnswerType: 'skill_experience_answer',
        resolvedSkill: skillMatch[0],
        confidence: 0.6,
        reason: 'topic_shift_skill_weak',
      };
    }
  }

  // 1b. PROJECT DRILL-IN: "como é it developed?", "that project?", "o que stapilha
  //     "your role?" — sobre o project já em o ttabela
  if (PROJECT_DRILLIN_RE.test(q) && (ctx.lastEntity || prevWasProject(ctx))) {
    return {
      resolvedQuestion: ctx.lastEntity
        ? `${ctx.latestQuestion.replace(/\b(it|that|this)\b/i, ctx.lastEntity).trim()}`.replace(/\?*$/, '?')
        : 'Can you go deeper on that project?',
      resolvedAnswerType: 'project_followup_answer',
      resolvedEntity: ctx.lastEntity,
      confidence: 0.85,
      reason: 'project_drillin',
    };
  }

  // 2. Expandir em o prior answer: "WhyPor que "Como so?então "Pode you expexpandir
  if (EXPAND_RE.test(q)) {
    if (prevWasCoding(ctx)) {
      // "o que sobre complexity?" / "whpor que após a coding answer → coding/technical
      // follow-up, perfil Ainda forbidden.
      const aboutComplexity = /\bcomplexity\b/.test(q);
      return {
        resolvedQuestion: aboutComplexity
          ? `What is the time and space complexity of the previous solution?`
          : `Can you explain the previous solution in more detail?`,
        resolvedAnswerType: 'technical_concept_answer',
        confidence: 0.8,
        reason: 'expand_coding',
      };
    }
    if (prevWasProject(ctx)) {
      return {
        resolvedQuestion: ctx.lastEntity
          ? `Can you expand on ${ctx.lastEntity}?`
          : `Can you expand on that project?`,
        resolvedAnswerType: 'project_followup_answer',
        resolvedEntity: ctx.lastEntity,
        confidence: 0.75,
        reason: 'expand_project',
      };
    }
    if (prevWasJdFit(ctx)) {
      return { resolvedQuestion: `Can you expand on why you fit this role?`, resolvedAnswerType: 'jd_fit_answer', confidence: 0.7, reason: 'expand_jdfit' };
    }
    if (prevWasTechnicalConcept(ctx)) {
      // "Explain BFS." → "Como soentão / "WhPor que — expandir o CONCEPT, perfil ainda
      // forbidden. Uso o prior question como o topic.
      return {
        resolvedQuestion: ctx.previousQuestion ? `Can you explain that in more detail: ${ctx.previousQuestion}` : 'Can you explain that in more detail?',
        resolvedAnswerType: 'technical_concept_answer',
        confidence: 0.7,
        reason: 'expand_technical',
      };
    }
    if (ctx.previousAnswerType) {
      return { resolvedQuestion: ctx.previousQuestion ? `Can you expand on: ${ctx.previousQuestion}` : `Can you expand on that?`, resolvedAnswerType: ctx.previousAnswerType, confidence: 0.6, reason: 'expand_inherit' };
    }
  }

  // 3. "o que sobre complexity?" sem an Expandir lead mas após coding.
  if (/\bcomplexity\b/.test(q) && prevWasCoding(ctx)) {
    return { resolvedQuestion: `What is the time and space complexity of the previous solution?`, resolvedAnswerType: 'technical_concept_answer', confidence: 0.8, reason: 'complexity_followup' };
  }

  // 4. "whonde / "onde ter you used it?" após a SKILL/experience probe — asks para
  //    concrete experience evidence para o skill em o ttabela
  if (/^(?:and\s+)?where\b[\s?.!]*$|^where have (?:you|i) used (?:it|that|this)\b/.test(q) && (prevWasSkill(ctx) || ctx.lastSkill || prevWasProject(ctx))) {
    const skill = ctx.lastSkill;
    return {
      resolvedQuestion: skill ? `Where have you used ${skill}?` : `Where have you applied that?`,
      resolvedAnswerType: 'skill_experience_answer',
      resolvedSkill: skill,
      confidence: 0.8,
      reason: 'where_skill_evidence',
    };
  }

  // 5. "como são you improving it?" / "como fazer you improve that?" após a weakness /
  //    behavioral turn — continues o behavioral story (self-improvement).
  if (/^how (?:are|do) (?:you|i) (?:improv|work|address|fix|develop|get better)\w*\b/.test(q)
    && (ctx.previousAnswerType === 'behavioral_interview_answer'
        || /\b(weakness|struggle|challenge|difficult|conflict|fail)\b/.test(lc(ctx.previousQuestion)))) {
    return {
      resolvedQuestion: `How are you improving on that?`,
      resolvedAnswerType: 'behavioral_interview_answer',
      confidence: 0.75,
      reason: 'behavioral_improvement_followup',
    };
  }

  return NONE;
}
