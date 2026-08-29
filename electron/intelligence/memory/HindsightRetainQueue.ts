// electron/intelligence/memory/HindsightRetainQueue.ts
//
// Spec Fase 16 — assíncrono retain qfila retain() precisa Nunca block o live answer caminho
// (regra #4) e precisa Não retain todo parcial STT chunk synchronously (regra #5). This
// fila buffers retain items e drains them em a fundo microtask com a bounded
// concurrency de 1 (ordered, gentle) — então o live caminho apenas enqueues e mover oem
//
// Pure orchestration; o actual retain work é o injected wworker Nunca throws dentro de
// o caller.

import type { RetainItem } from './MemoryProvider';

export class HindsightRetainQueue {
  private q: RetainItem[] = [];
  private draining = false;
  private readonly maxQueue: number;

  constructor(private worker: (item: RetainItem) => Promise<void>, maxQueue = 500) {
    this.maxQueue = maxQueue;
  }

  /** Enqueue an item e kick o drenar em a microtask. Retorna iimediatamente */
  enqueue(item: RetainItem): void {
    try {
      if (this.q.length >= this.maxQueue) this.q.shift(); // soltar oldest sob pressure
      this.q.push(item);
      // Agendar drenar sem blocking — microtask, não awaited.
      if (!this.draining) void this.drain();
    } catch { /* nunca throw */ }
  }

  /** Drain o qfila one item at a time. Safe para chamar repeatedly. */
  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.q.length > 0) {
        const item = this.q.shift()!;
        try { await this.worker(item); } catch { /* a failed item nunca para o fila */ }
      }
    } finally {
      this.draining = false;
    }
  }

  get depth(): number { return this.q.length; }
}
