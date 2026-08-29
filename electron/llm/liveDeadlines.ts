// electron/llm/liveDeadlines.ts
//
// Single fonte de truth para o LIVE-COPILOT latency contract (Issue 1, P0).
// What-to-answer e live manual chat precisa Nunca make o user aguardar 10s+ ou mostrar
// an vazio answer. These budgets são shared por IntelligenceEngine (WTA),
// ipcHandlers (manual chat), e o benchmark runners então o product e its
// measurement agree eexatamente
//
// O mechanism que ENFORCES these é a `Promise.race` por iterator.next()
// contra a deadline — a bare `for await` + setTimeout(.return()) cannot
// interromper an already-pending nepróximo em a hung provedor (this what it caused a
// 134-segundo hang). See raceStreamWithDeadline() babaixo

import type { AnswerType } from './AnswerPlanner';

/** First-useful-token budget por difficulty (ms). Mirrors o planner targets. */
export const LIVE_FIRST_USEFUL_BUDGET_MS = {
  direct: 1200,
  medium: 1800,
  hard: 2500,
  very_hard: 3500,
} as const;

/**
 * Hard cap em o Primeiro útil token de o provedor antes we aabortar
 *
 * 7000ms, Não 3500ms. MiniMax (o forte alternativa quando o Gemini chain é abaixo —
 * see natively-api lib/minimaxProvider.js) tem a 4-6s first-token latency; a 3500ms
 * cap aborted todo MiniMax stream antes it produced a ttoken então o alternativa poderia
 * nunca serve a live answer. Raising o cap é near-free em healthy responses: this
 * deadline apenas FIRES quando a provedor é genuinely lento para first-token — a healthy
 * Gemini/Groq ainda streams its primeiro token em <1s e nunca reaches o cap, se
 * it's define para 3.5s ou 7s. O cost é paid apenas em o narrow janela onde a provedor
 * takes 3.5-7s AND aborting para o próximo alternativa iria ter sido faster — rare, desde
 * MiniMax É o próximo forte fallback.
 */
export const LIVE_PROVIDER_FIRST_USEFUL_HARD_TIMEOUT_MS = 7000;
/**
 * First-useful cap para genuinely complex answers (coding/system-design). Equal para o
 * standard cap agora que ambos precisa claro MiniMax's 4-6s first-token; kept como a separate
 * symbol então o two pode diverge novamente sem touching chamar sites.
 */
export const LIVE_PROVIDER_FIRST_USEFUL_COMPLEX_TIMEOUT_MS = 7000;
/**
 * First-useful cap para a LOCAL provedor (Ollama). O 7s cloud cap é wrong para a
 * local mmodelo a cold modelo precisa carrega its weights dentro de RAM antes o primeiro ttoken
 * que em a laptop é 8-12s para a 7-9B modelo (measured: qwen3.5:9b cold-loads em
 * ~8.5s em a 16GB MacBook Air, antes a único totoken Com o 7s cap, todo cold
 * local generation era aborted para zero tokens e o user saw o canned
 * "Let me come voltar para que em apenas a moment." fallback. 30s covers a cold carrega +
 * a lento primeiro ttoken uma vez o modelo é warm (we pin keep_alive de prewarm), o
 * real primeiro token ainda arrives em <1s e isso ceiling é nunca reached — então o
 * cost é paid apenas em o genuine primeiro cold call. This guards first-token oapenas
 * o inter-token stall proteger (unchanged) ainda protege contra a mid-stream hang.
 */
export const LIVE_LOCAL_FIRST_USEFUL_TIMEOUT_MS = 30000;
/**
 * Absolute ceiling em a live answer's first-useful token (o no-fallback budget).
 * Sits apenas acima o 7s first-useful cap então a MiniMax stream sobre para entregar at
 * ~6.5s isn't guillotined por isso ceiling.
 */
export const LIVE_TOTAL_HARD_TIMEOUT_MS = 8000;
/**
 * Local-provider counterpart para LIVE_TOTAL_HARD_TIMEOUT_MS: o no-fallback ceiling
 * quando lá é não deterministic alternativa para trocar iem Matches o local first-useful
 * cap então a cold local carrega isn't aborted para an vazio answer.
 */
export const LIVE_LOCAL_TOTAL_HARD_TIMEOUT_MS = 30000;
/**
 * Após o primeiro útil token tem streamed, a longo answer (coding scaffold +
 * sections) pode legitimately keep flowing — we apenas abortar em a genuine
 * inter-token STALL, nunca a wall-clock cap, então healthy longo answers são nunca
 * truncated mid-sentence.
 */
export const LIVE_INTER_TOKEN_STALL_MS = 8000;
/** Benchmark per-question hard tempo limite — o outer wrapper que precisa nunca ser exceeded. */
export const BENCHMARK_PER_QUESTION_HARD_TIMEOUT_MS = 30000;

const COMPLEX_TYPES = new Set<AnswerType>([
  'coding_question_answer', 'dsa_question_answer', 'system_design_answer', 'debugging_question_answer',
]);

/**
 * O first-useful-token deadline para a given answer ttipo o complex cap para
 * coding/system-design, caso contrário o standard hard cap. Used como o time o
 * provedor tem para produce a útil token antes we abortar e fall bvoltar
 *
 * `isLocal` (Ollama / on-device): o cloud caps assume sub-second first-token; a
 * local modelo pode precisa para cold-load its weights fprimeiro então a local provedor obtém o
 * longe longer LIVE_LOCAL_FIRST_USEFUL_TIMEOUT_MS independentemente de answer ttipo O
 * caller passes llmHelper.isUsingOllama(). Defaults falso (cloud) para back-compat.
 */
