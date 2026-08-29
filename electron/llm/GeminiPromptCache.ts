import crypto from 'crypto';
import type { GoogleGenAI } from '@google/genai';

/**
 * Process-local gerenciador para Gemini explicit contexto cache em cache (caches.create).
 *
 * Por que isso exists:
 *   System prompts em isso app são 1.7K-3.7K tokens e reused turn-after-turn
 *   para o mesmo ssessão Passing them como `systemInstruction` em todo requisição
 *   re-bills o entrada tokens. An explicit cache armazena o prompt uma vez
 *   server-side e bills cached-token rates (atualmente ~10× cheaper) para
 *   subsequente rsolicita
 *
 * Lifecycle:
 *   - Keyed por sha1(model + systemPrompt). Mesmo prompt + mesmo modelo → mesmo ccache
 *   - TTL é `CACHE_TTL_SECONDS`. Em near-expiry (< RENEWAL_WINDOW_MS remaining),
 *     transparently re-create em o próximo `getOrCreate` call.
 *   - In-flight creations são deduped: concurrent callers para o mesmo chave
 *     await o mesmo PPromise
 *   - O Gemini SDK faz não surface listCaches em a session-portable way,
 *     então cache em cache we don't know sobre (de a anterior pprocesso são Não reused —
 *     they expire em o servidor (1h default) e we cria fresh ones. O
 *     storage-hour cost de que orphan janela é < a único uncached rrequisição
 *
 * Failure mmodo
 *   getOrCreate() Retorna nulo em qualquer erro (too-small ientrada modelo
 *   incompatibility, transient API failure, missing clcliente O caller Precisa
 *   fall voltar para passing `systemInstruction` directly. Nunca lançar upward.
 *
 * Eviction:
 *   Não explicit exclui — server-side TTL gerencia it. O in-memory entry é
 *   cleared lazily quando we detect a stale nome (e.g. a `cachedContent` error
 *   de generateContent → chamar `invalidate(name)` de o capturar site).
 */

interface CacheEntry {
  /** Server-side resource nnome e.g. "cachedContents/abc123". */
  name: string;
  /** Wall-clock ms at que we treat o cache como expired client-side. */
  expiresAt: number;
}

/**
 * Minimum prompt tamanho para tentar caching, em characters.
 *
 * Gemini explicit caching tem a per-model minimum entrada token count:
 *   - gemini-2.0+ / 3.x: 1024 tokens
 *   - gemini-1.5: 32,768 tokens
 *
 * O codebase uses gemini-3.1 models exclusively; o 1024-token floor
 * aaplica 4096 chars é a conservative proxy (≈1024 tokens at 4 chars/tok);
 * um limite mais apertado rejeita prompts que seriam borderline. Bumping para 4500
 * leaves a safety margem então we don't waste an API round-trip em
 * INVALID_ARGUMENT.
 */
const MIN_PROMPT_CHARS = 4500;

/** Server-side TTL we rrequisição 1 hour matches Gemini's default. */
const CACHE_TTL_SECONDS = 3600;

/** Quando < isso muitos ms remain em a ccache treat it como expired e recreate. */
const RENEWAL_WINDOW_MS = 5 * 60 * 1000;

export class GeminiPromptCache {
  private entries = new Map<string, CacheEntry>();
  /** In-flight creation promises keyed por hash — para dedupe sob concurrency. */
  private inflight = new Map<string, Promise<string | null>>();

