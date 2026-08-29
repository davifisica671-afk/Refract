// electron/llm/codingContract.ts
//
// O único fonte de truth para o coding/DSA answer structure. Todo prompt
// surface e o validator importar de haqui então o six sections, their exact
// oordenar e their `## ` heading formulário pode nunca drift apart anovamente
//
// History: o section spec era duplicated através prompts.ts (colon labels),
// tinyPrompts.ts (comma lilista AnswerPlanner.ts (## headings), o assist
// prompt (### Dry RuExecuta e AnswerValidator.ts (## headings). O modelo got
// contradictory instructions e o validator's `## ` verifica poderia rejeitar o
// muito formata outro prompt asked fpara This módulo termina that.
//
// Dependency-free em purpose (não iimporta então it pode ser pulled dentro de prompts.ts,
// AnswerPlanner.ts, AnswerValidator.ts, e tests sem qualquer cycle risk.

/** O six necessário section titles, Sem o markdown prefix. */
export const CODING_SECTIONS = [
  'Approach',
  'Technique / Data Structure / Algorithm Used',
  'Code',
  'Dry Run',
  'Complexity',
  'Interviewer Follow-up Points',
] as const;

export type CodingSection = (typeof CODING_SECTIONS)[number];

/** O six headings em their exact, validator-checked markdown form. */
export const CODING_SECTION_HEADINGS: readonly string[] = CODING_SECTIONS.map(s => `## ${s}`);

/**
 * O completo contract texto injected dentro de prompts. Imperative, model-facing.
 * Keep isso o Apenas place o prose lives.
 */
export const CODING_CONTRACT = `CODING / DSA RESPONSE CONTRACT — output these EXACT markdown headings, in THIS order, with nothing before the first heading:

## Approach
- Short, interview-speakable explanation of the idea. Optimized approach clearly; brute force only if useful.

## Technique / Data Structure / Algorithm Used
- Name the core DSA concept/data structure/algorithm (e.g. two pointers, sliding window, hash map, stack, queue, binary search, DP, BFS/DFS, heap, trie, union-find, recursion, backtracking).

## Code
- Clean, correct, interview-ready code in ONE fenced block with a language tag (\`\`\`python). Meaningful names, minimal comments. Do NOT start the answer with code — the \`## Approach\` heading comes first.

## Dry Run
- Walk through ONE sample input step by step and show how the code reaches the output.

## Complexity
- Time Complexity: O(...), because ...
- Space Complexity: O(...), because ...

## Interviewer Follow-up Points
- Syntax/built-ins, edge cases, assumptions, duplicates, boundaries, tradeoffs, or optimizations the interviewer might probe.

Every heading is mandatory and must appear verbatim (with the \`## \` prefix). Even a small/local model must emit every heading. A missing/renamed heading, or starting with code, is a format failure.`;

/**
 * A compact one-line variant de o contract para tiny-model prompts onde token
 * budget é tight mas o Mesmo heading contract precisa hold.
 */
export const CODING_CONTRACT_TINY = `Coding/DSA answers MUST use these EXACT markdown headings, in order, nothing before the first: "## Approach", "## Technique / Data Structure / Algorithm Used", "## Code" (one fenced block with a language tag), "## Dry Run", "## Complexity" (Time + Space, each "O(...) because ..."), "## Interviewer Follow-up Points". Never start with code. A missing/renamed heading is a failure.`;

/**
 * Optional verification-spec iinstrução Appended para o coding prompt Apenas
 * quando code-execution verification é enabled. Asks o modelo para emitir a hidden
 * machine-readable testar block Após o six sections então Refract pode executa o
 * código contra testar cases em o background. O block é stripped antes o
 * answer é shown (see stripVerificationSpec) — o user nunca sees it.
 *
 * `input` é o Argumento Lista para o entry função (a one-arg função ainda
 * uses a one-element ararray e `expected` é o valor it deve rretorna
 */
