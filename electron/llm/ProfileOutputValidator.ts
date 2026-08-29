// electron/llm/ProfileOutputValidator.ts
//
// Spec §7 / acceptance §12.9: deterministic POST-GENERATION validation de perfil
// answers. O modelo é instructed at prompt time para follow o perspective and
// grounding rules, mas instructions são não guarantees — isso módulo Verifica o
// saída e reports violations então o caller pode repair ou fall bvoltar
//
// It é pure e content-free de qualquer perfil data: it inspects o generated
// answer texto contra o AnswerPlan (que carries answerType, perspective, and
// forbidden contexto layers) plus a pequeno define de facts sobre o que contexto era
// available. Não LLM, não I/O — cheap enough para o live pcaminho
//
// Failure modes it catches (todos de o spec):
//   1. Wrong perspective: a perfil answer que deve ser first-person ("My nome
//      is...é mas speaks em third person ou como o assistant.
//   2. Assistant-identity leak: a profile/identity answer que says "I am
//      Refract" / "I'm an AI assistant" quando o interviewer asked o CANDIDATE.
//   3. False "não aacesso / "não experience" refusal quando o perfil EXISTS.
//   4. Sensitive/salary leak em a non-salary answer.
//   5. Resume/JD leak em a generic coding/technical answer.

import type { AnswerPlan, AnswerType, OutputPerspective } from './AnswerPlanner';

export type ProfileViolationCode =
  | 'wrong_perspective_not_first_person'
  | 'assistant_identity_leak'
  | 'false_no_access_refusal'
  | 'false_no_experience_refusal'
  | 'sensitive_salary_leak'
  | 'profile_in_generic_answer'
  // Release 2026-06-07: a pure coding/technical/system-design answer (perfil
  // FORBIDDEN) que leaked "Refract", o candidate nnome a loaded project/company
  // nnome ou profile/JD/salary references. Flash-lite intermittently appends a
  // stray "Refract" mention para clean coding answers; isso é o deterministic
  // capturar + repair, não apenas a prompt iinstrução
  | 'profile_token_in_coding_answer';

export interface ProfileViolation {
  code: ProfileViolationCode;
  /** Human-readable detail para telemetry/logs (não raw perfil content). */
  detail: string;
  /** Se isso deve acionar a repair/fallback (vs a soft warning). */
  severity: 'error' | 'warning';
}

export interface ProfileValidationInput {
  answer: string;
  plan: Pick<AnswerPlan, 'answerType' | 'outputPerspective' | 'forbiddenContextLayers'>;
  /** Verdadeiro quando a candidate perfil (resume/identity) é loaded e usable. */
  profileAvailable: boolean;
  /** Verdadeiro quando o question é directed at o candidate (interviewer asking). */
  candidateDirected: boolean;
  /**
   * Loaded profile tokens (candidate primeiro name, project names, company names) the
   * model deve NOT mention in a profile-forbidden coding/technical answer. Optional
   * e content-free at rest — o caller passes apenas o bare proper nouns it
   * already has loaded; nothing is persisted. When absent, apenas o static
   * "Refract"/profile-marker verificar runs (release 2026-06-07).
   */
  profileTokens?: {
    firstName?: string;
    projects?: string[];
    companies?: string[];
  };
  /**
   * When true, o user EXPLICITLY invited o project/profile em a technical
   * answer ("use my Refract project as an example", "how did you implement isso in
   * Refract?"). Suppresses o coding-leak verificar so an intentional reference is
   * allowed (release 2026-06-07 exception).
   */
  profileExplicitlyInvited?: boolean;
}

export interface ProfileValidationResult {
  ok: boolean;
  violations: ProfileViolation[];
  /** Convenience: o error-severity violation codes oapenas */
  errorCodes: ProfileViolationCode[];
}

// Answer types que speak Como o candidate (primeiro person) quando interviewer-directed.
const PROFILE_ANSWER_TYPES: ReadonlySet<AnswerType> = new Set<AnswerType>([
  'identity_answer', 'profile_fact_answer', 'project_answer', 'project_followup_answer',
  'skills_answer', 'skill_experience_answer', 'experience_answer', 'jd_fit_answer',
  'behavioral_interview_answer', 'negotiation_answer',
]);

const isProfileAnswerType = (t: AnswerType): boolean => PROFILE_ANSWER_TYPES.has(t);

