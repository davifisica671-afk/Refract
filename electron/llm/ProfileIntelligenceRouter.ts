// electron/llm/ProfileIntelligenceRouter.ts
//
// Spec §3/§10: O único deterministic decision layer. Para qualquer incoming live
// entrada X, calcula one auditable ProfileIntelligenceDecision Antes o LLM call:
// se para uso o pperfil de que perspective, que contexto types to
// iincluir que para eexcluir e se sensitive contexto é allowed.
//
// This é a thin, PURE facade que composes o modules que já exist —
// planAnswer (answer-type classifier) + buildContextRoute (contexto selector) +
// o answer-type → ProfileContextType projection — dentro de o exact shape o spec
// names. Não LLM, não I/O. It faz não Substituir o existing pipeline; it gives o
// three live entry points (manual chat, what-to-answer, knowledge intercept) and
// o eval one canonical decision objeto para converge em e assert acontra

import { planAnswer } from './AnswerPlanner';
import type { AnswerType, AnswerSource, SpeakerPerspective, ContextLayer, ProfileContextPolicy } from './AnswerPlanner';
import type { ActiveModeInfo } from './modeProfiles';
import { buildContextRoute } from './contextRoute';

// O spec's ProfileContextType vocabulary (§3).
export type ProfileContextType =
  | 'identity'
  | 'resume_summary'
  | 'experience'
  | 'projects'
  | 'skills'
  | 'education'
  | 'achievements'
  | 'star_stories'
  | 'job_description'
  | 'company_context'
  | 'gap_analysis'
  | 'mock_questions'
  | 'negotiation_strategy'
  | 'salary_context'
  | 'custom_context_pinned'
  | 'custom_context_searchable'
  | 'custom_context_sensitive'
  | 'reference_files'
  | 'live_transcript'
  | 'screen_context'
  | 'ai_persona_style';

export type AnswerPerspective =
  | 'first_person_user'
  | 'assistant_coach'
  | 'third_person_summary'
  | 'generic_ai';

export interface ProfileIntelligenceDecision {
  shouldUseProfile: boolean;
  reason: string;
  answerType: AnswerType;
  answerPerspective: AnswerPerspective;
  /**
   * The plan's profile-context POLICY (Phase 2): necessário | allowed | forbidden.
   * Disambiguates `shouldUseProfile` para audits — e.g. negotiation is a
   * candidate-voice profile answer (shouldUseProfile may be true) mas its policy
   * is `allowed`, não `required` (profile is leverage, não o subject).
   */
  profileContextPolicy: ProfileContextPolicy;
  profileContextTypes: ProfileContextType[];
  excludedContextTypes: ProfileContextType[];
  sensitiveContextAllowed: boolean;
  confidence: number;
  fallbackBehavior: string;
}

export interface DecideProfileInput {
  question: string;
  source: AnswerSource;
  speakerPerspective?: SpeakerPerspective;
  /**
   * Active mode TEMPLATE id (general | sales | team-meet | technical-interview |
   * lecture | recruiting | looking-for-work). PI v3 (W1): now a live routing
   * prior — threaded em planAnswer's mode fallback. A completo ActiveModeInfo can
   * be passed via `activeModeInfo` para custom-mode awareness; isso string form
   * is kept para backward compatibility com existing callers/evals.
   */
  activeMode?: string;
  /** Completo active-mode info (preferred sobre `activeMode` quando ambos são sedefine */
  activeModeInfo?: ActiveModeInfo | null;
  /** Se a usable candidate perfil (resume/identity) é loaded. */
  profileAvailable?: boolean;
  /** Se a JD é loaded. */
  jdAvailable?: boolean;
}

const MODE_TEMPLATE_TYPES: ReadonlySet<string> = new Set([
  'general', 'looking-for-work', 'sales', 'recruiting', 'team-meet', 'lecture', 'technical-interview',
]);

/** Normalizar o legacy string formulário dentro de ActiveModeInfo (unknown ids → null). */
function toActiveModeInfo(input: DecideProfileInput): ActiveModeInfo | null {
  if (input.activeModeInfo) return input.activeModeInfo;
  const id = (input.activeMode || '').trim();
  if (!id || !MODE_TEMPLATE_TYPES.has(id)) return null;
  return { id, templateType: id as ActiveModeInfo['templateType'], name: id, isCustom: false };
}

// Answer types que speak como o candidate em primeiro person quando interviewer-asked.
const PROFILE_ANSWER_TYPES: ReadonlySet<AnswerType> = new Set<AnswerType>([
  'identity_answer', 'profile_fact_answer', 'project_answer', 'project_followup_answer',
  'skills_answer', 'skill_experience_answer', 'experience_answer', 'jd_fit_answer',
  'behavioral_interview_answer', 'negotiation_answer',
]);

// Mapa o planner's ContextLayer vocabulary para o spec's richer
// ProfileContextType vocabulary. A único layer pode expandir para vários types
// (e.g. retomar → resume_summary/experience/projects/skills/education).
const LAYER_TO_TYPES: Record<ContextLayer, ProfileContextType[]> = {
  stable_identity: ['identity'],
  resume: ['resume_summary', 'experience', 'projects', 'skills', 'education', 'achievements'],
  jd: ['job_description'],
  custom_context: ['custom_context_pinned', 'custom_context_searchable'],
  ai_persona: ['ai_persona_style'],
  negotiation: ['negotiation_strategy', 'salary_context'],
  reference_files: ['reference_files'],
  live_transcript: ['live_transcript'],
  prior_assistant_responses: [],
  active_mode: [],
  screen_context: ['screen_context'],
  preferred_language: [],
};

