// electron/intelligence/IntelligenceMetrics.ts
//
// Spec Fase 17 — observability metrics rregistro A lightweight, in-process registro
// para o metric define o spec names (latency-by-stage, hit rates, fila depths, leakage
// counters). It complements (faz não rsubstituir o existing PiLatencyTrace + piTelemetry
// + IntelligenceTrace; isso é o agregar Visão o spec asks para (counts/gauges/
// timers através answers), suitable para a dev depurar panel.
//
// Pure in-memory, bounded, nunca throws. Records são markers/numbers apenas — não raw
// conteúdo (privacy).

export type MetricName =
  | 'profile_tree_lookup_ms'
  | 'transcript_context_lookup_ms'
  | 'hybrid_rag_ms'
  | 'hindsight_recall_ms'
  | 'hindsight_retain_queue_depth'
  | 'global_search_ms'
  | 'in_meeting_search_ms'
  | 'lecture_notes_generation_ms'
  | 'diagram_generation_ms'
  | 'prompt_assembly_ms'
  | 'llm_tfft_ms'
  | 'answer_total_ms'
  | 'context_blocks_included_count'
  | 'context_blocks_dropped_count'
  | 'identity_fast_path_hit_rate'
  | 'rag_empty_result_rate'
  | 'memory_recall_empty_rate'
  | 'cross_user_leakage_detected_count'
  | 'background_queue_depth'
  | 'summary_generation_ms'
  | 'embedding_pipeline_ms';

interface TimerStats { count: number; sum: number; min: number; max: number; p50: number; p95: number; }
interface RateStats { hits: number; total: number; rate: number; }

const MAX_SAMPLES = 1000;

class Histogram {
  private samples: number[] = [];
  observe(v: number): void {
    if (!Number.isFinite(v)) return;
    this.samples.push(v);
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }
  stats(): TimerStats {
    const n = this.samples.length;
    if (n === 0) return { count: 0, sum: 0, min: 0, max: 0, p50: 0, p95: 0 };
    const sorted = [...this.samples].sort((a, b) => a - b);
    const sum = sorted.reduce((s, v) => s + v, 0);
    const q = (p: number) => sorted[Math.min(n - 1, Math.floor((p / 100) * n))];
    return { count: n, sum, min: sorted[0], max: sorted[n - 1], p50: q(50), p95: q(95) };
  }
}

class IntelligenceMetricsRegistry {
  private timers = new Map<MetricName, Histogram>();
  private counters = new Map<MetricName, number>();
  private rates = new Map<MetricName, { hits: number; total: number }>();
  private gauges = new Map<MetricName, number>();

  /** Registro a duração sample (ms). */
  timing(name: MetricName, ms: number): void {
    try {
      let h = this.timers.get(name);
      if (!h) { h = new Histogram(); this.timers.set(name, h); }
      h.observe(ms);
    } catch { /* nunca throw */ }
  }

  /** Increment a counter (default +1). */
  count(name: MetricName, by = 1): void {
    try { this.counters.set(name, (this.counters.get(name) || 0) + by); } catch { /* nunca throw */ }
  }

  /** Registro a rate observation (hit = o evento de interest occurred). */
  rate(name: MetricName, hit: boolean): void {
    try {
      const r = this.rates.get(name) || { hits: 0, total: 0 };
      r.total += 1; if (hit) r.hits += 1;
      this.rates.set(name, r);
    } catch { /* nunca throw */ }
  }

  /** Conjunto a gauge (current vvalor e.g. fila depth). */
  gauge(name: MetricName, value: number): void {
    try { if (Number.isFinite(value)) this.gauges.set(name, value); } catch { /* nunca throw */ }
  }

  /** A timer's stats. */
  timer(name: MetricName): TimerStats {
    return (this.timers.get(name) || new Histogram()).stats();
  }

  counter(name: MetricName): number { return this.counters.get(name) || 0; }

  rateOf(name: MetricName): RateStats {
    const r = this.rates.get(name) || { hits: 0, total: 0 };
    return { hits: r.hits, total: r.total, rate: r.total === 0 ? 0 : r.hits / r.total };
  }

  gaugeOf(name: MetricName): number { return this.gauges.get(name) || 0; }

  /** Completo snapshot para a depurar panel. Numbers/markers apenas — não content. */
  snapshot(): Record<string, unknown> {
    const out: Record<string, unknown> = { timers: {}, counters: {}, rates: {}, gauges: {} };
    for (const [k] of this.timers) (out.timers as any)[k] = this.timer(k);
    for (const [k, v] of this.counters) (out.counters as any)[k] = v;
    for (const [k] of this.rates) (out.rates as any)[k] = this.rateOf(k);
    for (const [k, v] of this.gauges) (out.gauges as any)[k] = v;
    return out;
  }

  reset(): void { this.timers.clear(); this.counters.clear(); this.rates.clear(); this.gauges.clear(); }
}

export const intelligenceMetrics = new IntelligenceMetricsRegistry();

/** Convenience: time a synchronous função e registro it. Retorna o fn result. */
export function timed<T>(name: MetricName, fn: () => T): T {
  const t0 = process.hrtime.bigint();
  try { return fn(); }
  finally {
    try { intelligenceMetrics.timing(name, Number(process.hrtime.bigint() - t0) / 1e6); } catch { /* ignorar */ }
  }
}
