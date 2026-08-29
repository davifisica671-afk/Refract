/**
 * ============================================================
 * CATEGORIZAÇÃO DE ERROS STT (SPEECH-TO-TEXT)
 * ============================================================
 * 
 * Este arquivo mapeia mensagens de erro brutas dos provedores STT
 * (Speech-to-Text) para títulos e mensagens amigáveis ao usuário.
 * 
 * POR QUE É NECESSÁRIO?
 * Provedores diferentes retornam erros em formatos diferentes:
 * - OpenAI: "401 Unauthorized"
 * - Groq: "invalid_api_key"
 * - Deepgram: "WebSocket connection failed"
 * 
 * Em vez de mostrar erros técnicos ao usuário, categorizamos e
 * traduzimos para mensagens compreensíveis.
 * 
 * SISTEMA DE CATEGORIZAÇÃO:
 * - Erros são verificados em ORDEM DE PRIORIDADE
 * - A primeira correspondência vence
 * - Cada categoria tem: título curto, mensagem explicativa, chave interna
 * 
 * CATEGORIAS SUPORTADAS:
 * 1. auth - Falha de autenticação (chave inválida/expirada)
 * 2. access_denied - Acesso negado (restrição geográfica/permissões)
 * 3. quota - Cota de uso excedida
 * 4. rate_limited - Muitas requisições (throttling)
 * 5. connection_lost - Conexão perdida
 * 6. timed_out - Tempo esgotado
 * 7. service_unavailable - Serviço indisponível (erro 5xx)
 * 8. invalid_config - Configuração inválida
 * 9. session_conflict - Conflito de sessão
 * 10. provider_error - Erro genérico do provedor
 * ============================================================
 */

/**
 * Interface que define a estrutura de uma categoria de erro STT.
 */
export interface SttErrorCategory {
    /** Título curto para exibição na UI (ex: "Falha na Autenticação") */
    title: string;
    
    /** Mensagem explicativa com orientação prática para o usuário */
    body: string;
    
    /** Chave de categoria interna para diagnósticos e logging */
    category: SttErrorCategoryId;
}

/**
 * Tipo que representa os IDs das categorias de erro STT.
 * Usado para validação de tipo e referência interna.
 */
export type SttErrorCategoryId =
    | 'auth'              // Falha de autenticação
    | 'access_denied'     // Acesso negado
    | 'quota'             // Cota excedida
    | 'rate_limited'      // Taxa limitada
    | 'connection_lost'   // Conexão perdida
    | 'timed_out'         // Tempo esgotado
    | 'service_unavailable' // Serviço indisponível
    | 'invalid_config'    // Configuração inválida
    | 'session_conflict'  // Conflito de sessão
    | 'provider_error';   // Erro genérico do provedor

/**
 * Categoriza uma mensagem de erro STT bruta em uma exibição amigável ao usuário.
 * 
 * COMO FUNCIONA:
 * 1. Converte a mensagem para minúsculas para comparação case-insensitive
 * 2. Verifica padrões conhecidos em ordem de prioridade
 * 3. Retorna a primeira categoria correspondente
 * 4. Se nenhuma correspondência, retorna erro genérico
 * 
 * @param rawError - Mensagem de erro bruta do provedor STT
 * @returns Objeto com título, mensagem e categoria do erro
 */
