/**
 * =============================================================================
 * constants.ts — CONSTANTES GLOBAIS DO APLICATIVO
 * =============================================================================
 * 
 * DESCRIÇÃO:
 * Constantes compartilhadas entre o processo principal e o renderer.
 * Esses valores são usados em MÚLTIPLOS arquivos e devem ser definidos
 * em um só lugar para evitar inconsistência.
 * 
 * CONSTANTES:
 * - TRIAL_SENTINEL_KEY: Valor especial armazenado quando trial gratuito está ativo
 * - DOM_CONTEXT_MAX_CHARS: Limite de caracteres para contexto de página web
 * =============================================================================
 */

/**
 * Valor sentinela armazenado em `refractApiKey` enquanto o trial gratuito está ativo.
 *
 * O token do trial (`refract_trial_…`) *não* é uma chave de API válida, mas o
 * código downstream (LLMHelper, RefractProSTT, ipcHandlers) precisa tratar o
 * "modo trial" de forma idêntica ao "modo chave" para roteamento/auto-promoção. Armazenamos
 * esse sentinela no CredentialsManager então o `if (refractApiKey)` existente
 * se acende normalmente e troca o cabeçalho de autenticação para `x-trial-token` na
 * rede real.
 *
 * Qualquer lugar que lê `refractApiKey` e encaminha para a rede precisa
 * comparar contra TRIAL_SENTINEL_KEY (não o literal '__trial__') então uma única
 * renomeação aqui atualiza todos os locais de chamada.
 */
export const TRIAL_SENTINEL_KEY = '__trial__' as const;

// Fonte de verdade única para o limite de caracteres de captura de DOM.
// Se alterar, também atualizar a constante correspondente em src/constants/domCapture.ts para prevenir deriva.
export const DOM_CONTEXT_MAX_CHARS = 25000;

