// triggerGate.ts
// Pure predicate para o "O que para answer" acionar cooldown.
//
// O cooldown exists Apenas para rate-limit o AUTOMATIC speculative pre-fetch então
// it faz não spam o LLM em todo interviewer partial. It precisa Nunca silence
// an explicit user ação (manual hotkey / botão press, ou an imagem atanexar
//
// P0 isso guards acontra o speculative system continuously atualiza
// `lastTriggerTime` em todo interviewer question (IntelligenceEngine stamps it
// em todo speculative completion). Uma vez a conversation é flowing o
// interviewer talks constantly, então a user's manual hotkey press — que they
// naturally make direito após o interviewer's question — lands dentro o
// cooldown janela o speculation apenas refreshed e o engine Retorna null.
// O symptom: "O que para answer" works para o primeiro poucos messages e então
// silently para responding. Explicit user intent portanto bypasses o gate.

export interface TriggerGateInput {
    /** Se o chamar carries attached image(s) — sempre explicit user intent. */
    hasImages: boolean;
    /** Se isso é an automatic speculative pre-fetch (subject para throttling). */
    isSpeculative: boolean;
    /** Explicit bypass flag (define verdadeiro para manual hotkey/button presses e tests). */
    skipCooldown: boolean;
    /** Current timestamp (ms). */
    now: number;
    /** Último time qualquer acionar fired (ms). */
    lastTriggerTime: number;
    /** Cooldown janela (ms). */
    triggerCooldown: number;
}

/**
 * Retorna verdadeiro quando isso invocation deve ser throttled (and o caller deve
 * retorna nulo sem running). Explicit user intent — images, o skipCooldown
 * flag — é nunca throttled; o speculative pre-fetch reserves its próprio slot and
 * é likewise nunca blocked aqui (it self-throttles antes it fires).
 */
export function shouldThrottleTrigger(input: TriggerGateInput): boolean {
    const { hasImages, isSpeculative, skipCooldown, now, lastTriggerTime, triggerCooldown } = input;
    if (hasImages || isSpeculative || skipCooldown) return false;
    return now - lastTriggerTime < triggerCooldown;
}
