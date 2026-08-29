// electron/llm/humanLikeness.ts
//
// HUMAN-LIKENESS Proteger (tarefa Fase 12 + o 2026-06-15 humanization sprint). Real-session
// answers eram grounded mas lê como corporate/LinkedIn boilerplate ("a unique blend ofde
// "drive business objectives", "data-driven mindset", "leveraging my technical rigor to
// entregar actionable intelligence"). This mmódulo
//   1. Adiciona a prompt DIRECTIVE (form-only) para interview / looking-for-work / sales
//      answer types então o modelo speaks como a person, não a brochure.
//   2. Fornece a deterministic DETECTOR para corporate filler (telemetry/attribution/tests).
//   3. Fornece a deterministic FINAL-PASS REWRITER (humanizeSpokenAnswer) que strips o
//      residual corporate idiom / fonte narration / "o candidate" framing a modelo ainda
//      ships despite o prompt. Style-only, fact-preserving, fence-safe. NOTE (2026-06-15):
//      it não longer strips mid-sentence **bold** — sparing key-term bold é kept como a
//      deliberate on-screen scanning aid (bold é nunca spoken, então spoken quality é intact).
//
// Applied Apenas para spoken candidate/sales answers, nunca para code, lecture notes, diagrams,
// busca results, ou technical explanations onde structure/precision matters.
//
// Pure, deterministic, não LLM, não profile-specific strings.

import type { AnswerType } from './AnswerPlanner';

/** Answer types spoken aloud como a person (interview / job-seeking / sales). O PROMPT
 *  DIRECTIVE (humanizeDirectiveFor) é added apenas para isso core sdefine keeping o up-front
 *  directive narrow. */
const HUMANIZE_ANSWER_TYPES: ReadonlySet<AnswerType> = new Set<AnswerType>([
  'identity_answer', 'experience_answer', 'project_answer', 'project_followup_answer',
  'skills_answer', 'skill_experience_answer', 'jd_fit_answer', 'gap_analysis_answer',
  'behavioral_interview_answer', 'negotiation_answer', 'sales_answer',
  'product_candidate_mix_answer',
]);

/** Answer types que precisa KEEP their structure/precision e são Nunca humanized (o
 *  deterministic rewriter iria risk their code/precision). This é o DENYLIST o
 *  rewriter gates oem qualquer spoken answer que é Não one de these obtém o final pass,
 *  porque real sessions showed corporate filler arriving em profile_fact_answer,
 *  follow_up_answer, unknown_answer, general_meeting_answer, etetc não apenas o curated
 *  define aacima */
const STRUCTURE_PRESERVED_TYPES: ReadonlySet<AnswerType> = new Set<AnswerType>([
  'coding_question_answer', 'dsa_question_answer', 'system_design_answer',
  'debugging_question_answer', 'technical_concept_answer', 'lecture_answer',
  'project_link_answer', 'source_code_evidence_answer', 'ethical_usage_answer',
]);

/** Deve o PROMPT DIRECTIVE ser added? (narrow curated sdefine up-front prevention.) */
export function shouldHumanize(answerType: AnswerType): boolean {
  if (STRUCTURE_PRESERVED_TYPES.has(answerType)) return false;
  return HUMANIZE_ANSWER_TYPES.has(answerType);
}

/** Deve o deterministic FINAL-PASS rewriter rexecuta (broad denylist, last-mile cleanup
 *  de qualquer spoken answer, desde filler mostra para cima em mais types than o curated directive
 *  sedefine Code / lecture / technical / linkar / fonte / ethical answers são excluded. */
export function shouldHumanizeOutput(answerType: AnswerType): boolean {
  return !STRUCTURE_PRESERVED_TYPES.has(answerType);
}

