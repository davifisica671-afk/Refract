/**
 * =============================================================================
 * redactForLog.ts — REDATOR DE SEGURANÇA PARA LOGS
 * =============================================================================
 * 
 * DESCRIÇÃO:
 * Módulo de SEGURANÇA que remove/redige dados sensíveis de strings
 * ANTES de escrevê-las em logs ou console. Isso é CRÍTICO porque:
 * 
 * POR QUE EXISTE:
 * - Logs são compartilhados para suporte/diagnóstico
 * - Logs podem ser acessados por outros processos no sistema
 * - Logs podem ser enviados para serviços de monitoramento
 * - NUNCA devem conter: chaves de API, transcrições do usuário,
 *   tokens de autenticação, corpos de resposta da API, etc.
 * 
 * O QUE É REDATADO:
 * - Chaves de API (sk-*, gsk_*, AIza*, etc.)
 * - Tokens de autenticação (Bearer tokens, JWTs)
 * - Transcrições de áudio do usuário
 * - Prompts enviados para LLMs
 * - Caminhos de capturas de tela
 * - Corpos de erro com conteúdo sensível
 * 
 * PADRÕES DETECTADOS E REMOVIDOS:
 * - Bearer abc123... → "Bearer [REDACTED]"
 * - sk-ant-api03-... → "[REDACTED]"
 * - eyJhbGciOi... (JWT) → "[REDACTED]"
 * - Chaves em propriedades de objeto (api_key, token, etc.)
 * 
 * SEGURANÇA:
 * - Livre de framework (sem dependências externas)
 * - Livre de efeitos colaterais
 * - Pode ser importado com segurança do preload
 * =============================================================================
 */

// electron/utils/redactForLog.ts
// Auxiliar centralizado de redação de logs
// Garante que nenhuma linha de log contenha conteúdo verbatim do usuário
// (transcrições, prompts, corpo de arquivos de referência, caminhos de capturas de tela,
// áudio base64) nem credenciais (chaves de API, tokens de trial, cabeçalhos de autenticação).
// Livre de framework e efeitos colaterais para uso seguro tanto do principal quanto do preload.

const REDACTED = '[REDACTED]';
const REMOVED = '[REMOVED]';
const MAX_PREVIEW_LEN = 120;

/**
 * Propriedades-chave cujo valor deve ser REDATADO na saída serializada do registro.
 * A lista espelha TelemetryService.SENSITIVE_KEY_RE mas é definida independentemente
 * aqui para que o redator não tenha dependência de tempo de execução no módulo de
 * telemetria (evita importação circular com main.ts).
 */
const SENSITIVE_KEY_RE = /(api[_-]?key|authorization|bearer|token|secret|password|credential|raw[_-]?(transcript|prompt|reference|content|query)|transcript(text)?|prompt|reference(content)?|evidence(text)?|screenshot(path)?|image(path)?|error(body|response|message)?|responsebody|body|query(text|string)?|user(input|message)|chunk(text|content)?|snippet(text)?|cookie|set[_-]?cookie|signature|x[_-]?api[_-]?key|x[_-]?trial[_-]?token|x[_-]?refract[_-]?key|x[_-]?natively[_-]?key)$/i;

/**
 * Propriedades-chave cujo valor deve ser completamente REMOVIDO (não apenas redatado)
 * porque são garantidamente conteúdo bruto volumoso — mesmo deixar uma
 * string truncada ainda vazaria.
 */
const REMOVE_VALUE_KEY_RE = /(raw[_-]?(transcript|prompt|reference|content|query)|transcript(text)?|prompt|reference(content)?|evidence(text)?|screenshot(path)?|image(path)?|error(body|response)?|responsebody|body|query(text|string)?|user(input|message)|chunk(text|content)?|snippet(text)?|base64|audio[_-]?data)$/i;

/**
 * Padrões de substring que removem sequências com formato de credencial de texto livre
 * (ex: uma linha de registro como "auth: Bearer abc123def..." que não estava envolvida em um
 * pacote de propriedades adequado).
 */
