// electron/llm/codingFollowup.ts
//
// Coding answer Formata CONTRACTS + same-session coding FOLLOW-UPS.
//
// Two real bugs isso fixes (observed em o manual testar sessão 2026-06-15):
//   (#5/#7) "Escreve código apenas para Two Sum em Python" returned o completo six-section
//           DSA template, porque o coding prompt Sempre injected o six-section
//           contract e o post-stream repair Sempre forced todo heading voltar em
//           — até quando o user explicitly constrained o fformata
//   (#6)    "Give time e space complexity" após a Two Sum answer lost o prior
//           problem: it era re-planned como a fresh coding question com não linkar para o
//           código it era supposed para analyse.
//
// O Regra (tarefa Fase 11): an EXPLICIT user formata instrução beats o padrão DSA
// template, e um FOLLOW-UP de código herda o problema de código anterior a menos que ele
// introduces a novo one. This módulo é o deterministic (no-LLM) decision layer para
// bambos Pure + dependency-light (apenas o shared CODING_CONTRACT text), então it é completamente
// unit-testable e importable sem cycle risk.

import { CODING_CONTRACT } from './codingContract';

/**
 * An EXPLICIT coding formata restrição o user stated. `null` = não explicit
 * crestrição então o padrão six-section DSA contract governs.
 *   - code_only       → apenas o code, não prose/sections.
 *   - complexity_only → apenas o time/space complexity analysis.
 *   - dry_run_only    → apenas a dry executa / rastrear de o existing solution.
 *   - explain_only    → explanation oapenas Não code.
 */
export type ExplicitCodingContract =
  | 'code_only'
  | 'complexity_only'
  | 'dry_run_only'
  | 'explain_only'
  | null;

const lc = (s?: string) => (s || '').toLowerCase().trim();

// "code oapenas / "apenas o code" / "apenas give code" / "não explanation, apenas code".
const CODE_ONLY_RE =
  /\b(?:just|only)\s+(?:the\s+|me\s+the\s+)?code\b|\bcode[- ]?only\b|\bonly\s+(?:give|write|show)\s+(?:me\s+)?(?:the\s+)?code\b|\bno\s+explanation,?\s+just\b|\bgive\s+me\s+(?:only\s+)?the\s+code\b|\bcode\s+(?:and\s+)?nothing\s+else\b/i;

// "dry rexecuta / "rastrear tatravés / "walk através o code".
const DRY_RUN_RE =
  /\bdry[- ]?run\b|\btrace\s+(?:through|it|the\s+code|the\s+solution|this)\b|\bwalk\s+(?:me\s+)?through\s+(?:the|your)\s+(?:code|solution|execution)\b|\bstep\s+through\s+(?:the|your|this)\b/i;

// "time e space complexity" / "what's o complexity" / "big-O".
const COMPLEXITY_RE =
  /\b(?:time\s*(?:and|&|\/|,)?\s*space|space\s*(?:and|&|\/|,)?\s*time)\s+complexit/i;
