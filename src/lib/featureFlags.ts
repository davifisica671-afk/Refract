/**
 * ============================================================
 * FLAGS DE RECURSOS (FEATURE FLAGS) DO FRONTEND
 * ============================================================
 * 
 * Este arquivo controla quais funcionalidades premium estão habilitadas
 * na interface do usuário. É um sistema de "feature flags" que permite
 * ligar/desligar funcionalidades sem precisar alterar o código-fonte.
 * 
 * COMO FUNCIONA:
 * - No backend, os recursos premium são controlados via chamadas IPC
 *   para electronAPI (verificação de licença, plano do usuário, etc.)
 * - Este arquivo é uma camada OPCIONAL no frontend que permite
 *   ocultar completamente elementos de UI premium da build de código aberto
 * - Se PREMIUM_ENABLED for false, botões de upgrade, toasters de promo,
 *   e outros elementos premium não são renderizados
 * 
 * IMPORTANTE:
 * Todos os componentes premium já "degradam graciosamente" quando o
 * backend retorna false para verificação de licença. Ou seja, mesmo
 * se esta flag for true, o usuário não verá conteúdo premium se não
 * tiver uma licença válida. Esta flag é primariamente para controle
 * cosmético (ocultar botões de atualização, toasters de promo, etc.)
 * 
 * PARA DESENVOLVEDORES:
 * Defina PREMIUM_ENABLED como false para builds de demonstração ou
 * testes onde não se deseja mostrar elementos de monetização.
 * ============================================================
 */

export const FEATURES = {
  /**
   * Flag principal que controla a visibilidade de elementos premium na UI.
   * 
   * VALORES:
   * - true: Elementos premium são renderizados (comportamento padrão)
   * - false: Elementos premium são completamente ocultos da interface
   * 
   * NOTA: Mesmo quando true, o acesso real aos recursos premium
   * ainda depende da verificação de licença no backend.
   */
  PREMIUM_ENABLED: true,
} as const; // 'as const' garante que o objeto é readonly e os valores são literais