const VALUE_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
    { regex: /Bearer\s+[A-Za-z0-9._~+\/=:-]{12,}/gi, replacement: 'Bearer [REDACTED]' },
    { regex: /x-(refract|natively|trial|api)-(key|token)\s*[:=]\s*[A-Za-z0-9._~+\/=:-]{8,}/gi, replacement: '$&[REDACTED]'.replace(/(=|:)\s*[A-Za-z0-9._~+\/=:-]{8,}/, '$1 [REDACTED]') },
    { regex: /refract_sk_[A-Za-z0-9._-]+/gi, replacement: REDACTED },
    { regex: /natively_sk_[A-Za-z0-9._-]+/gi, replacement: REDACTED },
    { regex: /sk-[A-Za-z0-9]{20,}/gi, replacement: REDACTED },
    { regex: /gsk_[A-Za-z0-9]{20,}/gi, replacement: REDACTED },
    { regex: /dg_[A-Za-z0-9]{20,}/gi, replacement: REDACTED },
    { regex: /AIza[A-Za-z0-9_-]{20,}/g, replacement: REDACTED },
    { regex: /sk-ant-api03-[A-Za-z0-9_-]{20,}/g, replacement: REDACTED },
    // JWT-shaped triple-base64 sequences (header.payload.signature).
    { regex: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, replacement: REDACTED },
];

/**
 * Redator com perda para argumentos de registro. Sempre retorna uma string adequada para
 * anexar ao arquivo de registro ou stdout.
 *
 * - Erros → pilha/mensagem com padrões de credencial removidos.
 * - Objetos/arrays simples → JSON, com chaves sensíveis removidas/redatadas.
 * - Strings/números/booleans → string com padrões de credencial removidos.
 */
export function redactForLog(args: unknown[]): string {
    return args
        .map(arg => formatOne(arg))
        .join(' ');
}

/**
 * Redator de nível inferior que retorna um clone sanitizado de qualquer valor. Útil
 * para código que deseja registrar um objeto estruturado em vez de uma string e
 * ainda deseja aplicar a redação.
 */
export function redactValue(value: unknown): unknown {
    return sanitize(value, new WeakSet());
}

function formatOne(arg: unknown): string {
    if (arg instanceof Error) {
        const base = arg.stack || arg.message || 'Error';
        return scrubString(base);
    }
    if (typeof arg === 'object' && arg !== null) {
        try {
            return JSON.stringify(sanitize(arg, new WeakSet()));
        } catch {
            return '[Unserializable]';
        }
    }
    if (typeof arg === 'string') return scrubString(arg);
    if (typeof arg === 'bigint') return arg.toString();
    if (typeof arg === 'undefined') return 'undefined';
    return String(arg);
}

function sanitize(value: unknown, seen: WeakSet<object>): unknown {
    if (value === null || value === undefined) return value;

    if (typeof value === 'string') return scrubString(value).slice(0, MAX_PREVIEW_LEN);
    if (typeof value === 'number' || typeof value === 'boolean') {
        return Number.isNaN(value as number) ? null : value;
    }
    if (typeof value === 'bigint') return (value as bigint).toString();
    if (typeof value === 'function' || typeof value === 'symbol') return undefined;

    if (value instanceof Error) {
        return {
            name: value.name,
            message: scrubString(value.message ?? ''),
            stack: scrubString(value.stack ?? ''),
        };
    }

    if (Array.isArray(value)) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
        return value.map(item => sanitize(item, seen)).filter(item => item !== undefined);
    }

    if (typeof value === 'object') {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);

        const output: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            if (REMOVE_VALUE_KEY_RE.test(key)) {
                output[key] = REMOVED;
            } else if (SENSITIVE_KEY_RE.test(key)) {
                output[key] = REDACTED;
            } else {
                const sanitized = sanitize(child, seen);
                if (sanitized !== undefined) output[key] = sanitized;
            }
        }
        return output;
    }

    return undefined;
}

function scrubString(value: string): string {
    let scrubbed = value;
    for (const { regex, replacement } of VALUE_PATTERNS) {
        scrubbed = scrubbed.replace(regex, replacement);
    }
    return scrubbed;
}
