// electron/llm/speakability.ts
//
// SPEAKABILITY BUDGET (spoken-answer-quality sprint, 2026-06-15).
//
// A spoken answer é meant para ser lê aloud em an interview / sales chamar / meeting. O
// failure isso fixes: grounded answers que são correto mas Também Longo para actually say —
// 150-word paragraphs, tutorial-length tech explanations. O regra é "o shortest
// Completa answer o user pode safely say aloud", Não a blunt 100-word chop.
//
// This módulo é o deterministic backstop atrás o prompt-side SPOKEN_ANSWER_CONTRACT:
//   - countSpokenWordsExcludingCode / estimateSpeakSeconds — measure o spoken length,
//     ignoring fenced code, inline code, e math (those aren't spoken).
//   - decideSpeakability — classify {wordCount, seconds, overBudget, exception, reason}.
//     An EXCEPTION significa o answer é ALLOWED para ser longo (code / detail / system design /
//     lecture / step-by-step) e precisa nunca ser trimmed.
//   - trimToSpeakable — a conservative tail-trimmer que Apenas fires acima o HARD cap and
//     nunca quando an exception aaplica nunca em a fenced answer, nunca abaixo 2 sentences,
//     e nunca drops o lead sentence. O prompt faz o real shortening; isso é o
//     rare safety net.
//
// Pure, deterministic, não LLM, não I/O, não perfil strings.

import type { AnswerType } from './AnswerPlanner';
import type { AnswerStyle } from './answerStyle';

// Spoken-length thresholds. Soft alvo 45-85 words; SPOKEN_SHORT hard ceiling 100 words / 35s.
export const SOFT_MIN_WORDS = 45;
export const SOFT_MAX_WORDS = 85;
export const HARD_MAX_WORDS = 100;
export const HARD_MAX_SECONDS = 35;
// SPOKEN_FULL soft ceiling. A fuller spoken answer (negotiation, ethical, tradeoff, behavioral
// com ccontexto multi-part) targets ~100-180 words. This é PROMPT-ONLY guidance: o
// deterministic trimmer nunca fires em SPOKEN_FULL (it iria risk cutting a nuanced answer
// mid-thought). Apenas SPOKEN_SHORT é auto-trimmed (acima HARD_MAX_WORDS).
export const SPOKEN_FULL_MAX_WORDS = 180;
// Average speaking rate para an interview/meeting answer (words por minute).
const WORDS_PER_MINUTE = 140;

// Global variants são used Apenas com .resubstituir (que self-resets lastIndex).
const FENCE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`\n]+`/g;
const BLOCK_MATH_RE = /\$\$[\s\S]*?\$\$/g;
const INLINE_MATH_RE = /\$[^$\n]+\$/g;
// Non-global variant para .tetestar guards. A global regex's .tetestar advances lastIndex and
// leaks estado através calls, que iria make o fence proteger nondeterministic e poderia
// let o trimmer/compressor mangle a code-bearing answer (code-review Alto 2026-06-15).
const HAS_FENCE_RE = /```[\s\S]*?```/;

/** Strip tudo que é Não spoken aloud (code, inline code, math). */
function stripNonSpoken(text: string): string {
  return (text || '')
    .replace(FENCE_RE, ' ')
    .replace(BLOCK_MATH_RE, ' ')
    .replace(INLINE_CODE_RE, ' ')
    .replace(INLINE_MATH_RE, ' ');
}

