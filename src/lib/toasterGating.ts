/**
 * ============================================================
 * SISTEMA DE GATING DE TOASTERS (NOTIFICACIONES POP-UP)
 * ============================================================
 * 
 * Este arquivo gerencia as regras de exibição dos toasters
 * (notificações que aparecem na tela do usuário). O objetivo
 * é evitar que o usuário seja incomodado com muitas notificações.
 * 
 * REGRAS DE NEGÓCIO:
 * 1. GATING POR SESSÃO: No máximo 1 toaster por inicialização do app.
 *    Isso evita que múltiplas notificações apareçam ao mesmo tempo.
 * 
 * 2. GATING POR COOLDOWN: Um toaster específico não pode ser exibido
 *    novamente até que:
 *    - 24 horas tenham passado DESDE a última exibição, OU
 *    - 5 inicializações do app tenham ocorrido
 *    Qualquer uma das condições satisfaz o cooldown.
 * 
 * ARMAZENAMENTO:
 * - sessionStorage: Rastreia se já mostramos um toaster nesta sessão
 * - localStorage: Armazena contagem total de aberturas e timestamps
 *   de última exibição de cada toaster (persiste entre sessões)
 * 
 * FLUXO:
 * 1. App inicia → trackAppOpen() incrementa contador
 * 2. Renderer quer mostrar toaster → isToasterAllowed(id)
 * 3. Se permitido → markToasterAsShown(id) registra a exibição
 * 4. Próxima inicialização → repete o ciclo
 * ============================================================
 */

/** Chave do localStorage para a contagem total de aberturas do app */
const OPENS_COUNT_KEY = 'refract_app_opens_count';

/** Chave do sessionStorage para rastrear se a abertura já foi contada nesta sessão */
const SESSION_OPEN_TRACKED_KEY = 'refract_session_open_tracked';

/** Chave do sessionStorage para rastrear se já mostramos um toaster nesta sessão */
const SESSION_TOASTER_SHOWN_KEY = 'refract_session_toaster_shown';

/**
 * Rastreia o evento de abertura do app. Deve ser chamado UMA ÚNICA VEZ
 * durante a inicialização do app (normalmente no useEffect principal).
 * 
 * COMO FUNCIONA:
 * 1. Verifica se já contamos esta abertura nesta sessão (sessionStorage)
 * 2. Se não contou, incrementa o contador no localStorage
 * 3. Marca a sessão como "já rastreada" para não contar de novo
 * 
 * @returns O número total atualizado de aberturas do app
 */
export function trackAppOpen(): number {
  try {
    // Verificar se já rastreamos esta abertura nesta sessão
    const isTracked = sessionStorage.getItem(SESSION_OPEN_TRACKED_KEY) === 'true';
    
    // Ler contagem atual do localStorage (default: 0)
    let currentOpens = parseInt(localStorage.getItem(OPENS_COUNT_KEY) || '0', 10);
    
    // Se ainda não rastreamos, incrementar e marcar como rastreado
    if (!isTracked) {
      currentOpens += 1; // Incrementar contador
      localStorage.setItem(OPENS_COUNT_KEY, currentOpens.toString()); // Salvar nova contagem
      sessionStorage.setItem(SESSION_OPEN_TRACKED_KEY, 'true'); // Marcar sessão como rastreada
    }
    
    return currentOpens;
  } catch (e) {
    // Em caso de erro (ex: localStorage bloqueado), retornar 0
    console.warn('[ToasterGating] Falha ao rastrear abertura do app:', e);
    return 0;
  }
}

/**
 * Retorna o número total atual de aberturas do app.
 * 
 * @returns Número inteiro representando quantas vezes o app foi aberto
 */
export function getAppOpensCount(): number {
  try {
    return parseInt(localStorage.getItem(OPENS_COUNT_KEY) || '0', 10);
  } catch {
    return 0; // Fallback em caso de erro
  }
}

/**
 * Verifica se um toaster específico pode ser exibido agora.
 * 
 * LÓGICA DE VERIFICAÇÃO:
 * 1. Primeiro verifica o gating por sessão (máximo 1 toaster/sessão)
 * 2. Depois verifica o gating por cooldown (24h ou 5 aberturas)
 * 
 * @param toasterId - Identificador único do toaster (ex: 'trial_promo', 'permissions')
 * @returns true se o toaster pode ser exibido, false se está bloqueado
 */