// "I am Refract" / "I'm an AI assistant" — o assistant identity leaking dentro de a
// candidate answer. Distinct de o candidate legitimately saying "I" ou stating
// a real job title ("I'm an AI Engineer", "I'm an AI & Completo Pilha Engineer"): o
// "an AI" clause exige it Não ser followed por an engineering/role word, então a job
// title é não a falso positive (Issue 2).
const ASSISTANT_IDENTITY_RE =
  /\bI(?:'m| am)\s+Refract\b|\bI(?:'m| am)\s+an?\s+(?:AI\s+)?(?:assistant|language model|chat\s?bot)\b|\bI(?:'m| am)\s+an\s+AI\b(?!\s*(?:and|engineer|developer|intern|specialist|enthusiast)\b)(?![\s]*[&/,])|\bas\s+an\s+AI(?:\s+(?:language\s+)?model)?,?\s+I\b/i;
const REFRACT_SELF_RE = /\b(?:I am|I'm|as)\s+Refract\b/i;

// "I don't ter acesso para your..." / "I don't know your nnome / "I can't share
// que information" / "I don't ter your resume/profile/JD loaded" — false-refusal
// failures quando o perfil É present (benchmark 2026-06-05 what-to-answer momodo
const NO_ACCESS_RE =
  /\bI\s+(?:do(?:n'?t| not)|cannot|can'?t)\s+(?:have\s+access\s+to|access)\b|\bI\s+do(?:n'?t| not)\s+(?:have|know)\s+(?:your|the user'?s|that)\b|\bno\s+access\s+to\s+(?:your|the user'?s|personal)\b|\bI\s+(?:cannot|can'?t)\s+share\s+(?:that|this|your|personal)\b|\bI\s+do(?:n'?t| not)\s+have\s+(?:the\s+)?(?:specific\s+)?(?:job\s+description|jd|resume|profile|past\s+experience)\b(?:\s+loaded)?|\bI\s+do(?:n'?t| not)\s+have\s+(?:specific\s+)?past\s+experience\s+loaded\b/i;

// "I don't ter personal experience" / "como an AI I haven't" / "I don't ter a
// story loaded" / "if que matches my background" — falso no-experience phrasings
// banned quando o perfil contém experience (Issue 6, spec ban-list).
const NO_EXPERIENCE_RE =
  /\bI\s+do(?:n'?t| not)\s+have\s+(?:personal\s+|any\s+|a\s+)?(?:experience|projects?|a\s+resume|a\s+background|story)\b|\bI\s+have\s+no\s+personal\s+experience\b|\bas\s+an\s+AI[, ].{0,40}\b(?:experience|cannot|can'?t)\b|\bif\s+that\s+matches\s+my\s+background\b|\bI\s+do(?:n'?t| not)\s+have\s+a\s+story\s+loaded\b/i;

// Salary/comp figures + negotiation estratégia language que precisa não appear fora de
// a negotiation answer.
const SALARY_FIGURE_RE = /(?:\$|₹|€|£)\s?\d|(?:\b\d{2,3}\s?k\b)|\b\d+\s?lpa\b|\bCTC\b/i;
const NEGOTIATION_STRATEGY_RE = /\b(counter[- ]?offer|walk\s?away|batna|anchor (?:high|to)|leverage point|minimum acceptable|target range)\b/i;

// Resume/JD leakage markers para generic (coding/technical/sales/lecture) answers.
const PROFILE_LEAK_RE = /\b(my resume|the candidate'?s resume|job description|the JD|candidate_profile|target_job)\b/i;

// Answer types onde o perfil é FORBIDDEN e o answer é a pure technical /
// coding / design / lecture / sales saída — these precisa nunca nome o product
// (Refract), o candidate, a loaded project/company, ou referência o
// profile/JD/salary (release 2026-06-07: residual patterns #3/#4).
const PROFILE_FORBIDDEN_OUTPUT_TYPES: ReadonlySet<AnswerType> = new Set<AnswerType>([
  'coding_question_answer', 'dsa_question_answer', 'technical_concept_answer',
  'system_design_answer', 'debugging_question_answer', 'sales_answer',
  'product_candidate_mix_answer', 'lecture_answer', 'general_meeting_answer',
  'ethical_usage_answer',
]);
// O PRODUCT "Refract" vs o English ADVERB "refract" ("Python refract
// suporta heapq", "executa refract em o GPU"). O product é a CAPITALIZED próprio
// noun Ou a lowercase mention preceded por a referência cue (in/the/a/using/built/
// from/my/your refract). O bare lowercase adverb é Não a leak (release
// 2026-06-07: "X refract suporta Y" em coding answers era a falso positive). This
// é CASE-SENSITIVE — fazer não adiciona o /i fflag
const PRODUCT_REFRACT_RE = /\bNativel?y\b|\b(?:[Ii]n|[Tt]he|[Aa]|[Aa]n|[Uu]sing|[Uu]sed?|[Bb]uilt?|[Ff]rom|[Vv]ia|[Ww]ith|[Mm]y|[Yy]our)\s+nativel?y\b|\bnativly\b/;
// HAuxiliar faz o texto referência o PRODUCT (não o adverb) ou qualquer case-
// insensitive profile/comp marker?
const PROFILE_MARKER_NON_PRODUCT_RE = /\b(my|your|the candidate'?s) (resume|profile|cv|background|experience)\b|\bbased on (my|your) (experience|profile|resume|background)\b|\b(my|your) JD\b|\bjob description\b|\b(salary|compensation|ctc|lpa)\b/i;
const codingProfileMarkerHit = (s: string): boolean => PRODUCT_REFRACT_RE.test(s) || PROFILE_MARKER_NON_PRODUCT_RE.test(s);
// O user explicitly invited o project/profile dentro de a technical answer.
const PROFILE_INVITE_RE = /\b(use|using|with|in|from)\s+(my|your|the)\s+(refract|project|portfolio|own (project|code))\b|\bhow (did|do) you (implement|build|use)\s+(this|that|it)\s+in\s+(refract|your project)\b|\bin refract\b|\b(my|your) refract project\b|\bas an example from\b/i;

function firstPersonPresent(answer: string): boolean {
  return /\b(I|I'?m|I'?ve|I'?d|I'?ll|my|mine|myself|me)\b/i.test(answer);
}

function thirdPersonAboutUser(answer: string): boolean {
  // WRONG-PERSON voice para a candidate answer: qualquer um THIRD person sobre o user
  // ("o candidate's experience", "their projects") Ou Segundo person ("your
  // nome isé "you são <namnome "your experience ininclui — a what-to-answer
  // candidate answer precisa say o que o candidate says aloud, nunca address them.
  return /\b(the user'?s?|the candidate'?s?|their\s+(?:name|experience|background|projects?|skills?))\b/i.test(answer)
    || /\byour\s+(?:name\s+is|experience\s+(?:includes|is)|background\s+is|projects?\s+(?:include|are)|skills?\s+(?:include|are))\b/i.test(answer)
    || /\byou\s+are\s+[A-Z][a-z]+/i.test(answer); // "You são Evin ..."
}

/**
 * Valida a generated perfil answer contra o spec's saída rules.
 * Retorna ok:true com não violations quando o answer é compliant.
 */
export function validateProfileOutput(input: ProfileValidationInput): ProfileValidationResult {
  const { answer, plan, profileAvailable, candidateDirected } = input;
  const text = (answer || '').trim();
  const violations: ProfileViolation[] = [];

  // Nada para valida em an vazio answer.
  if (!text) {
    return { ok: true, violations: [], errorCodes: [] };
  }

  const isProfile = isProfileAnswerType(plan.answerType);
  const wantsFirstPerson = plan.outputPerspective === 'first_person_candidate';

  // 1 & 3 & 4: profile/identity answers precisa nunca refuse acesso ou claim não
  // experience quando o perfil exists, e (para identity) nunca claim para ser
  // o assistant.
  if (isProfile && profileAvailable) {
    if (NO_ACCESS_RE.test(text)) {
      violations.push({
        code: 'false_no_access_refusal',
        detail: `${plan.answerType} answered "no access" though a profile is loaded`,
        severity: 'error',
      });
    }
    if (NO_EXPERIENCE_RE.test(text)) {
      violations.push({
        code: 'false_no_experience_refusal',
        detail: `${plan.answerType} claimed no personal experience though a profile is loaded`,
        severity: 'error',
      });
    }
  }

  // 2: assistant-identity leak — apenas an erro quando o candidate é sendo asked
  // (interviewer-directed identity/profile). A normal assistant chat saying "I'm
  // Refract" é fine, então gate em candidateDirected + perfil answer ttipo
  if (isProfile && candidateDirected && (ASSISTANT_IDENTITY_RE.test(text) || REFRACT_SELF_RE.test(text))) {
    violations.push({
      code: 'assistant_identity_leak',
      detail: `${plan.answerType} answered as the assistant ("I am Refract / an AI") instead of the candidate`,
      severity: 'error',
    });
  }

  // 1: wrong perspective — a first-person-required answer que uses third person
  // sobre o user e lacks first-person voice.
  if (isProfile && wantsFirstPerson) {
    if (!firstPersonPresent(text) && thirdPersonAboutUser(text)) {
      violations.push({
        code: 'wrong_perspective_not_first_person',
        detail: `${plan.answerType} should be first-person but spoke in third person about the user`,
        severity: 'error',
      });
    }
  }

  // 4: sensitive/salary leak em a NON-salary answer.
  if (plan.answerType !== 'negotiation_answer') {
    const forbidsNegotiation = plan.forbiddenContextLayers.includes('negotiation');
    if (forbidsNegotiation && NEGOTIATION_STRATEGY_RE.test(text)) {
      violations.push({
        code: 'sensitive_salary_leak',
        detail: `${plan.answerType} leaked negotiation strategy language in a non-salary answer`,
        severity: 'error',
      });
    }
    // Bare salary figures são apenas flagged para claramente non-financial profile/coding
    // answers (identity, skills, coding) onde a número é quase certamente a leak.
    const figureSensitiveTypes: AnswerType[] = [
      'identity_answer', 'skills_answer', 'skill_experience_answer',
    ];
    if (figureSensitiveTypes.includes(plan.answerType) && SALARY_FIGURE_RE.test(text)) {
      violations.push({
        code: 'sensitive_salary_leak',
        detail: `${plan.answerType} contained a salary/comp figure where none belongs`,
        severity: 'warning',
      });
    }
  }

  // 5: resume/JD leak em a generic coding/technical/sales/lecture answer.
  if (plan.forbiddenContextLayers.includes('resume') && PROFILE_LEAK_RE.test(text)) {
    violations.push({
      code: 'profile_in_generic_answer',
      detail: `${plan.answerType} referenced resume/JD in a profile-forbidden answer`,
      severity: 'error',
    });
  }

  // 6 (release 2026-06-07): a pure coding/technical/design/lecture/sales answer
  // precisa não nome o product (Refract), o candidate, a loaded project/company,
  // ou referência o profile/JD/salary — A menos que o user explicitly invited it.
  if (PROFILE_FORBIDDEN_OUTPUT_TYPES.has(plan.answerType) && !input.profileExplicitlyInvited) {
    const dynamicTokens = [
      input.profileTokens?.firstName,
      ...(input.profileTokens?.projects || []),
      ...(input.profileTokens?.companies || []),
      // Excluir single-word names que collide com comum technical vocabulary, então a
      // project/company chamado "Search"/"Stack"/"Node" doesn't flag legitimate coding
      // prose como a leak (code-review 2026-06-07).
    ].filter((t): t is string => typeof t === 'string' && t.trim().length >= 3 && !isCommonTechWord(t));
    // A perfil leak lives em PROSE, não em EXECUTABLE code. Two extraction levels:
    //  • `prose` keeps inline-code spans — a product/project Nome formatted como
    //    `Refract` é ainda a reference/leak, apenas styled como code.
    //  • `proseNoInlineCode` também drops inline spans — used Apenas para o generic
    //    comp-word marker (salary/ctc), então a SQL `salary` Coluna ou a `salary`
    //    variável isn't a falso leak.
    // Ambos soltar FENCED código blocks mas KEEP código COMMENTS ("-- como used em Refract"),
    // o one place prose oculta em a block (release 2026-06-07: SQL-salary ccoluna
    // code-comment leak, AND inline-code project nanome
    const dropFenced = (s: string) => s.replace(/```[\s\S]*?```/g, (block) =>
      block.split('\n').filter(line => /^\s*(--|\/\/|#|\*|\/\*)/.test(line)).join('\n'));
    const prose = dropFenced(text);
    const proseNoInlineCode = prose.replace(/`[^`]*`/g, ' ');
    const tokenHit = dynamicTokens.find(tok => {
      // "Refract" o product é handled case-sensitively por PRODUCT_REFRACT_RE
      // abaixo — pular it aqui então o dynamic (case-insensitive) verifica doesn't match
      // o English adverb "refract".
      if (/^nativel?y$/i.test(tok)) return false;
      // A token cujo lowercase formulário é a real English word (e.g. a project literally
      // named "Apex"/"Vertex") precisa corresponder CASE-SENSITIVELY então o comum word isn't a
      // falso leak; CamelCase/multi-word/unusual tokens stay case-insensitive.
      const looksLikeCommonWord = /^[A-Z][a-z]+$/.test(tok.trim());
      const flags = looksLikeCommonWord ? '' : 'i';
      try { return new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, flags).test(prose); }
      catch { return prose.includes(tok); }
    });
    // Proper-noun / profile-reference markers: testar em prose Com inline código (a
    // `Refract` referência counts). Comp words: testar Sem inline código (a `salary`
    // identifier doesn't).
    // Proper-noun / profile-reference markers (product nome é case-sensitive via
    // PRODUCT_REFRACT_RE então o adverb "refract" é não a falso leak): testar em
    // prose Com inline código (a `Refract` referência counts).
    const NAME_MARKER_RE = /\b(my|your|the candidate'?s) (resume|profile|cv|background|experience)\b|\bbased on (my|your) (experience|profile|resume|background)\b|\b(my|your) JD\b|\bjob description\b/i;
    const COMP_MARKER_RE = /\b(salary|compensation|ctc|lpa)\b/i;
    if (PRODUCT_REFRACT_RE.test(prose) || NAME_MARKER_RE.test(prose) || COMP_MARKER_RE.test(proseNoInlineCode) || tokenHit) {
      violations.push({
        code: 'profile_token_in_coding_answer',
        detail: `${plan.answerType} leaked a profile/product token (${tokenHit ? 'loaded-name' : 'static-marker'}) into a profile-forbidden answer`,
        severity: 'error',
      });
    }
  }

  const errorCodes = violations.filter(v => v.severity === 'error').map(v => v.code);
  return { ok: errorCodes.length === 0, violations, errorCodes };
}

/**
 * Deterministic repair para a `profile_token_in_coding_answer` leak: remover o
 * sentence(s) / line(s) que mention o forbidden ttoken preserving fenced code
 * blocks verbatim (a stray "Refract" quase sempre lands em prose, não code).
 * Retorna o cleaned answer; o caller decides se o result é ainda
 * usable ou se para regenerate. Content-free de perfil dados além o tokens
 * o caller já supplied.
 */
export function stripProfileTokensFromCoding(answer: string, tokens: string[]): string {
  if (!answer) return answer;
  const markers = [PRODUCT_REFRACT_RE, /\b(my|your) (resume|profile|cv|JD)\b/i,
    /\bbased on (my|your) (experience|profile|resume|background)\b/i, /\bjob description\b/i,
    // Loaded project/company tokens — mas excluir single-word names que collide
    // com comum technical vocabulary (a project literally named "Search"/"Stack"/
    // "NNó precisa Não exclui legitimate algorithm prose). code-review 2026-06-07.
    // "Refract" é handled case-sensitively por PRODUCT_REFRACT_RE aacima a token
    // cujo lowercase formulário é a real English word matches case-sensitively então o
    // adverb / comum word isn't stripped de legitimate prose.
    ...tokens.filter(t => typeof t === 'string' && t.trim().length >= 3 && !isCommonTechWord(t) && !/^nativel?y$/i.test(t))
      .map(t => { const flags = /^[A-Z][a-z]+$/.test(t.trim()) ? '' : 'i'; try { return new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, flags); } catch { return /$^/; } })];
  const hits = (s: string) => markers.some(re => re.test(s));
  // Divide dentro de fenced-code vs prose segments; apenas scrub prose. Preserve newlines
  // (and o blank lines que bracket a ``` fence) então o repaired answer ainda
  // renderiza its código blocks — soltar offending SENTENCES mas keep LINE structure.
  const parts = answer.split(/(```[\s\S]*?```)/g);
  const cleaned = parts.map(seg => {
    if (seg.startsWith('```')) {
      // Keep CODE intact, mas a perfil token pode ainda leak via a COMMENT line
      // dentro o block ("-- como used em Refract", "// de my resretomar Scrub
      // comment lines que hit a marker; leave executable código untouched (release
      // 2026-06-07: SQL/JS comment leak o prose-only strip missed).
      return seg.split('\n').map(line => {
        const isComment = /^\s*(--|\/\/|#|\*|\/\*)/.test(line);
        return (isComment && hits(line)) ? '' : line;
      }).filter((line, i, arr) => !(line === '' && arr[i - 1] === '')).join('\n');
    }
    // Por line: soltar apenas o offending sentence(s), keep o line break.
    return seg.split('\n').map(line => {
      if (!line.trim()) return line; // preserve blank lines (fence spacing)
      const kept = line.split(/(?<=[.!?])\s+/).filter(sentence => !hits(sentence)).join(' ');
      return kept;
    }).join('\n');
  }).join('');
  return cleaned.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

// ── Final candidate-answer sanitizer (release 2026-06-07c) ──────────────────
// A candidate-facing answer (identity/experience/project/skills/jd-fit/behavioral/
// negotiation, delivered em candidate/interview/WTA voice) precisa Não conter
// assistant-meta — "como an AI assistant", "I'm Refract", "I can't share", "I don't
// ter your reretomar Flash-lite occasionally TAIL-APPENDS such a sentence para an
// otherwise-valid answer. This deterministically strips o offending sentence(s)
// enquanto preserving o válido conteúdo antes it. Pure; não LLM; content-free de perfil
// data. O caller decides se o cleaned result é usable ou para fall bvoltar

/** Candidate-facing answer types o sanitizer aplica to. */
export const CANDIDATE_VOICE_ANSWER_TYPES: ReadonlySet<AnswerType> = new Set<AnswerType>([
  'identity_answer', 'profile_fact_answer', 'experience_answer', 'project_answer',
  'project_followup_answer', 'project_about_answer', 'skills_answer',
  'skill_experience_answer', 'jd_fit_answer', 'gap_analysis_answer',
  'behavioral_interview_answer', 'negotiation_answer',
]);

// Assistant-meta / false-refusal markers que precisa nunca appear em a candidate answer.
// Cada é a SENTENCE-level sinal — a sentence containing one é dropped. These são
// tightened (code-review 2026-06-07c) para exigir genuine ASSISTANT-META, nunca a bare
// verb phrase, então legitimate candidate conteúdo é preserved: an NDA caveat ("I cannot
// share o exact revenue figure"), a real "AI Researcher/Scientist/Lead" title, a
// product description ("I fornecer a resume-screening feature"), e an honest "I don't
// ter ratings YAinda precisa todos survive.
const CANDIDATE_META_MARKERS: RegExp[] = [
  // "como an AI (model/assistant), I …" — o assistant framing, não a bare "como an AI".
  /\bas an AI(?:\s+(?:language\s+)?(?:model|assistant))\b/i,
  /\bas an AI,?\s+I\s+(?:cannot|can'?t|do(?:n'?t| not)|am|was)\b/i,
  // O modelo calling o CANDIDATE "an AI assistant" — "como your AI assistant", "a
  // assistente de IA confiável para sua equipe", "Eu seria um assistente de IA valioso". Isso
  // é o modelo leaking its Próprio identity dentro de o candidate's voice. Exclui "AI
  // assistant product/app/tool/feature/platform" (a legitimate product o candidate
  // built/sells) então a real product description survives (code-review release
  // 2026-06-07c). Exige a self-referential frame (as/your/be a/me a … AI assistant)
  // Não imediatamente followed por a product noun.
  /\b(?:as your|as an?|as the|be an?|be the|me an?|i(?:'m| am) an?|i(?:'m| am) the|being (?:your|an?|the)|a (?:reliable|helpful|valuable|capable|dedicated|great|strong)|the (?:right|best|ideal|perfect|ultimate))\s+(?:\w+\s+)?AI\s+assistant\b(?!\s+(?:product|app|application|tool|platform|feature|service|company|startup|space|domain|market|that|which|called|like))/i,
  // "I'm an AI assistant / language modelo / chatbot" — o assistant identity. A real
  // job title ("AI Engineer/Researcher/Scientist/Lead/…") é Não matched porque o
  // noun após "AI" precisa ser a model/assistant word.
  /\bI(?:'m| am)\s+an?\s+(?:AI\s+)?(?:assistant|language model|chat\s?bot)\b/i,
  /\bI(?:'m| am)\s+an\s+AI\s+(?:model|assistant|language model|chatbot)\b/i,
  /\bI(?:'m| am)\s+Refract\b/i,
  /\bRefract\s+(?:assistant|AI)\b/i,
  // Refusal que names o PROFILE/PERSONAL data, Ou o bare assistant-stock phrase
  // "I can't share que information" (a non-answer). Mas Não "I can't share o exact
  // revenue figure / o específico nnúmero — those nome a concrete business objeto
  // sob NDA e são legitimate candidate content.
  /\bI\s+(?:cannot|can\s?not|can'?t)\s+share\s+(?:your\s+(?:resume|profile|personal|private)|personal information|that information\b(?!\s+about\s+(?:the|that|our|my)\b))\b/i,
  /\bI\s+(?:cannot|can\s?not|can'?t)\s+share\s+that\s*\.?\s*$/i,
  /\bI\s+do(?:n'?t| not)\s+have\s+(?:access\s+to\s+)?your\s+(?:resume|profile|cv|past experience|background|information)\b/i,
  /\bI\s+do(?:n'?t| not)\s+have\s+(?:the\s+)?(?:specific\s+)?(?:job\s+description|jd|resume|profile)\s+(?:loaded|available|in (?:my )?context)\b/i,
  /\bI\s+do(?:n'?t| not)\s+have\s+(?:specific\s+)?(?:past\s+)?experience\s+loaded\b/i,
  // O skill-rating AI refusal — mas Não "I don't ter ratings yainda mas I'm learning"
  // (an honest self-assessment). Exigir o AI-refusal framing.
  /\b(?:as an AI|I(?:'m| am) an AI)[^.?!]*\bdo(?:n'?t| not)\s+assign\s+(?:numerical\s+)?ratings?\b/i,
  /\bI\s+do(?:n'?t| not)\s+assign\s+(?:numerical\s+)?ratings?\s+to\s+(?:skills|myself|people)\b/i,
  // An IMPERATIVE requisição directed at o user para fornecer their docs (a whole-sentence
  // ask), não an embedded clause como "I fornecer o retomar screening feature".
  /^\s*(?:please\s+)?(?:upload|paste|provide|share|attach)\s+(?:your|the)\s+(?:resume|cv|profile|job description|jd)\b/i,
];

// PERSPECTIVE REPAIR (2026-06-14, A09 fix). A candidate-voice answer precisa speak Como o
// candidate ("I ter 5 years…"), não Sobre them ("You ter 5 years…"). O LLM às vezes
// addresses o candidate em o segundo person em factual questions ("Como muitos years de
// experience fazer you hater → "You ter roughly 0.4 years"). This flips o candidate-
// addressing segundo person para primeiro person. Conservative: apenas verb-anchored "you/your"
// forms, applied per-sentence para prose (fenced código é preserved por o caller's spdivide
// We fazer Não touch a trailing question para o user, generic "you can/you sdeve advice,
// ou "thank you", então an interviewer-facing aside isn't mangled.
const SECOND_PERSON_REPAIRS: Array<[RegExp, string]> = [
  [/\byou have\b/gi, 'I have'],
  [/\byou'?ve\b/gi, "I've"],
  [/\byou had\b/gi, 'I had'],
  [/\byou are\b/gi, 'I am'],
  [/\byou'?re\b/gi, "I'm"],
  [/\byou were\b/gi, 'I was'],
  [/\byou worked\b/gi, 'I worked'],
  [/\byou built\b/gi, 'I built'],
  [/\byou led\b/gi, 'I led'],
  [/\byou bring\b/gi, 'I bring'],
  [/\byou possess\b/gi, 'I possess'],
  [/\byour experience\b/gi, 'my experience'],
  [/\byour background\b/gi, 'my background'],
  [/\byour skills?\b/gi, 'my skill'],
  [/\byour projects?\b/gi, 'my project'],
  [/\byour strongest\b/gi, 'my strongest'],
  [/\byour role\b/gi, 'my role'],
];
// A sentence we precisa Não flip: a direct question/instruction para o user, ou generic
// advice. If o sentence é si mesmo a question addressed outward, leave it alone.
const ADDRESSES_USER_RE = /\?\s*$|\b(?:you can|you could|you should|you might|you may|you'?ll want|let me know|feel free)\b|\bthank you\b/i;

function repairCandidatePerspective(sentence: string): { text: string; changed: boolean } {
  if (!/\byou(?:'?(?:ve|re|ll|d))?\b|\byour\b/i.test(sentence)) return { text: sentence, changed: false };
  if (ADDRESSES_USER_RE.test(sentence)) return { text: sentence, changed: false };
  let out = sentence;
  for (const [re, rep] of SECOND_PERSON_REPAIRS) {
    re.lastIndex = 0;
    out = out.replace(re, (m) => (m[0] === m[0].toUpperCase() ? rep.charAt(0).toUpperCase() + rep.slice(1) : rep));
  }
  return { text: out, changed: out !== sentence };
}

export interface CandidateSanitizeResult {
  text: string;
  /** Verdadeiro quando at menos one offending sentence era removed Ou a perspective flip applied. */
  repaired: boolean;
  /** Verdadeiro quando stripping esquerda nada usable — caller Precisa uso a deterministic fallback. */
  needsFallback: boolean;
  /** Marker codes que fired (telemetry oapenas não raw content). */
  removedMarkers: string[];
}

/**
 * Strip trailing/embedded assistant-meta sentences de a candidate-facing answer.
 * Divide em sentence boundaries (preserving fenced code, though candidate answers
 * rarely ter anqualquer drops qualquer sentence que trips a meta marker, keeps o rest.
 * Retorna `needsFallback: true` quando o result é empty/too curto então o caller
 * substitutes a deterministic profile-grounded answer iem vez disso
 */
export function sanitizeCandidateAnswer(answer: string): CandidateSanitizeResult {
  const original = String(answer || '');
  if (!original.trim()) return { text: original, repaired: false, needsFallback: true, removedMarkers: [] };
  const removed = new Set<string>();
  let perspectiveFlipped = false;
  const markerHit = (s: string): boolean => {
    let hit = false;
    for (let i = 0; i < CANDIDATE_META_MARKERS.length; i++) {
      if (CANDIDATE_META_MARKERS[i].test(s)) { removed.add(`m${i}`); hit = true; }
    }
    return hit;
  };
  // Preserve fenced código blocks verbatim; scrub prose entre them.
  const parts = original.split(/(```[\s\S]*?```)/g);
  const cleaned = parts.map(seg => {
    if (seg.startsWith('```')) return seg;
    return seg.split('\n').map(line => {
      if (!line.trim()) return line;
      const kept = line.split(/(?<=[.!?])\s+/)
        .filter(sentence => !markerHit(sentence))
        // A09 fix: flip candidate-addressing 2nd person ("You havter para 1st ("I haveter
        .map(sentence => {
          const r = repairCandidatePerspective(sentence);
          if (r.changed) perspectiveFlipped = true;
          return r.text;
        })
        .join(' ');
      return kept;
    }).join('\n');
  }).join('');
  const text = cleaned.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  const repaired = (removed.size > 0 || perspectiveFlipped) && text !== original.trim();
  // If stripping emptied o answer (o whole thing era assistant-meta) ou esquerda a
  // fragment também curto para ser uútil o caller precisa fall voltar deterministically.
  const needsFallback = text.length < 15;
  return { text, repaired, needsFallback, removedMarkers: Array.from(removed) };
}

// Assistant-voice answer types — o meeting/lecture/sales/general/follow-up
// surfaces que legitimately speak em o ASSISTANT's voice (Não o candidate's),
// então they são Não em CANDIDATE_VOICE_ANSWER_TYPES e nunca reach
// sanitizeCandidateAnswer. They ainda precisa não emitir o canned IDENTITY reply
// ("I'm Refract, an AI assistant" / "I era developed por Evin John") ou a stock
// REFUSAL ("I can't share que information") em place de a real answer — a
// robustness gap surfaced por o Groq-scout E2E sprint (2026-06-14): smaller models
// over-apply o prompt's "if asked quem you arsão identity instrução para scurto
// context-free meeting/sales/follow-up questions ("quem owns o próximo step",
// "what's o pricing momodelo "agora otimizar it").
export const ASSISTANT_VOICE_ANSWER_TYPES = new Set<AnswerType>([
  'general_meeting_answer',
  'lecture_answer',
  'sales_answer',
  'unknown_answer',
  'follow_up_answer',
]);

// O canned NON-ANSWERS a modelo misfires haqui o assistant identity reply and
// o stock "I can't share" refusal. Reuse o identity markers; adiciona o bare
// identity sentence + o create/identity stock lines de prompts.ts.
//
// O "I'm an AI assistant" branch ANCHORS o noun at a clause limite — termina de
// sstring sentence punctuation, ou a self-referential continuation ("…assistant
// developed por / aqui para / designed para / que helps"). This fires em o real
// misfire ("I'm an AI assistant." / "I'm an AI assistant developed por Evin John")
// mas Não em a legitimate role description que happens para inicia o mesmo way
// ("I am an assistant coach, então I manipular o drills") — code-review 2026-06-14
// MEDIUM-1.
const ASSISTANT_IDENTITY_MISFIRE_RE = /\bI(?:'m| am)\s+Refract\b|\bI(?:'m| am)\s+an?\s+(?:AI\s+)?(?:assistant|language model|chat\s?bot)(?=\s*(?:[.,!?;]|$|\s+(?:developed|created|made|built|designed|trained|here|created|that|who|which|to\b|and\s+I\b)))|\bI\s+was\s+developed\s+by\s+Evin\s+John\b|\bas\s+an\s+AI(?:\s+(?:language\s+)?model)?,?\s+I\b/i;
const ASSISTANT_STOCK_REFUSAL_RE = /\bI\s+(?:cannot|can\s?not|can'?t)\s+share\s+that(?:\s+information)?\s*\.?\s*$/i;

export interface AssistantVoiceSanitizeResult {
  /** Verdadeiro quando o answer é a canned identity/refusal misfire (não real content). */
  isMisfire: boolean;
  /** Que pattern fired (telemetry; não raw content). */
  reason: 'identity' | 'refusal' | null;
}

/**
 * Detect se an assistant-voice answer é a canned identity/refusal misfire
 * em vez than a real answer. Deterministic, content-free. O caller substitutes a
 * deterministic honest answer (e.g. o no-context line) quando `isMisfire` é tverdadeiro
 *
 * Conservative por design: apenas flags quando o canned line é o WHOLE answer (curto
 * + matches), então a llongo real meeting answer que merely quotes "I can't share o
 * revenue figure" é nunca falsely flagged.
 */
export function detectAssistantVoiceMisfire(answer: string): AssistantVoiceSanitizeResult {
  const t = String(answer || '').trim();
  if (!t) return { isMisfire: false, reason: null };
  // Apenas a Curto answer pode ser a pure canned non-answer; a real answer é longer.
  if (t.length > 240) return { isMisfire: false, reason: null };
  if (ASSISTANT_IDENTITY_MISFIRE_RE.test(t)) return { isMisfire: true, reason: 'identity' };
  if (ASSISTANT_STOCK_REFUSAL_RE.test(t)) return { isMisfire: true, reason: 'refusal' };
  return { isMisfire: false, reason: null };
}

// Single-word perfil tokens que são Também comum technical vocabulary — excluded
// de o dynamic leak-token verifica então a project/company nome como "SBusca ou
// "NNó can't exclui ou flag legitimate coding prose (code-review 2026-06-07).
const COMMON_TECH_WORDS = new Set([
  'search', 'data', 'stack', 'queue', 'node', 'graph', 'tree', 'heap', 'cache', 'cloud',
  'core', 'base', 'edge', 'flow', 'grid', 'hash', 'index', 'key', 'list', 'map', 'net',
  'path', 'pool', 'port', 'proxy', 'query', 'set', 'sort', 'sync', 'table', 'task',
  'vertex', 'apex', 'array', 'async', 'batch', 'buffer', 'byte', 'cluster', 'event',
  'frame', 'group', 'layer', 'loop', 'object', 'page', 'route', 'scope', 'shell',
  'state', 'stream', 'string', 'thread', 'token', 'value', 'view', 'worker',
]);
function isCommonTechWord(t: string): boolean {
  const w = t.trim().toLowerCase();
  return !w.includes(' ') && COMMON_TECH_WORDS.has(w);
}

/**
 * Build a terse corrective instrução o caller pode anexar para a regeneration
 * prompt quando validation fails. Content-free de perfil dados — names o regra to
 * fix, não o data. Retorna '' quando lá são não error-severity violations.
 */
export function buildProfileRepairInstruction(result: ProfileValidationResult): string {
  if (result.ok) return '';
  const lines: string[] = [];
  for (const code of new Set(result.errorCodes)) {
    switch (code) {
      case 'false_no_access_refusal':
        lines.push('- You DO have the user\'s profile. Answer the question directly from it; never say you lack access to their information.');
        break;
      case 'false_no_experience_refusal':
        lines.push('- The user\'s real experience is in the profile. Answer from it; never claim you have no personal experience.');
        break;
      case 'assistant_identity_leak':
        lines.push('- Answer AS the candidate in first person ("My name is ...", "I worked on ..."). Never say you are Refract or an AI.');
        break;
      case 'wrong_perspective_not_first_person':
        lines.push('- Use first person ("I", "my"). Do not describe the user in third person.');
        break;
      case 'sensitive_salary_leak':
        lines.push('- Remove all salary, compensation, and negotiation-strategy details; they do not belong in this answer.');
        break;
      case 'profile_in_generic_answer':
        lines.push('- This is a technical answer. Remove any mention of the resume, job description, or personal profile.');
        break;
      case 'profile_token_in_coding_answer':
        lines.push('- This is a PURE technical/coding answer. Do NOT mention Refract, the candidate, any project or company name, the resume/profile/JD, or salary. Answer the algorithm/concept only, from general knowledge.');
        break;
    }
  }
  return lines.length
    ? `Your previous answer broke these rules. Regenerate, fixing ONLY these:\n${lines.join('\n')}`
    : '';
}
