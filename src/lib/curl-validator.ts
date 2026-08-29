/**
 * ============================================================
 * VALIDADOR DE COMANDOS cURL
 * ============================================================
 * 
 * Este arquivo valida comandos cURL inseridos pelo usuário para
 * uso como provedor personalizado de IA.
 * 
 * POR QUE VALIDAR cURL?
 * O Refract permite que usuários configurem provedores de IA
 * personalizados usando comandos cURL. Precisamos garantir que:
 * 1. O comando comece com "curl"
 * 2. Tenha sintaxe válida (parsing não falhe)
 * 3. Contenha o placeholder {{TEXT}} para injeção de mensagens
 * 
 * FLUXO:
 * 1. Usuário cola um comando cURL na interface
 * 2. validateCurl() verifica se é válido
 * 3. Se válido, retorna o JSON parseado para uso posterior
 * 4. Se inválido, retorna mensagem de erro amigável
 * ============================================================
 */

// ============================================================
// IMPORTAÇÕES
// ============================================================
import curl2Json from "@bany/curl-to-json"; // Biblioteca para converter cURL em objeto JSON

/**
 * Interface que define o resultado da validação de cURL.
 */
export interface CurlValidationResult {
    isValid: boolean;    // Se o comando cURL é válido
    message?: string;    // Mensagem de erro (apenas se inválido)
    json?: any;          // Objeto JSON do cURL parseado (apenas se válido)
}

/**
 * Valida um comando cURL e retorna o resultado da validação.
 * 
 * VERIFICAÇÕES REALIZADAS:
 * 1. Comando não pode ser vazio
 * 2. Deve começar com "curl" (case-insensitive)
 * 3. Deve ter sintaxe válida (parsing com curl2Json)
 * 4. Deve conter o placeholder {{TEXT}}
 * 
 * @param curl - String do comando cURL a ser validado
 * @returns Objeto com resultado da validação
 */
export const validateCurl = (curl: string): CurlValidationResult => {
    // Verificar se o comando não está vazio
    if (!curl || !curl.trim()) {
        return { isValid: false, message: "O comando não pode estar vazio." };
    }

    // Verificar se começa com "curl" (case-insensitive)
    if (!curl.trim().toLowerCase().startsWith("curl")) {
        return {
            isValid: false,
            message: "O comando deve começar com 'curl'.",
        };
    }

    try {
        // Tentar fazer o parse do comando cURL para JSON
        const json = curl2Json(curl);

        // Verificar se contém o placeholder {{TEXT}}
        // Este placeholder é onde a mensagem do usuário será injetada
        if (!curl.includes("{{TEXT}}")) {
            return {
                isValid: false,
                message: "Seu cURL deve conter a variável {{TEXT}} para injetar a mensagem do usuário."
            };
        }

        // Tudo válido - retornar o JSON parseado
        return { isValid: true, json };
    } catch (error) {
        // Erro no parsing - sintaxe inválida
        return {
            isValid: false,
            message:
                "Sintaxe do comando cURL inválida. Por favor, verifique se há erros de digitação.",
        };
    }
};