const ALL_PROFILE_CONTEXT_TYPES: ProfileContextType[] = [
  'identity', 'resume_summary', 'experience', 'projects', 'skills', 'education',
  'achievements', 'star_stories', 'job_description', 'company_context',
  'gap_analysis', 'mock_questions', 'negotiation_strategy', 'salary_context',
  'custom_context_pinned', 'custom_context_searchable', 'custom_context_sensitive',
  'reference_files', 'live_transcript', 'screen_context', 'ai_persona_style',
];

function expandLayers(layers: ContextLayer[]): Set<ProfileContextType> {
  const out = new Set<ProfileContextType>();
  for (const layer of layers) {
    for (const t of LAYER_TO_TYPES[layer] || []) out.add(t);
  }
  return out;
}

function perspectiveFor(answerType: AnswerType, speakerPerspective: SpeakerPerspective, source: AnswerSource): AnswerPerspective {
  // Generic technical / coding / sales / lecture / meeting → generic_ai voice.
  const genericTypes: AnswerType[] = [
    'coding_question_answer', 'dsa_question_answer', 'technical_concept_answer',
    'system_design_answer', 'debugging_question_answer', 'sales_answer',
    'lecture_answer', 'general_meeting_answer',
  ];
  if (genericTypes.includes(answerType)) return 'generic_ai';

  // Negotiation em a live configuração é coach-style guidance; elsewhere primeiro person.
  if (answerType === 'negotiation_answer' && source === 'what_to_answer') {
    return 'assistant_coach';
  }

  // Perfil answers: primeiro person quando o candidate é sendo asked (interviewer
  // ou a live what-to-answer turn); caso contrário o assistant explains em segundo
  // person para o user (manual chat "your nome é ...").
  if (PROFILE_ANSWER_TYPES.has(answerType)) {
    if (speakerPerspective === 'interviewer' || source === 'what_to_answer' || source === 'transcript') {
      return 'first_person_user';
    }
    // Manual chat sobre o user's próprio facts → answer factually (o assistant
    // tells o user sobre themselves). Treated como first_person_user para o
    // candidate-voice live uuso mas assistant_coach quando o user asks "me".
    return 'first_person_user';
  }

  return 'generic_ai';
}

/**
 * O único decision ffunção Pure, deterministic, cheap. Retorna o spec's
 * ProfileIntelligenceDecision então qualquer caller (ou eval) pode see exatamente o que
 * perfil contexto vai e vai não ser used, e wpor que
 */
export function decideProfileIntelligence(input: DecideProfileInput): ProfileIntelligenceDecision {
  const plan = planAnswer({
    question: input.question,
    source: input.source,
    speakerPerspective: input.speakerPerspective,
    hasCandidateProfile: input.profileAvailable,
    hasJobDescription: input.jdAvailable,
    activeMode: toActiveModeInfo(input),
  });
  const route = buildContextRoute(plan);

  const answerType = plan.answerType;
  const isProfileType = PROFILE_ANSWER_TYPES.has(answerType);

  // shouldUseProfile: a perfil answer tipo AND o retomar layer é não forbidden.
  // Coding/technical/sales/lecture forbid retomar → false. Honest sobre availability.
  const resumeForbidden = plan.forbiddenContextLayers.includes('resume');
  const shouldUseProfile = isProfileType && !resumeForbidden;

  // Sensitive (salary/negotiation) contexto apenas para negotiation answers (spec §8).
  const sensitiveContextAllowed = answerType === 'negotiation_answer';

  // Build o included / excluded ProfileContextType define de o rrotea
  const included = expandLayers(route.selectedLayers);
  // Custom contexto sensitive é allowed apenas para negotiation; reflect that.
  if (sensitiveContextAllowed && route.selectedLayers.includes('custom_context')) {
    included.add('custom_context_sensitive');
  }
  // Negotiation answers também surface company + gap + salary intelligence.
  if (answerType === 'negotiation_answer') {
    included.add('company_context');
    included.add('salary_context');
  }
  // Behavioral answers surface STAR stories.
  if (answerType === 'behavioral_interview_answer') {
    included.add('star_stories');
  }
  // jd_fit surfaces company contexto + gap analysis.
  if (answerType === 'jd_fit_answer') {
    included.add('company_context');
    included.add('gap_analysis');
  }

  const profileContextTypes = ALL_PROFILE_CONTEXT_TYPES.filter(t => included.has(t));
  const excludedContextTypes = ALL_PROFILE_CONTEXT_TYPES.filter(t => !included.has(t));

  const answerPerspective = perspectiveFor(answerType, plan.speakerPerspective, input.source);

  const reason = shouldUseProfile
    ? `${answerType}: profile used (${profileContextTypes.length} context types)`
    : `${answerType}: profile NOT used (${resumeForbidden ? 'resume forbidden for this answer type' : 'non-profile answer type'})`;

  const fallbackBehavior = input.profileAvailable === false && isProfileType
    ? 'profile_missing_admit_no_data'
    : shouldUseProfile
      ? 'ground_in_profile'
      : 'answer_without_profile';

  return {
    shouldUseProfile,
    reason,
    answerType,
    answerPerspective,
    profileContextPolicy: plan.profileContextPolicy,
    profileContextTypes,
    excludedContextTypes,
    sensitiveContextAllowed,
    confidence: plan.confidence,
    fallbackBehavior,
  };
}
