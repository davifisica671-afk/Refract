/**
 * ============================================================
 * CONSTANTES DE CAPTURA DE DOM (DOCUMENT OBJECT MODEL)
 * ============================================================
 * 
 * Este arquivo define constantes relacionadas à captura de
 * conteúdo de páginas web (DOM) para uso no Refract.
 * 
 * O que é captura de DOM?
 * É o processo de extrair o conteúdo de uma página web (texto,
 * código, etc.) para que o Refract possa analisar e usar
 * como contexto para respostas de IA.
 * 
 * IMPORTÂNTIA:
 * Esta constante é a FONTE DE VERDADE ÚNICA para o limite
 * de caracteres. Se alterar aqui, DEVE também alterar em:
 * electron/config/constants.ts
 * para evitar deriva entre frontend e backend.
 * ============================================================
 */

/**
 * Número máximo de caracteres permitidos no contexto de captura de DOM.
 * 
 * POR QUE 25.000?
 * - É grande o suficiente para capturar a maioria das páginas úteis
 * - É pequeno o suficiente para não sobrecarregar a memória
 * - É compatível com os limites de contexto dos modelos de IA
 * 
 * SE MUDAR:
 * Atualizar também em electron/config/constants.ts para manter
 * frontend e backend sincronizados.
 */
export const DOM_CONTEXT_MAX_CHARS = 25000;