export function categorizeSttError(rawError: string): SttErrorCategory {
    const lower = rawError.toLowerCase(); // Normalizar para minúsculas

    // ============================================================
    // 1. ERROS DE AUTENTICAÇÃO (FATAIS IMEDIATOS)
    // ============================================================
    // Padrões: "401", "invalid_key", "unauthorized", etc.
    // Esses erros não se resolvem sozinhos - usuário precisa corrigir a chave
    if (
        rawError.startsWith('401 ')           // HTTP 401 Unauthorized
        || lower.includes('auth_timeout')     // Timeout na autenticação
        || lower.includes('invalid_key')      // Chave inválida
        || lower.includes('invalid api')      // Formato de API key inválido
        || lower.includes('authentication')   // Erro genérico de autenticação
        || lower.includes('invalid_key_format') // Formato incorreto da chave
        || lower.includes('auth_error')       // Erro de autenticação
        || lower.includes('unauthorized')     // Não autorizado
    ) {
        return {
            title: 'Falha na Autenticação',
            body: 'Sua chave de API é inválida ou expirou. Verifique suas configurações.',
            category: 'auth',
        };
    }

    // ============================================================
    // 2. ACESSO NEGADO / BLOQUEIO GEOGRÁFICO
    // ============================================================
    // HTTP 403 Forbidden - serviço não disponível na região ou sem permissões
    if (rawError.startsWith('403 ') || lower.includes('forbidden')) {
        return {
            title: 'Acesso Negado',
            body: 'Este serviço não está disponível na sua região ou sua chave de API não tem as permissões necessárias.',
            category: 'access_denied',
        };
    }

    // ============================================================
    // 3. TRIAL EXPIRADO (REFRACTPRO)
    // ============================================================
    // Erro específico do RefractPro quando o período de teste acabou
    if (lower.includes('trial_expired')) {
        return {
            title: 'Período de Teste Expirado',
            body: 'Seu período de teste do Refract Pro terminou. Atualize seu plano para continuar usando STT.',
            category: 'auth',
        };
    }

    // ============================================================
    // 4. COTA EXCEDIDA
    // ============================================================
    // Usuário atingiu o limite de transcrições do período
    if (
        lower.includes('transcription_quota_exceeded')
        || lower.includes('quota')
    ) {
        return {
            title: 'Limite de Transcrição Atingido',
            body: 'Você excedeu sua cota de transcrição para este período.',
            category: 'quota',
        };
    }

    // ============================================================
    // 5. TAXA LIMITADA (THROTTLING)
    // ============================================================
    // HTTP 429 Too Many Requests - muitas requisições simultâneas
    if (rawError.startsWith('429 ') || lower.includes('too many requests') || lower.includes('rate limit')) {
        return {
            title: 'Taxa Limitada',
            body: 'Muitas requisições. O serviço está limitando sua conexão.',
            category: 'rate_limited',
        };
    }

    // ============================================================
    // 6. CONEXÃO PERDIDA
    // ============================================================
    // Erros de rede: conexão recusada, DNS, reset, pipe quebrado
    if (
        lower.includes('econnrefused')                    // Conexão recusada pelo servidor
        || lower.includes('enotfound')                    // DNS não resolveu o hostname
        || lower.includes('econnreset')                   // Conexão resetada pelo servidor
        || lower.includes('epipe')                        // Pipe quebrado (servidor fechou)
        || lower.includes('max reconnect attempts exceeded') // Máximo de tentativas de reconexão
        || lower.includes('abnormal closure')             // Fechamento anormal do WebSocket
    ) {
        return {
            title: 'Conexão Perdida',
            body: 'Não foi possível alcançar o serviço STT. Verifique sua conexão com a internet.',
            category: 'connection_lost',
        };
    }

    // ============================================================
    // 7. TEMPO ESGOTADO
    // ============================================================
    // Serviço não respondeu dentro do tempo limite
    if (
        lower.includes('etimedout')              // Timeout de conexão
        || lower.includes('connection timeout')  // Timeout de conexão
        || lower.includes('session setup timeout') // Timeout na configuração da sessão
        || lower.includes('timed out')           // Genérico de timeout
        || lower.includes('deadline exceeded')   // Deadline do Google Cloud
    ) {
        return {
            title: 'Conexão Esgotada',
            body: 'O serviço STT não respondeu a tempo. Tentando reconectar...',
            category: 'timed_out',
        };
    }

    // ============================================================
    // 8. SERVIÇO INDISPONÍVEL (ERROS 5xx)
    // ============================================================
    // Erros internos do servidor - geralmente temporários
    if (
        rawError.startsWith('500 ')              // Internal Server Error
        || rawError.startsWith('502 ')           // Bad Gateway
        || rawError.startsWith('503 ')           // Service Unavailable
        || lower.includes('internal server error')
        || lower.includes('bad gateway')
        || lower.includes('service unavailable')
        || lower.includes('unavailable')
    ) {
        return {
            title: 'Serviço Indisponível',
            body: 'O provedor de transcrição está com problemas. Tentando reconectar...',
            category: 'service_unavailable',
        };
    }

    // ============================================================
    // 9. CONFIGURAÇÃO INVÁLIDA
    // ============================================================
    // Requisição malformada ou parâmetros incorretos
    if (rawError.startsWith('400 ') || lower.includes('bad request') || lower.includes('invalid argument')) {
        return {
            title: 'Configuração Inválida',
            body: 'O serviço STT rejeitou a requisição. Verifique suas configurações.',
            category: 'invalid_config',
        };
    }

    // ============================================================
    // 10. CONFLITO DE SESSÃO (REFRACTPRO)
    // ============================================================
    // Outra sessão de transcrição já está ativa
    if (lower.includes('concurrent_session_blocked')) {
        return {
            title: 'Conflito de Sessão',
            body: 'Outra sessão está ativa. Aguarde um momento e tente novamente.',
            category: 'session_conflict',
        };
    }

    // ============================================================
    // 11. ERRO GENÉRICO DO PROVEDOR (FALLBACK)
    // ============================================================
    // Se nenhum padrão conhecido foi encontrado
    return {
        title: 'Erro do Provedor STT',
        body: 'O serviço de transcrição encontrou um problema inesperado.',
        category: 'provider_error',
    };
}