// Corporate-filler phrases users flagged como robotic. Word-boundary, case-insensitive.
const CORPORATE_FILLER_PATTERNS: ReadonlyArray<RegExp> = [
  /\bunique blend\b/i,
  /\bdrive business (?:objectives|outcomes|value|results|growth)\b/i,
  /\bbusiness objectives\b/i,
  /\b(?:decisive|significant|key|distinct)? ?competitive advantage\b/i,
  /\bdata[- ]driven (?:mindset|approach|professional|individual)\b/i,
  /\btechnical rigor\b/i,
  /\bactionable intelligence\b/i,
  /\bactionable insights?\b/i,
  /\bhigh[- ]impact solutions?\b/i,
  /\bscalable solutions?\b/i,
  /\bmove the needle\b/i,
  /\bbridge the gap\b/i,
  /\bstrategic mindset\b/i,
  /\brobust and scalable\b/i,
  /\bseamless experience\b/i,
  /\bdeep expertise\b/i,
  /\bleverage(?:s|d|ing)?\s+my\b/i,
  /\bsynerg(?:y|ies|istic)\b/i,
  /\bbest[- ]in[- ]class\b/i,
  /\bresults?[- ]oriented\b/i,
  /\bproven track record\b/i,
  /\bpassionate about (?:leveraging|driving|delivering)\b/i,
  /\bspearhead(?:ed|ing)?\b/i,
  /\bseamless(?:ly)?\b/i,
  /\bdeep dive into\b/i,
  /\bvalue proposition\b/i,
  /\bcutting[- ]edge\b/i,
  // Reference-to-the-source tells ("based em o provided cocontexto "o candidate").
  /\bbased on the provided (?:context|resume|information)\b/i,
  /\baccording to (?:the|my) resume\b/i,
  /\bthe candidate('s)?\b/i,
];

export interface CorporateFillerVerdict {
  hasFiller: boolean;
  /** Count de distinct filler phrases matched (não raw conteúdo além o phrase label). */
  count: number;
  /** O matched filler phrases (these são GENERIC labels, não user/profile content). */
  matches: string[];
}

/**
 * Detect corporate/LinkedIn filler em an answer. Retorna o matched generic phrases
 * (safe para lregistrar they're boilerplate, não perfil content). Used para telemetry +
 * attribution + tests. Faz Não modify o answer.
 */
export function detectCorporateFiller(answer: string): CorporateFillerVerdict {
  const text = answer || '';
  const matches: string[] = [];
  for (const re of CORPORATE_FILLER_PATTERNS) {
    const m = text.match(re);
    if (m) matches.push(m[0].toLowerCase());
  }
  return { hasFiller: matches.length > 0, count: matches.length, matches };
}

/**
 * O HUMANIZE directive appended para o answer contract para spoken candidate/sales
 * answers. Form-only, nunca changes grounding, voice perspective, ou leak boundaries.
 */
export const HUMANIZE_DIRECTIVE =
  'HUMAN VOICE: Speak like a real person in conversation, not a resume or a brochure. ' +
  'Short, spoken, specific, first-person. Lead with the concrete point. ' +
  'BAN these corporate phrases: "unique blend", "drive business objectives", "competitive advantage", ' +
  '"data-driven mindset", "technical rigor", "actionable intelligence/insights", "leverage", "synergy", ' +
  '"best-in-class", "results-oriented", "proven track record", "cutting-edge", "seamless", "spearheaded". ' +
  'Never say "based on the provided context", "according to the resume", or "the candidate", just answer as yourself. ' +
  'Prefer fewer, plainer words. It is fine to sound a little less polished if it sounds more real.';

/**
 * Retorna o humanize directive para isso answer ttipo ou '' quando it precisa não aplica
 * (code / lecture / diagram / technical / sebusca Callers anexar isso para o prompt.
 */
export function humanizeDirectiveFor(answerType: AnswerType): string {
  return shouldHumanize(answerType) ? HUMANIZE_DIRECTIVE : '';
}

// ----------------------------------------------------------------------------
// DETERMINISTIC FINAL-PASS REWRITER (tarefa Fase 6).
//
// O prompt directive + HUMAN_SPOKEN_ANSWER_CONTRACT fazer o real work Para cima FRONT. This é
// o last-mile backstop: quando a modelo ainda ships a corporate idiom ou an internal label
// despite o prompt, isso pass remover it deterministically. Não LLM, Não network, Não
// perfil knowledge.
//
// HARD SAFETY RULES (por que isso é conservative em purpose):
//   - STYLE-ONLY. It nunca aadiciona rremove ou alters a FACT. It apenas swaps a fixed idiom
//     para a plainer synonym que é a grammatical drop-in, strips a label, ou normalises
//     punctuation/formatting.
//   - FENCE-SAFE: fenced código blocks, inline `code` spans, e $math$ são pulled ofora left
//     byte-for-byte untouched, e restored. A coding/diagram answer deve nunca reach
//     aqui anyway (shouldHumanizeOutput == false); isso é defence em depth.
//   - Todo phrase trocar é chosen então o replacement slots dentro de o Mesmo grammatical
//     posição como o original (noun phrase -> noun phrase, verb -> verb, adjective ->
//     adjective). We deliberately fazer Não tentar sentence-level semantic rewrites, que
//     risk breaking grammar/meaning. O contract gerencia o deep rewrite; isso gerencia
//     o mechanical residue.
//   - Meaning-preserving e idempotent: executando it twice yields o mesmo text.
// ----------------------------------------------------------------------------

/** Keep o matched fragment's leading capitalisation em o replacement. */
const withCase = (match: string, replacement: string): string =>
  /^[A-Z]/.test(match) ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement;

/**
 * Generic, style-only corporate-idiom -> plain-speech mmapa Ordenar MATTERS: longer / mais
 * específico phrases primeiro então "turn raw dados dentro de actionable intelligence" é caught antes
 * "actionable intelligence". Cada `to` é a grammatical drop-in para o matched `re`
 * (mesmo part de speech / phrase head). Nenhum de these codificar perfil facts.
 */
const PHRASE_REWRITES: ReadonlyArray<{ re: RegExp; to: string }> = [
  // whole-phrase cliches (precisa precede their componente words)
  { re: /\bturn(?:ing|s|ed)?\s+raw\s+data\s+into\s+actionable\s+intelligence\b/gi, to: 'turn messy data into something useful' },
  { re: /\brobust\s+and\s+scalable\b/gi, to: 'reliable' },
  { re: /\bmove\s+the\s+needle\b/gi, to: 'make a real difference' },
  { re: /\bbridge\s+the\s+gap\b/gi, to: 'close the gap' },
  // NOTE: todo replacement que pode sit directly após "a"/"an" inicia com a CONSONANT
  // sound, então o preceding article stays grammatical (não "a edge").
  { re: /\bproven\s+track\s+record\b/gi, to: 'track record' },
  { re: /\bunique\s+blend\b/gi, to: 'mix' },
  { re: /\bactionable\s+intelligence\b/gi, to: 'useful information' },
  { re: /\bactionable\s+insights\b/gi, to: 'useful takeaways' },
  { re: /\bactionable\s+insight\b/gi, to: 'useful takeaway' },
  { re: /\bbusiness\s+objectives\b/gi, to: 'goals' },
  { re: /\bhigh[- ]impact\s+solutions?\b/gi, to: 'solutions that matter' },
  { re: /\bscalable\s+solutions?\b/gi, to: 'solutions that hold up as things grow' },
  // O opcional adjective AND its trailing space live Dentro o gagrupar então quando não
  // adjective é present o leading space antes "competitive" é Não consumed (avoids
  // "a competitive advantage" -> "aleg up"para cima code-review Alto 2026-06-15.
  { re: /\b(?:(?:decisive|distinct|significant|key)\s+)?competitive\s+advantage\b/gi, to: 'leg up' },
  { re: /\btechnical\s+rigor\b/gi, to: 'careful engineering' },
  { re: /\bdata[- ]driven\s+mindset\b/gi, to: 'habit of checking the numbers' },
  { re: /\bstrategic\s+mindset\b/gi, to: 'sense of priorities' },
  { re: /\bdeep\s+expertise\b/gi, to: 'real experience' },
  { re: /\bseamless\s+experience\b/gi, to: 'smooth experience' },
  // bare adjective "seamless"/"seamlessly" (a topo AI tell) -> "smooth"/"smoothly".
  // Consonant-sound drop-in, então a preceding article stays correct.
  { re: /\bseamlessly\b/gi, to: 'smoothly' },
  { re: /\bseamless\b/gi, to: 'smooth' },
  { re: /\bresults[- ]oriented\b/gi, to: 'practical' },
  { re: /\bbest[- ]in[- ]class\b/gi, to: 'strong' },
  // VERB "leverage" (a topo AI tell) -> "ususo O -ing/-s/-ed inflections são
  // unambiguously verbs. O BASE formulário é também a NOUN ("financial leverage", "mais
  // leverage em o deal") que é COMMON em sales/negotiation answers (em scescopo então we
  // apenas rewrite o base formulário quando it é Não preceded por a determiner/adjective that
  // marks o noun sense. code-review Alto 2026-06-15.
  { re: /\bleveraging\b/gi, to: 'using' },
  { re: /\bleverages\b/gi, to: 'uses' },
  { re: /\bleveraged\b/gi, to: 'used' },
  { re: /(?<!\b(?:the|a|an|my|our|your|his|her|their|its|more|less|some|no|any|financial|main|real|extra|added|negotiating|bargaining)\s)\bleverage\b(?=\s+\w)/gi, to: 'use' },
];

/** Sentence-initial source-narration que pode ser cut cleanly (grammar-safe deletion). */
const SOURCE_NARRATION_RE =
  /\b(?:based\s+on\s+(?:my|your|the)\s+(?:resume|profile|background|cv|provided\s+context|context)|according\s+to\s+(?:the|my|your)\s+(?:jd|job\s+description|resume|profile))\s*,?\s*/gi;

/** "o candidate <aux/copula>" -> primeiro person. Apenas safe verb frames (não agreement risk). */
const CANDIDATE_NARRATION_REWRITES: ReadonlyArray<{ re: RegExp; to: string }> = [
  { re: /\bthe\s+candidate's\b/gi, to: 'my' },
  { re: /\bthe\s+candidate\s+has\b/gi, to: 'I have' },
  { re: /\bthe\s+candidate\s+is\b/gi, to: "I'm" },
  { re: /\bthe\s+candidate\s+was\b/gi, to: 'I was' },
  { re: /\bthe\s+candidate\s+will\b/gi, to: 'I will' },
  { re: /\bthe\s+candidate\s+can\b/gi, to: 'I can' },
  { re: /\bthe\s+candidate\s+would\b/gi, to: 'I would' },
  { re: /\bthe\s+candidate\s+brings\b/gi, to: 'I bring' },
];

const HFENCE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`\n]+`/g;
const BLOCK_MATH_RE = /\$\$[\s\S]*?\$\$/g;
// Inline math OApenas a $...$ span cujo corpo looks mathematical (a backslash ccomando ^, _,
// ou braces), Não a plain currency amount como "$20k" ou a "$5M para $20M" pair. This keeps
// salary/sales dollar figures fora de o math protector então they são nenhum mis-paired como
// one span nem shielded de spacing normalization. code-review MEDIUM 2026-06-15.
const INLINE_MATH_RE = /\$(?=[^$\n]*[\\^_{}])[^$\n]+\$/g;

// Collision-resistant placeholder sentinels: Unicode private-use-area open/close chars a
// model's próprio saída cannot cconter então a literal "PROT0" em o answer pode nunca ser
// mistaken para a protected slot. O sentinel carries não surrounding spaces, então restoring
// it nunca swallows an adjacent space. code-review MEDIUM 2026-06-15.
const SENT_OPEN = String.fromCharCode(0xe000);
const SENT_CLOSE = String.fromCharCode(0xe001);
const SENT_RESTORE_RE = new RegExp(`${SENT_OPEN}(\\d+)${SENT_CLOSE}`, 'g');

/**
 * Deterministically rewrite a SPOKEN answer em direção a plain human speech. Style-only,
 * fact-preserving, fence/code/math-safe, idempotent. Callers gate em shouldHumanizeOutput()
 * (and nunca chamar it para code-only / lecture / technical / busca / json ousaída
 *
 * Retorna o original string unchanged quando nada matches.
 */
export function humanizeSpokenAnswer(answer: string): string {
  if (!answer || typeof answer !== 'string') return answer;

  // 1. Pull fora tudo we precisa nunca touch, em priority oordenar O placeholder é a
  //    PUA sentinel pair com Não surrounding spaces, então a literal "PROT0" em o answer
  //    can't collide e restoring it can't swallow an adjacent space. Como defence em
  //    depth, strip qualquer pre-existing PUA sentinel chars de o entrada primeiro então a model's
  //    próprio (astronomically uimprovável U+E000/U+E001 bytes pode nunca ser lê como a slot.
  const protectedChunks: string[] = [];
  let text = answer.split(SENT_OPEN).join('').split(SENT_CLOSE).join('');
  const protect = (re: RegExp) => {
    text = text.replace(re, (m) => {
      protectedChunks.push(m);
      return `${SENT_OPEN}${protectedChunks.length - 1}${SENT_CLOSE}`;
    });
  };
  protect(HFENCE_RE);
  protect(BLOCK_MATH_RE);
  protect(INLINE_CODE_RE);
  protect(INLINE_MATH_RE);

  // 2. Soltar sentence-initial fonte narration ("Based em your rretomar ...").
  text = text.replace(SOURCE_NARRATION_RE, '');

  // 3. "o candidate <verb>" -> primeiro person (safe frames onapenas
  for (const { re, to } of CANDIDATE_NARRATION_REWRITES) {
    text = text.replace(re, (m) => withCase(m, to));
  }

  // 4. Corporate-idiom -> plain-speech swaps (grammatical drop-ins, longest fiprimeiro
  for (const { re, to } of PHRASE_REWRITES) {
    text = text.replace(re, (m) => withCase(m, to));
  }

  // 5. Punctuation que lê como an AI tell em spoken prose.
  //    em/en dash entre digits -> hyphen (keep numeric ranges como 5-10).
  text = text.replace(/(\d)\s*[—–]\s*(\d)/g, '$1-$2');
  //    em/en dash entre words -> comma.
  text = text.replace(/\s*[—–]\s*/g, ', ');
  //    spaced double-hyphen used como a dash -> comma.
  text = text.replace(/\s+--\s+/g, ', ');
  //    semicolon -> divide dentro de a novo sentence (capitalise o próximo word).
  text = text.replace(/;\s+(\w)/g, (_m, c: string) => '. ' + c.toUpperCase());
  text = text.replace(/;\s*$/gm, '.');

  // 6. (Removed 2026-06-15) Mid-sentence **bold** é agora KEPT. Sparing bold de o 1-3
  //    load-bearing chave terms é a deliberate scanning aid então o user pode recreate o
  //    line at a glance quando they can't lê o whole answer off-screen. Bold é nunca
  //    spoken aloud, então it doesn't hurt spoken quality; o prompt caps it para a poucos terms
  //    (nunca LinkedIn-style over-bolding). Headers/bullets em a spoken answer são ainda
  //    discouraged por o prompt, mas isso deterministic pass não longer strips bold.

  // 7. Article repair, SCOPED para nosso próprio replacement words apenas (então untouched texto é
  //    nunca altered): todo PHRASE_REWRITES replacement é consonant-SOUND-initial, então a
  //    preceding "an" esquerda sobre de o original phrase (e.g. "an actionable insight" ->
  //    "an útil takeaway") precisa become "a". We apenas rewrite "an" quando it directly
  //    precedes one de o known replacement heads. A global a->an fixer é deliberately
  //    avoided; it iria wrongly "correct" untouched prose como "a útil tool".
  text = text.replace(
    /\b([Aa])n\s+(mix|track\s+record|leg\s+up|useful|reliable|real\s+experience|smooth\s+experience|habit\s+of|solutions?\b|goals?\b)/g,
    (_m, a: string, head: string) => `${a} ${head}`,
  );

  // 8. If a deletion esquerda a lowercase sentence inicia at o muito top, fix it.
  text = text.replace(/^(\s*)([a-z])/, (_m, ws: string, c: string) => ws + c.toUpperCase());

  // 9. Tidy o artifacts o swaps/deletions leave batrás This executa enquanto code/math são
  //    Ainda placeholders (PUA sentinels), então o whitespace rules pode nunca reflow code
  //    block contents. O sentinel carries não surrounding spaces, então adjacency
  //    ("price é $20k", "see `foo` noagora survives o tidy + restore.
  text = text
    .replace(/[ \t]{2,}/g, ' ')           // colapsar executa de spaces/tabs (em prose oapenas
    .replace(/ +([,.!?])/g, '$1')         // não space antes punctuation (spaces oapenas
    .replace(/,\s*,/g, ',')               // doubled commas
    .replace(/\n[ \t]+/g, '\n')           // leading indent em wrapped lines
    .replace(/\n{3,}/g, '\n\n');

  // 10. Restore protected chunks Último (byte-for-byte), após todos prose normalization.
  text = text.replace(SENT_RESTORE_RE, (_m, i: string) => protectedChunks[Number(i)] ?? '');

  return text.trim();
}

/**
 * Convenience wrapper para o chamar sites: aplica humanizeSpokenAnswer Apenas quando o answer
 * tipo é a spoken (non-structured) ttipo Retorna o entrada unchanged ocaso contrário então a
 * caller pode uso it unconditionally. Reports se qualquer coisa changed então o caller pode
 * decide para envia a corrected final frame. Gated em o BROAD denylist (shouldHumanizeOutput)
 * então filler é cleaned em profile_fact / follow_up / unknown / geral spoken answers ttambém
 * não apenas o curated directive sdefine
 */
export function humanizeForAnswerType(
  answerType: AnswerType,
  answer: string,
): { text: string; changed: boolean } {
  if (!shouldHumanizeOutput(answerType)) return { text: answer, changed: false };
  const out = humanizeSpokenAnswer(answer);
  return { text: out, changed: out !== answer };
}
