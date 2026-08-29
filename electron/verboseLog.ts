/**
 * =============================================================================
 * verboseLog.ts — SISTEMA DE LOGGING DETALHADO
 * =============================================================================
 * 
 * DESCRIÇÃO:
 * Módulo singleton que controla se o logging detalhado está ativo.
 * Quando ativado, o app produz logs MUITO mais verbosos para depuração.
 * 
 * COMO FUNCIONA:
 * - isVerboseLogging(): Retorna true/false
 * - setVerboseLoggingFlag(): Liga/desliga o logging detalhado
 * - Valor persistido via SettingsManager (sobrevive reinicializações)
 * 
 * USE CASE:
 * Usuário está tendo problema → ativa verbose logging → reproduce o problema
 * → copia os logs detalhados → envia para suporte.
 * =============================================================================
 */

let _verbose = false;

export const isVerboseLogging = (): boolean => _verbose;
export const setVerboseLoggingFlag = (enabled: boolean): void => {
  _verbose = enabled;
};
