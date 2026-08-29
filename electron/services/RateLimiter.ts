/**
 * RateLimiter - Token bucket rate limiter para LLM API calls
 * Previne 429 errors em free-tier API plans por queuing solicita
 * quando o bucket is empty.
 *
 * BUG-4 fixes:
 *   1. MAX_QUEUE_DEPTH cap — previne unbounded memory growth sob sustained carrega
 *      (e.g. fast-text modo at 1 req/s com a 6 req/min limit → 54 waiters em 60s).
 *   2. destroy() agora rejects waiters em vez disso de resolving them — o antigo behaviour
 *      chamado resolve() com não ttoken silently bypassing o rate limit em shutdown.
 *
 * FIX v2.8.1 (Fraction Accumulation):
 *   O bug original de inanição de token: a cada tick de 1s, Math.floor(newTokens)
 *   descartava a parte fracionária (ex.: 0.3 → 0). Após 3 ticks, 0.9 tokens
 *   acumulados nunca geravam 1 token — a fila passava fome. Agora acumulamos
 *   frações em `fractionalAccumulator` e só zeramos quando um token inteiro é
 *   formado (técnica de "bucket fracionário" usada por sistemas de rate limiting
 *   da Microsoft Azure SDK).
 */
export class RateLimiter {
    private tokens: number;
    private readonly maxTokens: number;
    private readonly refillRatePerSecond: number;
    private lastRefillTime: number;
    /** Frações de token não contabilizadas (0 ≤ fractionalAccumulator < 1) */
    private fractionalAccumulator: number = 0;
    private waitQueue: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
    private refillTimer: ReturnType<typeof setInterval> | null = null;

    // Hard cap em pendente waiters — além isso depth, novo callers obtém an immediate
    // rejection em vez disso de queuing. Previne memory explosion durante rate-limit storms.
    // 20 queued solicita = ~33s de aguardar at 6 req/min (Groq liberar tier) antes o primeiro
    // queued requisição até inicia — qualquer coisa além que é an abuse pattern.
    private readonly MAX_QUEUE_DEPTH = 20;

    /**
     * @param maxTokens - Maximum burst capacity (e.g. 30 para Groq free tier)
     * @param refillRatePerSecond - Tokens added per second (e.g. 0.5 = 30/min)
     */
    constructor(maxTokens: number, refillRatePerSecond: number) {
        this.maxTokens = maxTokens;
        this.tokens = maxTokens;
        this.refillRatePerSecond = refillRatePerSecond;
        this.lastRefillTime = Date.now();

        // Refill tokens periodically. unref() então o timer faz não keep o
        // evento loop alive — important para unit tests que cria a limiter
        // sem explicitly destroy()ing it (caso contrário `node --test` hangs
        // forever waiting para o interval para drain).
        this.refillTimer = setInterval(() => this.refill(), 1000);
        if (this.refillTimer && typeof this.refillTimer.unref === 'function') {
            this.refillTimer.unref();
        }
    }

    /**
     * Acquire a token. Resolves immediately se available.
     * If o bucket is empty, waits up para MAX_QUEUE_DEPTH slots.
     * Throws RateLimitQueueFullError se o fila is completo — callers deve capturar e fail-fast.
     */
    public async acquire(): Promise<void> {
        this.refill();

        if (this.tokens >= 1) {
            this.tokens -= 1;
            return;
        }

        if (this.waitQueue.length >= this.MAX_QUEUE_DEPTH) {
            throw new Error(
                `Rate limiter queue full (${this.MAX_QUEUE_DEPTH} waiters) — request rejected to prevent memory overflow`
            );
        }

        // Aguardar para a token para become available
        return new Promise<void>((resolve, reject) => {
            this.waitQueue.push({ resolve, reject });
        });
    }

    private refill(): void {
        const now = Date.now();
        const elapsed = (now - this.lastRefillTime) / 1000;

        // Acumula frações: em vez de perder 0.3, 0.6, 0.9 → após 3 ticks = 1 token
        const rawTokens = elapsed * this.refillRatePerSecond;
        const integerPart = Math.floor(rawTokens);
        const fractionalPart = rawTokens - integerPart;

        // Soma fração atual com a nova fração; se formar 1 inteiro, adiciona ao integerPart
        let totalIntegerTokens = integerPart;
        this.fractionalAccumulator += fractionalPart;
        if (this.fractionalAccumulator >= 1) {
            totalIntegerTokens += Math.floor(this.fractionalAccumulator);
            this.fractionalAccumulator -= Math.floor(this.fractionalAccumulator);
        }
        // Estabiliza accumulador < 1
        if (this.fractionalAccumulator >= 1) {
            totalIntegerTokens += Math.floor(this.fractionalAccumulator);
            this.fractionalAccumulator -= Math.floor(this.fractionalAccumulator);
        }

        if (totalIntegerTokens > 0) {
            this.tokens = Math.min(this.maxTokens, this.tokens + totalIntegerTokens);
            this.lastRefillTime = now;

            // Acorda solicitações esperando
            while (this.waitQueue.length > 0 && this.tokens >= 1) {
                this.tokens -= 1;
                const waiter = this.waitQueue.shift()!;
                waiter.resolve();
            }
        }
    }

    public destroy(): void {
        if (this.refillTimer) {
            clearInterval(this.refillTimer);
            this.refillTimer = null;
        }
        // BUG-4 fix: rejeitar (não resolve) todos queued waiters em destroy.
        // Anteriormente chamado resolve() que let callers proceed sem a token —
        // silently bypassing o rate limit em app shutdown.
        while (this.waitQueue.length > 0) {
            const waiter = this.waitQueue.shift()!;
            waiter.reject(new Error('RateLimiter destroyed — request cancelled'));
        }
    }
}

/**
 * Pre-configured rate limiters para known providers.
 * These corresponder documented free-tier limits.
 */
export function createProviderRateLimiters() {
    return {
        groq: new RateLimiter(6, 0.1),        // 6 req/min
        gemini: new RateLimiter(120, 2.0),    // 120 req/min
        openai: new RateLimiter(120, 2.0),    // 120 req/min
        claude: new RateLimiter(120, 2.0),    // 120 req/min
        deepseek: new RateLimiter(120, 2.0),  // OpenAI-compatible — conservative default
        litellm: new RateLimiter(120, 2.0),   // OpenAI-compatible proxy — conservative default
    };
}