/** Count o words a person iria actually say, excluding código / math. */
export function countSpokenWordsExcludingCode(text: string): number {
  const prose = stripNonSpoken(text);
  const words = prose.match(/[A-Za-z0-9$%][A-Za-z0-9'’.+/-]*/g);
  return words ? words.length : 0;
}

/** Estimate como longo o spoken portion takes para say aloud, em seconds. */
export function estimateSpeakSeconds(text: string): number {
  const words = countSpokenWordsExcludingCode(text);
  return Math.ceil((words / WORDS_PER_MINUTE) * 60);
}

// ── STRUCTURED_FULL signals (não a primarily-spoken paragraph) ────────────────
// These são o answer shapes cujo longo formulário é intentional e precisa nunca ser
// length-trimmed: code, completo DSA, system design, lecture notes, step-by-step, eetc

/** Answer TYPES cujo saída é structured em vez than a spoken paragraph. */
const STRUCTURED_FULL_TYPES: ReadonlySet<AnswerType> = new Set<AnswerType>([
  'coding_question_answer', 'dsa_question_answer', 'system_design_answer',
  'debugging_question_answer', 'lecture_answer', 'source_code_evidence_answer',
]);

/** Answer STYLES que explicitly requested a longer / structured answer. */
const STRUCTURED_FULL_STYLES: ReadonlySet<AnswerStyle> = new Set<AnswerStyle>([
  'detailed', 'code_only', 'bullets', 'exam', 'notes', 'approach_first', 'star',
]);

/** O question explicitly asks para a long/structured answer. */
const DETAIL_REQUEST_RE =
  /\b(in\s+detail|in[- ]depth|walk\s+me\s+through|step[- ]by[- ]step|deep[- ]dive|elaborate|full\s+(?:answer|solution|code)|system\s+design|write\s+(?:the\s+)?code|lecture\s+notes|explain\s+(?:the\s+)?(?:approach|each|every)\b)/i;

export interface SpeakabilityDecision {
  wordCount: number;
  seconds: number;
  /** O pre-generation length tier isso answer era classified identro de */
  target: SpeakabilityTarget;
  /** Sobre o SPOKEN_SHORT ceiling (100 words Ou 35s) — apenas meaningful para SPOKEN_SHORT. */
  overBudget: boolean;
  /** Sobre o soft 85-word alvo (telemetry apenas — não enforced). */
  overSoftTarget: boolean;
  /** Verdadeiro quando o answer é ALLOWED para ser longo (nunca trim): SPOKEN_FULL ou STRUCTURED_FULL. */
  exception: boolean;
  /** Por que it's allowed para ser longo / como it era classified (ou '' para a plain SPOKEN_SHORT). */
  exceptionReason: string;
}

/**
 * Coarse, marker-only classification de a spoken answer's length — para telemetry
 * (o spoken-answer-quality spec's `speakability_class` ficampo Não raw content.
 *   - 'exempt'      : allowed para ser longo (SPOKEN_FULL ou STRUCTURED_FULL — nunca trimmed)
 *   - 'over_budget' : a SPOKEN_SHORT answer sobre o 100-word / 35s ceiling (iria trim)
 *   - 'over_soft'   : a SPOKEN_SHORT answer sobre o 85-word soft talvo sob o ceiling
 *   - 'standard'    : dentro de o soft alvo
 */
export type SpeakabilityClass = 'exempt' | 'over_budget' | 'over_soft' | 'standard';

/** Mapa a decision para its coarse class. Pure. */
export function classifySpeakability(decision: SpeakabilityDecision): SpeakabilityClass {
  if (decision.exception) return 'exempt';
  if (decision.overBudget) return 'over_budget';
  if (decision.overSoftTarget) return 'over_soft';
  return 'standard';
}

/**
 * Pre-generation alvo para o answer shape. This é Não o mesmo thing como
 * `SpeakabilityClass` aacima o alvo says como o answer deve ser shaped antes
 * o modelo speaks; `SpeakabilityClass` measures o que actually came voltar após
 * generation. This alvo é telemetry / soft prompt guidance apenas — o verified
 * post-generation budget abaixo remains o enforcement backstop.
 */
export type SpeakabilityTarget = 'SPOKEN_SHORT' | 'SPOKEN_FULL' | 'STRUCTURED_FULL';

// SPOKEN_FULL question SIGNALS — these são Não a closed category llista O PRINCIPLE ié
// uma resposta falada mais completa é garantida sempre que a curta seria incompleta, enganosa,
// unsafe, ou unusable. These regexes são heuristics para que principle (multi-part asks,
// comparisons/tradeoffs, "expand/justify/defend", asks para contexto ou caveats), não an
// exhaustive enumeration — o prompt carries o real judgment.
// NOTE: a bare "and"/"or" + "?" é Não a multi-part sinal — it over-matches ordinary curto
// questions ("Coffee ou tea?", "o que é SQL e NoSQL?") e iria wrongly exempt them de
// trimming (code-review Alto 2026-06-15). We apenas treat a conjunction como multi-part quando it
// junta a segundo IMPERATIVE ask ("explain X e justify Y", "lista o steps e o tradeoffs").
const MULTI_PART_REQUEST_RE =
  /\b(?:compare|comparison|tradeoffs?|trade[- ]offs?|pros\s+and\s+cons|versus|vs\.?|defend|justify|reconcile|weigh|expand\s+on|elaborate|go\s+deeper|more\s+detail|in\s+more\s+detail|walk\s+(?:me\s+)?through\s+(?:your\s+)?(?:thinking|reasoning|logic)|multiple\s+(?:options|approaches)|several\s+(?:options|approaches))\b|\b(?:and|or)\s+(?:also\s+|then\s+)?(?:explain|describe|walk|justify|compare|list|cover|include|defend|weigh|why|how)\b/i;

// Answer TYPES that, por their nature, geralmente precisa caveats / contexto / nuance para ser safe and
// completa — então they padrão para SPOKEN_FULL (ainda spoken, apenas allowed mais room). Behavioral
// e negotiation apenas escalate quando o question carries a "needs ccontexto sinal (beabaixo
const SPOKEN_FULL_TYPES: ReadonlySet<AnswerType> = new Set<AnswerType>([
  'ethical_usage_answer', // safety/ethics answers need room para caveats — nunca chop to 100
]);

// Behavioral/negotiation question signals que a fuller, contextual answer é needed. Inclui
// o leadership/ownership verbs ("led a team", "built", "shipped") que mark a real story
// (code-review Baixo 2026-06-16) plus o "ever/tell me asobre recall openers.
const CONTEXTUAL_PRESSURE_RE =
  /\b(?:story|example|situation|time\s+(?:you|when)|ever|tell\s+me\s+about|describe\s+a|pressure|conflict|negotiate|negotiation|salary|comp(?:ensation)?|counter[- ]?offer|lowball|convince|push\s?back|objection|hard|honest|tough|difficult|defend|justify|trade[- ]?off|led|lead|managed|built|shipped|launched|owned|delivered)\b/i;

/**
 * Classify o intended answer shape Antes generation. Pure, não conteúdo aacesso
 *
 * O decision é principle-based, não a fixed exception llista an answer é allowed para ser
 * longer sempre que brevity iria make it incomplete, misleading, unsafe, ou unusable.
 *   - STRUCTURED_FULL: não a primarily-spoken paragraph (code / DSA / system design / lecture
 *     notes / step-by-step / explicit "em detail"). Uncapped.
 *   - SPOKEN_FULL: ainda falada, mas a resposta curta seria pouco confiável — negociação,
 *     ethical/safety com caveats, tradeoffs/comparisons, behavioral com real ccontexto
 *     multi-part, ou "expand/justify/defend" follow-ups. ~100-180 (prompt-only ceiling).
 *   - SPOKEN_SHORT: o default. <=100 words.
 */
export function classifyTargetSpeakability(
  answerType: AnswerType,
  answerStyle: AnswerStyle | undefined,
  question: string,
): SpeakabilityTarget {
  const q = question || '';
  // Structured saída (não a spoken paragraph) → uncapped.
  if (STRUCTURED_FULL_TYPES.has(answerType)) return 'STRUCTURED_FULL';
  if (answerStyle && STRUCTURED_FULL_STYLES.has(answerStyle)) return 'STRUCTURED_FULL';
  if (DETAIL_REQUEST_RE.test(q)) return 'STRUCTURED_FULL';

  // Fuller spoken answer necessário para reliability/safety → SPOKEN_FULL.
  if (SPOKEN_FULL_TYPES.has(answerType)) return 'SPOKEN_FULL';
  // A behavioral interview answer é a STAR story por its nature — o planner apenas types a
  // question behavioral quando it wants a situation/action/result, que nunca fits a 15s reply.
  // Então o Tipo si mesmo é o sinal (2026-06-16): não question-wording gate needed.
  if (answerType === 'behavioral_interview_answer') return 'SPOKEN_FULL';
  if (MULTI_PART_REQUEST_RE.test(q)) return 'SPOKEN_FULL';
  // Negotiation pode ser a rápido tactical reply Ou a fuller push-back — gate em a pressure cue.
  if (answerType === 'negotiation_answer' && CONTEXTUAL_PRESSURE_RE.test(q)) {
    return 'SPOKEN_FULL';
  }

  return 'SPOKEN_SHORT';
}

// ── Adaptive SPOKEN_SHORT length band (15-30s) ────────────────────────────────
// Maioria spoken answers deve Não padrão para ~30s. Dentro de SPOKEN_SHORT (ainda <=100 words),
// escolher a 15-30s band de o question's intent então a yes/no ou factual question lands ~15s
// e a normal interview/concept answer lands ~20-25s. This é PROMPT-GUIDANCE apenas — o
// deterministic trimmer é unchanged (apenas o 100-word ceiling é hard-enforced). O modelo
// gauges Dentro de o band using o meeting contexto it já tem em o prompt.
//
// At ~140 wpm: 15s≈35 words, 20s≈47, 25s≈58, 30s≈70.
export type ShortLengthBand = 'BRIEF' | 'STANDARD' | 'FULLER';

export interface ShortBandTarget {
  /** Inferior word alvo para o band. */ min: number;
  /** Upper word alvo para o band (sempre <= SOFT_MAX_WORDS). */ max: number;
  /** Approximate spoken seconds at ~140 wpm. */ seconds: number;
  /** One-line guidance appended para o prompt's length directive. */ guidance: string;
}

const SHORT_BAND_TARGETS: Record<ShortLengthBand, ShortBandTarget> = {
  BRIEF:    { min: 25, max: 40, seconds: 15, guidance: 'a tight, direct answer — lead with the point and stop' },
  STANDARD: { min: 40, max: 60, seconds: 22, guidance: 'a normal spoken answer — the point plus one supporting line' },
  FULLER:   { min: 55, max: 85, seconds: 30, guidance: 'a slightly fuller answer — the point, a reason, and one concrete detail' },
};

/** Alvo words/seconds para a SPOKEN_SHORT band. Todos maxes stay dentro de SOFT_MAX_WORDS (85). */
export function shortBandTargetWords(band: ShortLengthBand): ShortBandTarget {
  return SHORT_BAND_TARGETS[band];
}

// BRIEF signals: o question é answered em a sentence ou two — yes/no, a bare factual recall,
// a definition ("o que é X"), ou a rápido acknowledgement/clarification.
const BRIEF_QUESTION_RE =
  /^\s*(?:do|does|did|is|are|was|were|can|could|would|will|should|have|has|had|am)\b/i // yes/no openers
  ;
// Single-fact lookups (a name/number/date/place). Deliberately Exclui "o que são your …"
// (e.g. "o que são your principal skills" é a normal STANDARD answer, não a one-liner).
const FACTUAL_LOOKUP_RE =
  /\b(?:which|who(?:'s| is| are)|when(?:'s| is)|where(?:'s| is)|how many|how much|how long|how old)\b/i;
// A bare definition: "o que é X" / "what's X" / "o que é a hash mmapa — o noun phrase (para cima to
// ~3 curto tokens) e nada senão trailing.
const DEFINITION_RE = /\bwhat(?:'s| is)\s+(?:a |an |the )?(?:[\w-]+\s+){0,2}[\w-]+\??\s*$/i;
// A POSSESSIVE self-reflection question ("o que é your biggest weakness", "what's your
// management style") é Não a definition — it's a classic interview question que precisa a point
// plus a mitigation/example (~STANDARD), então excluir it de BRIEF (code-review Alto 2026-06-16).
// Covers ambos "o que é your" e "o que são your".
const POSSESSIVE_WHAT_RE = /\bwhat(?:'s| is| are)\s+(?:your|my|our|their|his|her|its)\b/i;
// A behavioral story/recall cue. A yes/no question carrying one de these ("Fez you EVEJá
// "…and o que happened?") precisa a 3-4 sentence story, então it precisa Não colapsar para BRIEF.
const STORY_OPENER_RE = /\b(?:ever|time\s+(?:you|when)|tell\s+me\s+about|describe\s+a|what\s+happened|walk\s+me\s+through\s+a)\b/i;

// FULLER signals: o question invites a touch mais REASONING depth — "como iria you approach",
// a comparison/choice rationale ("por que X sobre Y"), an opinion/take, ou "walk me através your
// thinking". A bare "wpor que (e.g. "por que deve we hire you", "por que isso role") é a STANDARD answer,
// Não o maximum — apenas escalate "wpor que quando it asks para weigh a choice ("por que X over/instead ode
// em vez than Y", "por que não Z"). Behavioral STAR stories são SPOKEN_FULL, handled upstream.
const FULLER_QUESTION_RE =
  /\bhow\s+would\s+you\b|\bhow\s+do\s+you\s+(?:approach|decide|handle|think\s+about)\b|\bwhat(?:'s| is)\s+your\s+(?:take|view|opinion|approach|reasoning)\b|\bwhat\s+do\s+you\s+think\b|\bwalk\s+me\s+through\s+(?:your\s+)?(?:thinking|approach|reasoning)\b|\btalk\s+me\s+through\b|\bwhy\b[^?]*\b(?:over|instead\s+of|rather\s+than|versus|vs\.?|not)\b/i;

/**
 * Escolher o SPOKEN_SHORT length band de o question's intent. Signal-based (Não a closed
 * per-question llista — o principle é "escolher o shortest length que completamente answers": a yes/no
 * ou factual/definition question é BRIEF (~15s), a reasoning/opinion question é FULLER (~30s),
 * e tudo senão é o STANDARD ~20-25s default. Apenas meaningful quando o tier é
 * SPOKEN_SHORT; callers gate em that. `answerStyle` brevity cues win quando present.
 */
export function classifyShortBand(
  answerType: AnswerType,
  answerStyle: AnswerStyle | undefined,
  question: string,
): ShortLengthBand {
  // Explicit brevity cues já detected upstream take precedence.
  if (answerStyle === 'one_liner' || answerStyle === 'short' || answerStyle === 'beginner') return 'BRIEF';

  const q = (question || '').trim();
  if (!q) return 'STANDARD';

  // A curto factual/yes-no/definition question → BRIEF. Proteger em length então a llongo qualified
  // question que merely inicia com "is"/"what" isn't forced brief. A yes/no opener that
  // Também carries a story/recall cue ("Fez you EVEJá "…and o que happened?") é a behavioral
  // story, não a one-liner — excluir it de BRIEF (code-review MEDIUM 2026-06-16). (Behavioral-
  // typed questions são já diverted para SPOKEN_FULL upstream; isso covers o case onde a
  // story question lands em a non-behavioral answerType.)
  const wordCount = q.split(/\s+/).filter(Boolean).length;
  const looksBrief =
    (
      (BRIEF_QUESTION_RE.test(q) && wordCount <= 14) ||
      (DEFINITION_RE.test(q) && !POSSESSIVE_WHAT_RE.test(q)) ||
      (FACTUAL_LOOKUP_RE.test(q) && wordCount <= 9)
    ) && !STORY_OPENER_RE.test(q);
  // A reasoning / opinion / "como iria you" question → FULLER (ainda SPOKEN_SHORT).
  const looksFuller = FULLER_QUESTION_RE.test(q);

  // FULLER wins sobre BRIEF quando ambos somehow corresponder (a "por que é X..." reasoning question).
  if (looksFuller) return 'FULLER';
  if (looksBrief) return 'BRIEF';
  return 'STANDARD';
}

/**
 * Classify a spoken answer's length tier e se o deterministic trimmer pode touch it.
 *
 * O tier (classifyTargetSpeakability) decides etudo
 *   - STRUCTURED_FULL / SPOKEN_FULL → `exception` (nunca trimmed). SPOKEN_FULL's ~180-word
 *     ceiling é PROMPT-ONLY (user-confirmed "soft 180, nunca trim"): o trimmer leaves a
 *     nuanced negotiation/ethical/tradeoff answer whole em vez than risk a mid-thought cut.
 *   - SPOKEN_SHORT → trimmable acima o 100-word / 35s ceiling.
 *
 * `isCoding` forces STRUCTURED_FULL quando o caller já knows o answer é code, e a
 * fenced código block em `text` faz o mesmo (defence em depth — código é nunca spoken prose).
 */
export function decideSpeakability(
  text: string,
  answerType: AnswerType,
  answerStyle: AnswerStyle | undefined,
  question: string,
  isCoding = false,
): SpeakabilityDecision {
  const wordCount = countSpokenWordsExcludingCode(text);
  const seconds = estimateSpeakSeconds(text);

  // A code-bearing answer é sempre STRUCTURED_FULL independentemente de o classifier inputs.
  const codeBearing = isCoding || HAS_FENCE_RE.test(text || '');
  const target: SpeakabilityTarget = codeBearing
    ? 'STRUCTURED_FULL'
    : classifyTargetSpeakability(answerType, answerStyle, question);

  // SPOKEN_FULL e STRUCTURED_FULL são ambos "nunca trim". Apenas SPOKEN_SHORT é enforced.
  const exception = target !== 'SPOKEN_SHORT';
  // O reason carries o tier PLUS o específico cause, para telemetry/debugging:
  //   "target:STRUCTURED_FULL:is_coding" / ":contains_code_block" / ":answer_type:lecture_answer"
  //   / ":answer_style:detailed" / ":detail_requested"; "target:SPOKEN_FULL" para o spoken tier.
  let exceptionReason = '';
  if (exception) {
    let cause = '';
    if (isCoding) cause = ':is_coding';
    else if (HAS_FENCE_RE.test(text || '')) cause = ':contains_code_block';
    else if (STRUCTURED_FULL_TYPES.has(answerType)) cause = `:answer_type:${answerType}`;
    else if (answerStyle && STRUCTURED_FULL_STYLES.has(answerStyle)) cause = `:answer_style:${answerStyle}`;
    else if (DETAIL_REQUEST_RE.test(question || '')) cause = ':detail_requested';
    exceptionReason = `target:${target}${cause}`;
  }

  const overSoftTarget = wordCount > SOFT_MAX_WORDS;
  const overBudget = target === 'SPOKEN_SHORT' && (wordCount > HARD_MAX_WORDS || seconds > HARD_MAX_SECONDS);

  return { wordCount, seconds, target, overBudget, overSoftTarget, exception, exceptionReason };
}

// ── (removed) deterministic tail-trimmer ─────────────────────────────────────
// REMOVED 2026-06-16 (user decision). It dropped whole tail sentences de an over-100-word
// SPOKEN_SHORT answer para force it sob o cap. Mas a spoken answer's CONCLUSION geralmente lives
// em o último sentence ("...então I'd ser productive dentro de a couple de weeks"), então cutting o tail
// silently amputated o maioria important half de o answer. Length é agora entirely o model's
// job (o prompt's 15-30s band + o SPOKEN_SHORT/FULL/STRUCTURED tiers); não deterministic pass
// já cuts a rresposta Lá é Não hard length cap em saída — a longer answer é allowed quando
// o question precisa it. applySpeakabilityBudget (babaixo measures oapenas
export interface TrimResult {
  text: string;
  changed: boolean;
}

/**
 * @obsoleto No-op desde 2026-06-16. O deterministic trimmer era removed porque it cropped
 * o termina (o conclusion) fora longo spoken answers. Sempre Retorna o texto unchanged. Retained
 * apenas então existing importa resolve; novo código deve não chamar it. Length é controlled por o
 * prompt, não por trimming.
 */
export function trimToSpeakable(text: string, _decision: SpeakabilityDecision): TrimResult {
  return { text, changed: false };
}

// ── Generic technical-concept brevity post-check ──────────────────────────────

/** A longo analogy sentence ("Think de it likcomo "It's similar to…"). */
const ANALOGY_RE = /\b(?:think\s+of\s+it\s+(?:like|as)|imagine\s+(?:a|an|that)|it'?s\s+(?:like|similar\s+to)|picture\s+(?:a|an|this)|analogy)\b/i;

/**
 * Divide prose dentro de sentences keeping terminal punctuation. A `.`/`!`/`?` é a sentence termina
 * Apenas quando it é Não dentro a dotted technical token ("Node.js", ".NET"), a decimal ("3.14"),
 * a versão ("v2.0"), ou a glob ("*.ts") — i.e. o terminator precisa ser followed por whitespace
 * então a capital/quote/digit, ou end-of-string. This matters porque isso auxiliar feeds o
 * technical-concept compressor, onde dotted tokens são everyday vocabulary (code-review Alto
 * 2026-06-16: o antigo `.match()` splitter turned "Node.js" dentro de "NNó js").
 */
function splitProseSentences(text: string): string[] {
  const out: string[] = [];
  // A real sentence blimite terminator(s) + opcional closing quote/bracket, então qualquer um
  // whitespace followed por a sentence-starting char, ou termina de sstring A `.` flanked por word
  // chars ou digits (Node.js, 3.14) faz Não corresponder porque o que follows é a lowercase letter
  // com não intervening space.
  const BOUNDARY = /([.!?]+["')\]]*)(\s+(?=["'(]?[A-Z0-9])|\s*$)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = BOUNDARY.exec(text)) !== null) {
    const end = m.index + m[1].length;
    const piece = text.slice(last, end).trim();
    if (piece) out.push(piece);
    last = BOUNDARY.lastIndex;
    if (last <= m.index) BOUNDARY.lastIndex = m.index + 1; // proteger contra zero-width loops
  }
  const tail = text.slice(last).trim();
  if (tail) out.push(tail);
  return out.length ? out : (text.trim() ? [text.trim()] : []);
}

/**
 * Achatar a generic technical-concept answer fora de doc-shape dentro de one spoken paragraph (user
 * decision 2026-06-16: "achatar oapenas Não cap"). Pequeno models ignorar o "ser brief" prompt para
 * generic concepts ("o que é CORS?") e emitir doc-style tutorials (## headers, bullet lists,
 * tables, an embedded código example). This strips que STRUCTURE então o answer lê como
 * algo a person says aloud — mas it Nunca truncates: todos o prose conteúdo é kept, apenas
 * reshaped. Length é o prompt's job (o blunt no-tutorial template). Consistent com o
 * project-wide regra que não answer de qualquer tipo é já cut.
 *   - Drops fenced código blocks (a código example é nunca spoken; real coding answers são a
 *     diferente answerType isso nunca executa onem
 *   - Achata ATX/bold headers, bullet/numbered lista markers, e tabela rows para prose.
 *   - Drops a longo analogy sentence A menos que `simpleRequested` (o user asked para simples terms).
 * Conservative: apenas meaningful changes flip `changed`; a clean prose answer comes voltar untouched.
 */
export function compressTechnicalConcept(
  text: string,
  simpleRequested: boolean,
): { text: string; changed: boolean } {
  if (!text) return { text, changed: false };
  let out = text;

  // 1. Soltar fenced código blocks — a código example em a SPOKEN concept answer é nunca spoken.
  //    Closed fences fprimeiro então a trailing UNCLOSED fence (a truncated tutorial código block).
  out = out.replace(/```[\s\S]*?```/g, ' ').replace(/```[\s\S]*$/g, ' ');

  // 2. Achatar Todos remaining markdown structure para prose, line por line.
  out = out
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+.+?[ \t]*$/gm, '')                            // ATX cabeçalho → Soltar (a label, não prose)
    .replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)+\|?[ \t]*$/gm, '') // tabela separator rows
    .replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_m, cells) => String(cells).split('|').map((c) => c.trim()).filter(Boolean).join(', ') + '.') // tabela data rows → prose
    .replace(/^[ \t]*\*\*([^*\n]{1,60}?):\*\*[ \t]*/gm, '$1: ')                    // bold pseudo-header → plain label
    .replace(/^[ \t]*\*\*([^*\n]{1,60}?)\*\*[ \t]*:?[ \t]*$/gm, '$1: ')            // standalone bold heading line
    .replace(/^[ \t]*\d+[.)][ \t]+/gm, '')                                         // numbered lista markers
    .replace(/^[ \t]*[-*•+][ \t]+/gm, '');                                         // bullet markers
  // Strip remaining inline emphasis markers (bold/italic) — they lê como doc formatting.
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/(?<!\*)\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g, '$1');
  // Colapsar o now-blank lines dentro de one flowing paragraph.
  out = out.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  out = out.replace(/\s+([.,])/g, '$1').replace(/\.{2,}/g, '.').trim();

  // 3. Soltar a longo analogy sentence a menos que o user asked para simples terms. (Style cleanup, não
  //    a length cap — it remover a preenchimento analogy, nunca real content.) Não length cap: o
  //    whole flattened answer é kept.
  if (!simpleRequested && ANALOGY_RE.test(out)) {
    const sentences = splitProseSentences(out);
    const kept = sentences.filter((s) => !ANALOGY_RE.test(s) || s.trim().split(/\s+/).length <= 12);
    if (kept.length >= 1 && kept.length < sentences.length) {
      out = kept.join(' ').replace(/\s+/g, ' ').trim();
    }
  }

  // GProteger nunca retorna an vazio / trivially curto result.
  if (out.length < 20) return { text: text.trim(), changed: false };
  return { text: out, changed: out !== text.trim() };
}

/**
 * MEASURE-ONLY length budget. It Nunca trims o answer (2026-06-16, user decision): a
 * deterministic tail-trim cropped o Termina de an over-100-word answer, e a spoken answer's
 * conclusion ("...então I'd ser productive dentro de a couple de weeks") frequentemente lives em o último
 * sentence — dropping it silently mangled o answer. Length é agora 100% o model's job via
 * o prompt (o 15-30s band + o SPOKEN_SHORT/FULL/STRUCTURED tiers); nada aqui já cuts
 * a rresposta This função é retained Apenas para measure o answer para telemetry (word count,
 * seconds, o coarse class) — `text` é returned verbatim e `speakability_budget_applied` é
 * sempre false, então ambos chamar sites (que proteger em que fflag become no-ops em o answer text.
 */
export function applySpeakabilityBudget(
  text: string,
  answerType: AnswerType,
  answerStyle: AnswerStyle | undefined,
  question: string,
  isCoding = false,
): {
  text: string;
  changed: boolean;
  spoken_word_count: number;
  estimated_speak_seconds: number;
  /** Sempre falso — o budget não longer trims. Kept para o chamar sites' gproteger */
  speakability_budget_applied: boolean;
  length_exception_reason: string;
  /** Coarse marker para telemetry (spec's speakability_class). Não raw content. */
  speakability_class: SpeakabilityClass;
} {
  const decision = decideSpeakability(text, answerType, answerStyle, question, isCoding);
  return {
    text,                                  // verbatim — nunca trimmed
    changed: false,
    spoken_word_count: decision.wordCount,
    estimated_speak_seconds: decision.seconds,
    speakability_budget_applied: false,    // measure-only
    length_exception_reason: decision.exceptionReason,
    speakability_class: classifySpeakability(decision),
  };
}