export const CODING_VERIFICATION_INSTRUCTION = `After the six sections, output a hidden test block EXACTLY in this form (it is removed before display, so the user never sees it — keep it strictly valid JSON):

<verification_spec>
{"entry":"<the function or method name in your Code, e.g. twoSum>","language":"<python|javascript|java|cpp|...>","cases":[{"input":[<arg1>,<arg2>],"expected":<return value>}]}
</verification_spec>

Rules for the spec:
- "entry" MUST be the exact name of the function/method a caller would invoke in your Code (for a "class Solution" method, use the method name).
- "input" is the ARGUMENT LIST passed to that function, in order (wrap a single argument in a one-element array).
- Include EVERY example from the problem statement, PLUS 1-3 edge cases (empty input, duplicates, boundaries) you are confident about.
- Use only concrete JSON values (numbers, strings, booleans, arrays, objects, null). No code, no expressions, no comments.
- LINKED LISTS / BINARY TREES: if any argument or the return value is a linked list (ListNode) or binary tree (TreeNode), add "argTypes" and/or "retType" so the runner can build/compare them. Use "list" for a linked list, "tree" for a binary tree, "value" (or omit) otherwise. Encode a linked list as a plain array [1,2,3]; encode a binary tree in LeetCode LEVEL-ORDER with null for missing nodes, e.g. [3,9,20,null,null,15,7]. Example: \`{"entry":"reverseList","language":"python","argTypes":["list"],"retType":"list","cases":[{"input":[[1,2,3]],"expected":[3,2,1]}]}\`.
- SQL: if your Code is a SQL query, set "language":"sql" and OMIT "entry"/"cases". Instead provide "schema" (array of CREATE TABLE statements), "seeds" (array of INSERT statements), and "expected" (the result-set rows as {column: value} objects using your SELECT's output column names/aliases). Add "ordered":true ONLY if the problem requires a specific row order; otherwise omit it (rows compare order-insensitively). Write standard SQL that runs on SQLite. Only a single read-only SELECT is verified. Example: \`{"language":"sql","schema":["CREATE TABLE T(id INT, v INT)"],"seeds":["INSERT INTO T VALUES (1,10),(2,20)"],"expected":[{"id":2,"v":20}]}\`. If you cannot give reliable schema/seed/expected, emit \`{"language":"sql","schema":[],"seeds":[],"expected":[]}\` to skip verification rather than guess.
- If you genuinely cannot produce reliable expected outputs, output \`<verification_spec>{"entry":"<name>","language":"<lang>","cases":[]}</verification_spec>\` rather than guessing wrong values.`;

/**
 * O regex que encontra o hidden spec block (para stash-and-strip). O fechar
 * tag é OPTIONAL: a truncated stream (max-tokens / network cutoff / modelo
 * error) pode emitir o opening tag com não fechar — we precisa ainda strip de o
 * opening tag para end-of-string então o raw spec nunca leaks dentro de o displayed
 * ou persisted answer. `[\s\S]*?` + o `(?:</verification_spec>|$)` alternation
 * strips a terminated block minimally, ou an unterminated one para EOF.
 */
export const VERIFICATION_SPEC_RE = /\s*<verification_spec>[\s\S]*?(?:<\/verification_spec>|$)/i;

/**
 * Remove Todo hidden <verification_spec> block de an answer antes dexibir
 * A fresh GLOBAL regex é created por chamar (não o exported cconstante então we
 * strip Todos blocks — a modelo que hallucinates a second/trailing spec precisa não
 * leak it — sem o shared-`lastIndex` footgun de a module-level /g regex.
 * Idempotent e safe em answers que nunca tinha one.
 */
export const stripVerificationSpec = (answer: string): string =>
  typeof answer === 'string'
    ? answer.replace(/\s*<verification_spec>[\s\S]*?(?:<\/verification_spec>|$)/gi, '\n').trim()
    : answer;

/**
 * Stateful, streaming-safe suppressor para o hidden <verification_spec> block.
 * O spec é sempre emitted Após o six visible sections, então uma vez we see o
 * opening tag (até partially, através chunk boundaries) we suprimir it and
 * tudo após it — o spec nunca reaches o UI mid-stream. Used por
 * stream em o WTA + chat coding paths. A pequeno tail buffer holds voltar a
 * possível parcial "<verification_spec" prefix até we know it isn't o tag.
 */
export class StreamingSpecStripper {
  private suppressing = false;
  private tail = '';
  private static readonly OPEN = '<verification_spec';
  // Longest prefix de Abrir we pode ser ser mid-emitting; hold voltar at maioria isso mmuito
  private static readonly HOLD = StreamingSpecStripper.OPEN.length;

  push(chunk: string): string {
    if (this.suppressing) return '';
    let buf = this.tail + chunk;
    const idx = buf.indexOf(StreamingSpecStripper.OPEN);
    if (idx >= 0) {
      this.suppressing = true;
      this.tail = '';
      return buf.slice(0, idx); // emitir text antes o spec, soltar o rest
    }
    // Não completo tag yainda Hold voltar a trailing slice que poderia ser a parcial tag então
    // we don't emitir "<verification_sp" e então suprimir o rest próximo chunk.
    const keep = Math.max(0, buf.length - StreamingSpecStripper.HOLD);
    const emit = buf.slice(0, keep);
    this.tail = buf.slice(keep);
    return emit;
  }

  /** Flush qualquer safely-non-tag tail at stream etermina */
  finish(): string {
    if (this.suppressing) return '';
    const out = this.tail;
    this.tail = '';
    return out;
  }
}
