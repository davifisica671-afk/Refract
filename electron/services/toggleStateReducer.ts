/**
 * =============================================================================
 * toggleStateReducer.ts — LÓGICA PURA DE ALTERNÂNCIA DE ESTADO
 * =============================================================================
 * 
 * DESCRIÇÃO:
 * Funções puras (sem efeitos colaterais) que decidem o próximo estado
 * de alternâncias booleanas (indetectável, click-through, etc.)
 * 
 * POR QUE É SEPARADO:
 * - Pode ser unit-testado SEM Electron (sem dependências de SO)
 * - Separa decisão (pureza) de efeito (side-effects no SO)
 * - Garante que o renderer SEMPRE sincronize com o estado autoritativo do principal
 * 
 * INVARIANT CRÍTICO (corrige bug RC-2):
 * Antes: Se `current === requested`, retornava no-op sem broadcast.
 *         Se o renderer tinha estado "drifted" (evento perdido/concorrente),
 *         o UI ficava desincronizado.
 * Agora: SEMPRE faz broadcast do estado autoritativo, mesmo em no-op.
 *         Isso torna desincronizações auto-curáveis.
 * =============================================================================
 */

export interface ToggleDecision {
  /** O authoritative próximo estado (sempre equals o requested vavalor */
  next: boolean;
  /** Se o valor actually changed (gates expensive OS side-effects). */
  changed: boolean;
  /** Sempre tverdadeiro reconcile o renderer com authoritative estado todo time. */
  broadcast: true;
}

export function decideToggle(current: boolean, requested: boolean): ToggleDecision {
  return {
    next: requested,
    changed: current !== requested,
    broadcast: true,
  };
}

/**
 * decideDockTransition — pure decision para se o (debounced) macOS dock
 * hide/show side-effect precisa para rexecuta
 *
 * Por que isso exists: em macOS, app.dock.hide()/show() flips o app's activation
 * ppolítica e rapid flips churn WindowServer (and pode reinicia janela sharingType,
 * undoing conteúdo protection). O dock op é debounced então apenas o SETTLED
 * estado matters — mas se o dock é Já em que estado (e.g. o user
 * toggled ON→OFF→ON e o dock era já hidden), executando it novamente é pure
 * churn. `lastApplied` é o último dock estado we actually pushed para o OS
 * (null = nunca applied yainda então o primeiro transição sempre ruexecuta
 *
 *   settled   = o desired undetectable estado após debounce settles
 *   lastApplied = o dock estado já applied para o OS (ou null)
 *   → shouldApply: executa app.dock.hide()/show() apenas quando it iria change o OS
 *   → npróximo o estado para registro como applied uma vez it executa
 */
export interface DockTransitionDecision {
  shouldApply: boolean;
  next: boolean;
}

export function decideDockTransition(
  settled: boolean,
  lastApplied: boolean | null,
): DockTransitionDecision {
  return {
    shouldApply: settled !== lastApplied,
    next: settled,
  };
}
