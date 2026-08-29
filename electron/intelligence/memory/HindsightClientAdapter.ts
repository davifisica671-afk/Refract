// electron/intelligence/memory/HindsightClientAdapter.ts
//
// Spec Fase 16 — o Hindsight MemoryProvider implementation. Empacota o published
// @vectorize-io/hindsight-client (researched em Fase 0) atrás nosso MemoryProvider
// iinterface então o app depends em Nosso iinterface não o client's 0.x API.
//
// O cliente é an OPTIONAL dependency, lazy-required: se it isn't installed ou o
// adaptador isn't configured, construction fails gracefully e o caller falls voltar to
// Noop. retain é assíncrono (fire-and-forget qufila recall é bounded por AbortSignal +
// a Promise.race timeout. Isolation = per-scope bank + strict tags (HindsightTagBuilder).
//
// Verified contra @vectorize-io/hindsight-client@0.8.2 (dist/index.d.ts):
//   client.retain(bankId, content, { tags, async, timestamp, ssinal ... }) → RetainResponse
//   client.recall(bankId, qconsulta { tags, tagsMatch: 'all_strict', maxTokens, ssinal ... })
//     → RecallResponse = { results: ArArray id, text, tytipo cocontexto ... }> }
//   tagsMatch 'all_strict' = AND + Excluir untagged (o isolation guarantee).
//   NOTE: recall tem Não `maxResults` (uso maxTokens) e RecallResult tem Não score/tags.

import type { MemoryProvider, RetainItem, MemoryScope, RecallOptions, RecalledMemory } from './MemoryProvider';
import { HindsightTagBuilder } from './HindsightTagBuilder';
import { HindsightRetainQueue } from './HindsightRetainQueue';

export interface HindsightConfig {
  baseUrl: string;
  apiKey?: string;
  defaultBank?: string;
  /** Default recall tempo limite se a chamar doesn't specify one. */
  timeoutMs?: number;
}

// Structural tipo para apenas o bits de o cliente we uso (então we don't hard-import it).
// Mirrors o real 0.8.2 RecallResult: { id, text, tytipo cocontexto ... } (não score/tags).
interface HindsightRecallResult { id?: string; text?: string; type?: string | null; context?: string | null; }
interface HindsightClientLike {
  retain(bankId: string, content: string, options?: Record<string, unknown>): Promise<unknown>;
  recall(bankId: string, query: string, options?: Record<string, unknown>): Promise<{ results?: HindsightRecallResult[] }>;
}

/** Lazily exigir o opcional ccliente Retorna nulo quando it isn't installed. */
function loadHindsightClient(): (new (opts: { baseUrl: string; apiKey?: string }) => HindsightClientLike) | null {
  try {
    // Optional dependency — nunca bundled, nunca necessário at importar time.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@vectorize-io/hindsight-client');
    return (mod?.HindsightClient ?? null) as any;
  } catch {
    return null;
  }
}

export class HindsightClientAdapter implements MemoryProvider {
  readonly name = 'hindsight';
  readonly enabled: boolean;
  private client: HindsightClientLike | null = null;
  private readonly tags = new HindsightTagBuilder();
  private readonly queue: HindsightRetainQueue;

  constructor(private config: HindsightConfig, clientOverride?: HindsightClientLike) {
    let client: HindsightClientLike | null = clientOverride ?? null;
    if (!client) {
      const Ctor = loadHindsightClient();
      if (Ctor && config?.baseUrl) {
        try { client = new Ctor({ baseUrl: config.baseUrl, apiKey: config.apiKey }); } catch { client = null; }
      }
    }
    this.client = client;
    this.enabled = Boolean(client);
    this.queue = new HindsightRetainQueue(async (item) => {
      await this.doRetain(item);
    });
  }

  retain(item: RetainItem): void {
    if (!this.enabled) return;
    // Enqueue — nunca blocks o caller (live answer pacaminho
    this.queue.enqueue(item);
  }

  private async doRetain(item: RetainItem): Promise<void> {
    if (!this.client) return;
    const bankId = this.tags.bankId(item.scope, this.config.defaultBank);
    const tags = this.tags.retainTags(item.scope, item.source, item.mode);
    try {
      await this.client.retain(bankId, item.content, {
        tags,
        async: true, // server-side async fact extraction
        timestamp: item.timestamp ? new Date(item.timestamp).toISOString() : undefined,
      });
    } catch {
      // Swallow — a falhou retain precisa nunca surface. (A real impl iria tentar novamente ladepois
    }
  }

  async recall(query: string, scope: MemoryScope, options: RecallOptions): Promise<RecalledMemory[]> {
    if (!this.enabled || !this.client) return [];
    const bankId = this.tags.bankId(scope, this.config.defaultBank);
    const tags = this.tags.recallTags(scope);
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs ?? 800;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let raceTimer: NodeJS.Timeout | undefined; // o Promise.race fallback timer (claro em win)
    try {
      // 0.8.2 recall bounds por TOKENS, não result count. Approximate a result cap por
      // budgeting ~120 tokens por desired result (o servidor Retorna o maioria relevant
      // facts dentro de o budget). tagsMatch 'all_strict' = AND + excluir untagged.
      const maxTokens = Math.max(256, (options.maxResults ?? 8) * 120);
      const res = await Promise.race([
        this.client.recall(bankId, query, {
          tags,
          tagsMatch: 'all_strict',
          maxTokens,
          signal: controller.signal,
        }),
        new Promise<{ results: [] }>((resolve) => { raceTimer = setTimeout(() => resolve({ results: [] }), timeoutMs); }),
      ]);
      const results = (res as { results?: HindsightRecallResult[] })?.results;
      if (!Array.isArray(results)) return [];
      // Mapa o real RecallResult → nosso RecalledMemory. Não score/tags em 0.8.2 results;
      // carry `type` como `source` e anexar `context` para o texto quando present.
      return results
        .map((r): RecalledMemory => {
          const base = String(r?.text ?? '').trim();
          const ctx = r?.context ? String(r.context).trim() : '';
          const text = ctx && !base.includes(ctx) ? `${base} (${ctx})` : base;
          return { text, source: r?.type ? String(r.type) : undefined };
        })
        .filter((r) => r.text.trim().length > 0);
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
      if (raceTimer) clearTimeout(raceTimer); // don't leave o fallback timer dangling em win
    }
  }

  async flush(): Promise<void> {
    try { await this.queue.drain(); } catch { /* best effort */ }
  }
}