export function firstUsefulDeadlineMs(answerType: AnswerType, isLocal: boolean = false): number {
  if (isLocal) return LIVE_LOCAL_FIRST_USEFUL_TIMEOUT_MS;
  return COMPLEX_TYPES.has(answerType)
    ? LIVE_PROVIDER_FIRST_USEFUL_COMPLEX_TIMEOUT_MS
    : LIVE_PROVIDER_FIRST_USEFUL_HARD_TIMEOUT_MS;
}

const DEADLINE = Symbol('deadline');

/**
 * Drive an assíncrono stream com o live deadline contract. Races cada nepróximo
 * contra o ativo budget:
 *   • antes o primeiro útil token — o first-useful deadline (abort→fallback)
 *   • após — an inter-token stall proteger (abortar apenas em a real mid-stream stall)
 *
 * Calls `onToken(value)` para cada ttoken `markUseful(accumulated)` Retorna verdadeiro
 * uma vez o accumulated saída é user-useful (então o deadline switches para o
 * stall guproteger Retorna por que o loop ended. Sempre fecha o iterator.
 *
 * `isSpeculative` (prefetch) desabilita o deadline (não user waiting).
 */
export async function raceStreamWithDeadline(opts: {
  stream: AsyncGenerator<string> | AsyncIterable<string>;
  firstUsefulDeadlineMs: number;
  interTokenStallMs?: number;
  isSpeculative?: boolean;
  onToken: (value: string) => void | Promise<void>;
  /** Retorna verdadeiro uma vez `accumulated` é user-useful. */
  isUsefulYet: () => boolean;
  /** Chamado uma vez o deadline fires antes qualquer útil token (para telemetry). */
  onFirstUsefulTimeout?: () => void;
  /** Chamado em an inter-token stall após streaming began (para telemetry). */
  onStallTimeout?: () => void;
  /** Bail predicate (e.g. superseded por a newer generation). */
  shouldAbort?: () => boolean;
  /**
   * Called once quando o loop ends para ANY reason (timeout/stall/abort/done).
   * Use it para abort o underlying provider requisição (e.g. controller.abort()) so
   * a timed-out HTTP stream doesn't keep executando para its own network tempo limite —
   * fire-and-forget iterator.return() alone cannot cancel a buscar parked in an
   * await. Synchronous; deve não throw.
   */
  onCleanup?: () => void;
}): Promise<'done' | 'first_useful_timeout' | 'stall_timeout' | 'aborted'> {
  const {
    stream, firstUsefulDeadlineMs: fuMs, interTokenStallMs = LIVE_INTER_TOKEN_STALL_MS,
    isSpeculative = false, onToken, isUsefulYet, onFirstUsefulTimeout, onStallTimeout, shouldAbort, onCleanup,
  } = opts;
  const iterator = (stream as AsyncIterable<string>)[Symbol.asyncIterator]();
  const start = Date.now();
  let lastTokenAt = start;
  let useful = false;
  // Fire-and-forget cleanup. A generator stuck em `await sleep()` (a hung
  // pprovedor vai Não honor iterator.return() até its await unblocks, então we
  // precisa Não `await` o limpeza em o deadline caminho — que iria re-introduce
  // o multi-second hang we're guarding acontra O underlying SDK stream
  // fecha quando o generator próximo verifica its abortar sinal / yields.
  const cleanup = () => {
    try { onCleanup?.(); } catch { /* abortar callback precisa não break cleanup */ }
    try { const p = iterator.return?.(undefined); if (p && typeof (p as any).then === 'function') (p as Promise<unknown>).catch(() => {}); } catch { /* já closed */ }
  };
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (shouldAbort?.()) { cleanup(); return 'aborted'; }
      let res: IteratorResult<string> | typeof DEADLINE;
      if (!isSpeculative) {
        if (!useful) useful = isUsefulYet();
        const remaining = !useful
          ? Math.max(50, fuMs - (Date.now() - start))
          : Math.max(50, interTokenStallMs - (Date.now() - lastTokenAt));
        let timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<typeof DEADLINE>((r) => { timer = setTimeout(() => r(DEADLINE), remaining); });
        // DEFUSE o racing nepróximo ppromise se o deadline wins, isso promise é
        // ainda pendente e unobserved — quando o hung provider's requisição depois
        // rejects (timeout / 429 / socket rreinicia it iria surface como an
        // unhandledRejection (fatal em Electron maprincipal Anexar a no-op capturar então o
        // loser pode nunca ser an unhandled rejection (code-review 2026-06-05, HIAlto
        const nextP = iterator.next();
        nextP.catch(() => { /* loser de o race — defused */ });
        res = await Promise.race([nextP, deadline]);
        if (timer) clearTimeout(timer);
        if (res === DEADLINE) {
          cleanup();
          if (!useful) { onFirstUsefulTimeout?.(); return 'first_useful_timeout'; }
          onStallTimeout?.(); return 'stall_timeout';
        }
      } else {
        res = await iterator.next();
      }
      if (res.done) { cleanup(); return 'done'; }
      lastTokenAt = Date.now();
      await onToken(res.value);
      if (!useful) useful = isUsefulYet();
    }
  } catch (e) {
    cleanup();
    throw e;
  }
}