export function isToasterAllowed(toasterId: string): boolean {
  try {
    // ============================================================
    // VERIFICAÇÃO 1: GATING POR SESSÃO
    // ============================================================
    // Se já mostramos um toaster nesta sessão, bloquear todos os outros
    const sessionToasterShown = sessionStorage.getItem(SESSION_TOASTER_SHOWN_KEY) === 'true';
    if (sessionToasterShown) {
      // Em modo desenvolvimento, logar para depuração
      if (import.meta.env.DEV) {
        console.log(`[ToasterGating] Exibição bloqueada para '${toasterId}': Já foi exibido outro toaster nesta sessão.`);
      }
      return false; // Bloqueado: já mostramos um toaster nesta sessão
    }

    // ============================================================
    // VERIFICAÇÃO 2: GATING POR COOLDOWN
    // ============================================================
    // Verificar se este toaster específico está em cooldown
    // Cooldown = 24 horas OU 5 aberturas do app desde a última exibição
    const lastShownTimeStr = localStorage.getItem(`last_shown_time_${toasterId}`);
    const lastShownOpensStr = localStorage.getItem(`last_shown_opens_${toasterId}`);

    if (lastShownTimeStr) {
      // Calcular tempo decorrido desde a última exibição
      const lastShownTime = parseInt(lastShownTimeStr, 10);
      const lastShownOpens = parseInt(lastShownOpensStr || '0', 10);
      const currentOpens = getAppOpensCount();
      const now = Date.now();

      const timeElapsedMs = now - lastShownTime; // Milissegundos desde a última exibição
      const opensElapsed = currentOpens - lastShownOpens; // Aberturas desde a última exibição

      const oneDayMs = 24 * 60 * 60 * 1000; // Milissegundos em 24 horas
      const hoursRemaining = Math.max(0, (oneDayMs - timeElapsedMs) / (1000 * 60 * 60)); // Horas restantes
      const opensRemaining = Math.max(0, 5 - opensElapsed); // Aberturas restantes

      // Verificar se o cooldown ainda está ativo
      // Se 24h NÃO passaram E 5 aberturas NÃO ocorreram, bloquear
      if (timeElapsedMs < oneDayMs && opensElapsed < 5) {
        if (import.meta.env.DEV) {
          console.log(
            `[ToasterGating] Exibição bloqueada para '${toasterId}': Cooldown ativo. ` +
            `Faltam ${hoursRemaining.toFixed(1)}h ou ${opensRemaining} aberturas do app.`
          );
        }
        return false; // Bloqueado: cooldown ainda ativo
      }
    }

    // Se chegou aqui, todas as verificações passaram - permitir exibição
    return true;
  } catch (e) {
    console.warn(`[ToasterGating] Erro ao verificar disponibilidade para '${toasterId}':`, e);
    return true; // Fallback: permitir se o armazenamento estiver corrompido
  }
}

/**
 * Marca um toaster como exibido, atualizando os registros de cooldown.
 * 
 * O QUE É ATUALIZADO:
 * - sessionStorage: Marca que já mostramos um toaster nesta sessão
 * - localStorage: Salva o timestamp da exibição e a contagem de aberturas
 * 
 * @param toasterId - Identificador único do toaster que foi exibido
 */
export function markToasterAsShown(toasterId: string): void {
  try {
    const currentOpens = getAppOpensCount(); // Contagem atual de aberturas
    const now = Date.now(); // Timestamp atual

    // Marcar na sessão que já mostramos um toaster
    sessionStorage.setItem(SESSION_TOASTER_SHOWN_KEY, 'true');
    
    // Salvar dados de cooldown para este toaster específico
    localStorage.setItem(`last_shown_time_${toasterId}`, now.toString()); // Timestamp da exibição
    localStorage.setItem(`last_shown_opens_${toasterId}`, currentOpens.toString()); // Contagem na exibição
    
    console.log(`[ToasterGating] Exibição registrada para '${toasterId}' (Abertura #${currentOpens})`);
  } catch (e) {
    console.warn(`[ToasterGating] Erro ao marcar toaster '${toasterId}' como exibido:`, e);
  }
}