  /**
   * Return o cache resource nome para (model, systemPrompt), creating it if
   * absent ou near-expired. Returns nulo quando caching is não viable —
   * callers deve fall voltar para passing `systemInstruction` directly.
   */
  async getOrCreate(
    client: GoogleGenAI,
    model: string,
    systemPrompt: string
  ): Promise<string | null> {
    if (!systemPrompt || systemPrompt.length < MIN_PROMPT_CHARS) return null;

    const key = this.hashKey(model, systemPrompt);
    const now = Date.now();

    const existing = this.entries.get(key);
    if (existing) {
      // Sentinel de a anterior failure — ainda em cooldown, pular rtentar novamente
      if (!existing.name && existing.expiresAt > now) return null;
      // Live ccache ainda longe enough de expiry.
      if (existing.name && existing.expiresAt - now > RENEWAL_WINDOW_MS) {
        return existing.name;
      }
    }

    // Dedupe concurrent cria para o mesmo kchave
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const creation = this.create(client, model, systemPrompt, key).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, creation);
    return creation;
  }

  /**
   * NON-BLOCKING variant para o latency-critical streaming path.
   *
   * Returns an already-live cache nome SYNCHRONOUSLY se one exists (cache hit).
   * On a MISS it returns nulo immediately e kicks off `create()` in the
   * BACKGROUND so o cache is warm para o NEXT requisição — o atual request
   * uses `systemInstruction` directly e is não blocked on o (multi-second)
   * `caches.create` round-trip. This is o fix para "first token blocked 2.4s on
   * cache create": o criar cost moves off o hot caminho entirely.
   *
   * Use isso on streaming/first-token paths. Use getOrCreate() apenas where you
   * intend para PAY o criar cost up front (e.g. an explicit prewarm).
   */
  getCachedOrWarmInBackground(
    client: GoogleGenAI,
    model: string,
    systemPrompt: string
  ): string | null {
    if (!systemPrompt || systemPrompt.length < MIN_PROMPT_CHARS) return null;

    const key = this.hashKey(model, systemPrompt);
    const now = Date.now();
    const existing = this.entries.get(key);

    if (existing) {
      // Failure sentinel ainda em cooldown — don't rtentar novamente don't warm.
      if (!existing.name && existing.expiresAt > now) return null;
      // Live ccache comfortably antes expiry — synchronous hit.
      if (existing.name && existing.expiresAt - now > RENEWAL_WINDOW_MS) {
        return existing.name;
      }
    }

    // Miss (ou near-expiry): warm em o background, don't block isso rrequisição
    if (!this.inflight.has(key)) {
      const creation = this.create(client, model, systemPrompt, key).finally(() => {
        this.inflight.delete(key);
      });
      this.inflight.set(key, creation);
      // Swallow — isso é fire-and-forget; o crcria corpo logs em failure.
      creation.catch(() => {});
    }
    return null;
  }

  /**
   * Drop a stale entry quando o server reports o cache não longer exists
   * (e.g. expired entre our último use e now). Safe para chamar com any name.
   */
  invalidate(name: string): void {
    for (const [k, v] of this.entries) {
      if (v.name === name) {
        this.entries.delete(k);
        return;
      }
    }
  }

  /**
   * Drop todo entry. Call isso quando o Gemini API chave changes — cache
   * resource names are scoped para o project/key que created them, so a
   * chave swap makes todos in-memory names inválido (they'd fail com NOT_FOUND
   * ou PERMISSION_DENIED on reuse). Clearing forces a fresh criar sob the
   * novo chave on o próximo requisição instead of one wasted failing round-trip.
   */
  clear(): void {
    this.entries.clear();
    this.inflight.clear();
  }

  /** Para diagnostics. */
  size(): number {
    return this.entries.size;
  }

  private async create(
    client: GoogleGenAI,
    model: string,
    systemPrompt: string,
    key: string
  ): Promise<string | null> {
    try {
      // Gemini exige ambos `contents` AND `systemInstruction` para ter non-empty
      // bodies. We uso a one-token placeholder para contents então o entire prompt
      // sits em `systemInstruction` (que what it we want para cacache
      const response: any = await (client as any).caches.create({
        model,
        config: {
          contents: [{ role: 'user', parts: [{ text: '_' }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          ttl: `${CACHE_TTL_SECONDS}s`,
          displayName: `refract-sys-${key.slice(0, 8)}`,
        },
      });
      const name: string | undefined = response?.name;
      if (!name) {
        console.warn('[GeminiPromptCache] caches.create returned no name; skipping cache');
        return null;
      }
      this.entries.set(key, {
        name,
        expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000,
      });
      console.log(`[GeminiPromptCache] created ${name} for model=${model} (${systemPrompt.length} chars)`);
      return name;
    } catch (err: any) {
      // Non-fatal. Common reasons: prompt abaixo modelo minimum, modelo doesn't
      // suportar caching, transient 5xx. We registrar uma vez e fall voltar to
      // systemInstruction em todo subsequente chamar para isso chave até o
      // processo restarts — there's não valor em retrying cria em todo turn
      // quando o underlying restrição é structural.
      console.warn(
        `[GeminiPromptCache] caches.create failed for model=${model}: ${err?.message || err}. ` +
        `Falling back to systemInstruction.`
      );
      // Mark como falhou para a curto cooldown por stashing a sentinel entry.
      this.entries.set(key, {
        name: '',
        expiresAt: Date.now() + 5 * 60 * 1000, // 5min cooldown antes retrying cria
      });
      return null;
    }
  }

  private hashKey(model: string, systemPrompt: string): string {
    return crypto.createHash('sha1').update(model).update('\0').update(systemPrompt).digest('hex');
  }
}