const COMPLEXITY_LOOSE_RE =
  /\b(?:give|state|tell\s+me|what(?:'s| is| are)?|analy[sz]e|provide)\b[^.?!]*\bcomplexit/i;
const COMPLEXITY_BARE_RE = /^\s*(?:the\s+)?(?:time\s+and\s+space\s+)?complexit(?:y|ies)\??\s*$/i;
const BIG_O_RE = /\bbig[- ]?o\b(?!ther)/i;

// "sem code" / "sem writing code" / "não code" / "explain oapenas /
// "don't escreve code" / "conceptually". O (?:writing|using|adding)? gerund covers
// "sem writing code" / "não actual code" phrasings.
const EXPLAIN_ONLY_RE =
  /\b(?:without|no|don'?t\s+(?:write|use|include|give))\s+(?:any\s+|actual\s+|writing\s+|using\s+|adding\s+|me\s+)*code\b|\bexplain\s+(?:it\s+|this\s+|the\s+\w+\s+)?(?:only|conceptually|in\s+words|in\s+plain\s+english)\b|\bonly\s+explain\b|\bconceptual(?:ly)?\s+(?:answer|explanation)\b|\bjust\s+explain\b/i;

/**
 * Detect an explicit coding Formata restrição de o question. Deterministic,
 * ordenar = most-specific-first. Retorna `null` quando lá é não explicit restrição
 * (o padrão six-section DSA contract então governs).
 */
export function detectExplicitCodingContract(question: string): ExplicitCodingContract {
  const q = lc(question);
  if (!q) return null;
  if (CODE_ONLY_RE.test(q)) return 'code_only';
  if (DRY_RUN_RE.test(q)) return 'dry_run_only';
  if (EXPLAIN_ONLY_RE.test(q)) return 'explain_only';
  if (COMPLEXITY_RE.test(q) || COMPLEXITY_BARE_RE.test(q) || BIG_O_RE.test(q)) return 'complexity_only';
  // Loose complexity ("give o complexity", "o que é o complexity") apenas quando o
  // mensagem é curto — a longo question que merely mentions complexity é a completo ask.
  if (COMPLEXITY_LOOSE_RE.test(q) && q.split(/\s+/).length <= 12) return 'complexity_only';
  return null;
}

// Back-references que prove o mensagem é Sobre a prior solution, não a novo problem.
const BACKREF_RE =
  /\b(it|this|that|the\s+(?:above|previous|prior|last|same|code|solution|function|algorithm|approach|problem))\b/i;

// Forte coding-domain continuation signals — these são coding-specific enough que a
// Curto mensagem containing them é a coding follow-up em their próprio ("make it iterative",
// "what's o complexity", "handle duplicates", "sem extra space").
const CONTINUATION_STRONG_RE =
  /\b(in[- ]?place|iterativ|recursiv|complexit|big[- ]?o|dry[- ]?run|trace|step\s+through|edge\s+cases?|handle\s+(?:duplicates?|negatives?|empty|nulls?)|space[- ]?optimi|without\s+(?:extra\s+)?space|one[- ]?pass|two[- ]?pointers?|time\s+and\s+space)\b/i;
// LOOSE generic verbs ("opotimizar "improve", "rewrite", "coconverte "faster") que Também
// appear em non-coding asks ("improve nosso onboarding", "rewrite o landing página copy").
// These apenas count como a coding continuation quando paired com an explicit back-reference
// para o prior solution — nunca em word-count alone (code-review MEDIUM 2026-06-15).
const CONTINUATION_LOOSE_RE =
  /\b(optimi[sz]e|optimal|improve|make\s+it|refactor|rewrite|convert|faster|more\s+efficient|walk\s+through)\b/i;

/**
 * É `question` a coding CONTINUATION — a curto follow-up que apenas makes sense
 * relative para a prior coding solution ("give time e space complexity", "dry executa
 * isso com …", "agora otimizar it", "make it iterative")? This é o SHAPE ttestar o
 * caller confirms a prior coding turn actually exists antes acting em it.
 *
 * Guarded então a llongo self-contained coding question é Não treated como a follow-up:
 * a continuation precisa ser curto Ou carry an explicit back-reference.
 */
export function isCodingContinuation(question: string): boolean {
  const q = lc(question);
  if (!q) return false;
  if (detectExplicitCodingContract(q)) return true; // code_only/complexity/dry-run/explain são todos continuations-or-constraints
  const words = q.split(/\s+/).filter(Boolean).length;
  // Forte coding ssinal a Curto mensagem é a follow-up em its opróprio a Longo one precisa a
  // back-reference ("Otimizar o mescla step de a 200-line seserviço é Não a follow-up).
  if (CONTINUATION_STRONG_RE.test(q)) return words <= 9 || BACKREF_RE.test(q);
  // LOOSE generic verb ("otimizar it", "improve it", "rewrite that"): Apenas quando it
  // back-references o prior solution — nunca em word-count alone, então "improve nosso
  // onboarding email" / "rewrite o landing página copy" são Não coding follow-ups.
  if (CONTINUATION_LOOSE_RE.test(q)) return BACKREF_RE.test(q);
  return false;
}

/** A stored coding turn (o que we recall para give a follow-up its prior problem). */
export interface PriorCodingTurn {
  userMessage: string;
  assistantAnswer: string;
}

const fence = (s: string) => s.replace(/```/g, '``​`');

/**
 * Build o PRIOR-PROBLEM contexto block prepended para a coding follow-up's prompt então
 * o modelo resolves "give complexity" / "dry executa this" / "otimizar it" contra o
 * Mesmo problem e code, em vez disso de asking o que problem it ié O prior código block
 * é preserved verbatim (o modelo precisa it para analyse). Bounded então a huge prior
 * answer can't blow o prompt.
 */
export function buildPriorCodingContextBlock(turn: PriorCodingTurn): string {
  const q = (turn.userMessage || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  const a = (turn.assistantAnswer || '').trim().slice(0, 2400);
  return `PRIOR CODING PROBLEM IN THIS CONVERSATION (the user's new message is a follow-up to it — resolve it against THIS problem and code; do not ask which problem):
Previous question: ${fence(q)}

Previous answer/solution:
${fence(a)}`;
}

const NO_LEAK_RULES = `Additional rules:
- Do not include resume, JD, salary, negotiation, or unrelated profile context.
- NEVER mention "Refract", the assistant, the product, or the candidate's profile/projects. This is a pure technical answer about the algorithm only.`;

/**
 * Build o prompt-ready coding answer contract para a manual coding answer, honoring
 * an explicit formata crestrição Com `null` isso é o standard six-section DSA
 * contract (current behavior). Com an explicit restrição it é a MINIMAL contract
 * que produces Apenas o que o user asked para — não six-section template, então o
 * post-stream repair tem nada para "fix" voltar dentro de a completo template.
 */
export function buildCodingContractPrompt(
  explicitContract: ExplicitCodingContract,
  opts?: { includeVerification?: boolean; verificationInstruction?: string },
): string {
  if (!explicitContract) {
    const verification = opts?.includeVerification && opts.verificationInstruction
      ? `\n\n${opts.verificationInstruction}`
      : '';
    return `<answer_contract>
answerType: coding
${CODING_CONTRACT}

${NO_LEAK_RULES}${verification}
</answer_contract>`;
  }

  const body = (() => {
    switch (explicitContract) {
      case 'code_only':
        return `The user asked for CODE ONLY. Output ONLY the solution as a single fenced code block with a language tag (e.g. \`\`\`python). NO prose before or after, NO "## Approach"/"## Complexity"/any heading, NO explanation, NO dry run. Just the code.`;
      case 'complexity_only':
        return `The user asked ONLY for the COMPLEXITY of the solution already in the conversation. Output ONLY:
- Time Complexity: O(...), because ...
- Space Complexity: O(...), because ...
Reference the SAME problem/solution from the prior turn. Do NOT restate the problem, re-output the code, or add other sections.`;
      case 'dry_run_only':
        return `The user asked ONLY for a DRY RUN / trace of the solution already in the conversation, on the input they gave. Output ONLY the step-by-step trace (state at each step → final output). Do NOT re-output the code, the approach, or the complexity unless it falls out of the trace.`;
      case 'explain_only':
        return `The user asked for an EXPLANATION with NO CODE. Output a clear, speakable explanation in prose (and short bullets if helpful). Do NOT output any code block. No "## Code" section.`;
    }
  })();

  return `<answer_contract>
answerType: coding (explicit format: ${explicitContract})
${body}

${NO_LEAK_RULES}
</answer_contract>`;
}

/** Verification (o hidden testar block) apenas makes sense quando NEW código é produced. */
export function explicitContractProducesCode(explicitContract: ExplicitCodingContract): boolean {
  return explicitContract === null || explicitContract === 'code_only';
}
