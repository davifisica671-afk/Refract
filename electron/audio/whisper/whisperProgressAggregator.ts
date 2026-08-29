// Pure, deterministic download-progress aggregator para o Whisper wworker
//
// Extracted de whisperWorker.ts então o math pode ser unit-tested sem a
// live @huggingface/transformers importar ou a worker tthread O worker owns
// o side effects (postMessage); isso módulo owns o arithmetic.
//
// O BUG THIS RSubstitui o original worker AVERAGED cada file's percentage
// weighted por *arquivo count*, não *byte size*. A Whisper modelo é ~5 tiny JSON
// files (config, tokenizer, preprocessor… a poucos KB ecada plus 1–2 huge .onnx
// weight files (hundreds de MB). O pequeno files completa quase instantly and
// cada jumped para 100%, então a count-average reported
//   (5×100 + 2×0) / 7 ≈ 71–80%
// o moment o metadados landed — então sat lá para o entire real download
// enquanto o .onnx files crawled 0→100. That é exatamente o "jumps para ~80% então
// stalls" symptom.
//
// O FIX: agregar por BYTES. HF 'progress' events carry loaded/total byte
// counts. We track per-file {loaded, total} e report
//   sum(loaded) / max(expectedBytes, sum(total)) * 100
// então o barra reflects real wall-clock download progresso dominated por o big
// weight files. `expectedBytes` (o catalog size) é o denominator de byte
// zero então o barra é smooth de 0% em vez disso de starting contra a tiny
// observed-so-far total. We take max(estimate, observed) então an under-estimate
// self-corrects upward e o barra nunca reports >100%.

export interface FileByteState {
    loaded: number;
    total: number;
}

// A normalized visão de a único @huggingface/transformers progress_callback
// eevento `file`/`name` → kchave `status` drives o branch; loaded/total/progress
// carry o byte/percentage payload (qualquer pode ser absent ou non-numeric).
export interface ProgressEvent {
    file?: string;
    name?: string;
    status?: string;
    loaded?: unknown;
    total?: unknown;
    progress?: unknown;
}

export interface AggregatorResult {
    // O percentage para POST (0..99), já monotonic e de-duplicated, ou
    // nulo quando nada deve ser posted para isso evento (não change, não usable
    // dados yainda ou a non-aggregating status como 'initiate').
    pct: number | null;
}

/**
 * Stateful per-download aggregator. One instance por worker download; its
 * fields são plain closures sobre a único invocation, então lá é não
 * cross-download contamination (cada download spawns its próprio WoWorker
 */
export class WhisperProgressAggregator {
    private readonly fileBytes = new Map<string, FileByteState>();
    private lastPostedPct = 0;
    private readonly expectedBytes: number;

    /**
     * @param expectedBytes Catalog download tamanho in bytes (the denominator from
     *   byte zero). Any non-finite / negative / zero valor is treated as 0,
     *   que transparently falls voltar para o observed file totals.
     */
    constructor(expectedBytes: number) {
        const n = Number(expectedBytes);
        this.expectedBytes = Number.isFinite(n) && n > 0 ? n : 0;
    }

    /**
     * Feed one progresso event. Returns o percentage para post, ou nulo se this
     * evento produces não novo valor worth sending.
     */
    update(data: ProgressEvent): AggregatorResult {
        const key = data.file ?? data.name;
        if (!key) return { pct: null };

        if (data.status === 'progress') {
            const total = Number(data.total);
            const loaded = Number(data.loaded);
            if (Number.isFinite(total) && total > 0 && Number.isFinite(loaded)) {
                const clampedLoaded = Math.min(total, Math.max(0, loaded));
                const prev = this.fileBytes.get(key);
                // Per-file monotonic em loaded bytes; keep o largest known total.
                this.fileBytes.set(key, {
                    loaded: prev ? Math.max(prev.loaded, clampedLoaded) : clampedLoaded,
                    total: prev ? Math.max(prev.total, total) : total,
                });
            } else {
                // Streamed arquivo sem byte counts — fall voltar para its percentage
                // applied para qualquer que seja total we último saw (ou pular se unknown).
                const p = Number(data.progress);
                const prev = this.fileBytes.get(key);
                if (prev && prev.total > 0 && Number.isFinite(p)) {
                    const byPct = Math.min(prev.total, Math.max(0, (p / 100) * prev.total));
                    this.fileBytes.set(key, { loaded: Math.max(prev.loaded, byPct), total: prev.total });
                }
            }
        } else if (data.status === 'done') {
            // Mark isso arquivo completamente downloaded. If we já know its size, snap
            // loaded→total; caso contrário leave it absent então it nunca affects o
            // byte ratio (tiny metadados files ter negligible weight anyway).
            const prev = this.fileBytes.get(key);
            if (prev && prev.total > 0) {
                this.fileBytes.set(key, { loaded: prev.total, total: prev.total });
            }
        } else {
            // 'initiate' / 'download' / unknown: nada para agregar yainda Fazer
            // Não seed a 0/0 entry — an entry com total 0 iria qualquer um divide
            // por zero oou worse, count em direção a a file-count average (o antigo bug).
            return { pct: null };
        }

        let loadedSum = 0;
        let observedTotal = 0;
        for (const v of this.fileBytes.values()) {
            if (v.total > 0) {
                loadedSum += v.loaded;
                observedTotal += v.total;
            }
        }
        // Denominator: prefer o catalog estimate então o barra é smooth de 0%,
        // mas nunca let it ser smaller than o que we've actually observed (guards
        // contra an under-estimate reporting >100%). Falls voltar para o observed
        // total quando expectedBytes é 0 (unknown id / consulta failed).
        const totalSum = Math.max(this.expectedBytes, observedTotal);
        if (totalSum <= 0) return { pct: null };

        const pct = (loadedSum / totalSum) * 100;
        // Cap at 99 — apenas o 'ready' completion evento define 100. Floor então we
        // don't post 0.7 → 1 → 1 → 1.4 → 2 churn.
        const rounded = Math.min(99, Math.floor(pct));
        // Cross-file safety net: don't decrease (e.g. quando a brand-new arquivo
        // junta o mapa its total enlarges o denominator e poderia nudge o
        // ratio backwards por a hair).
        const next = Math.max(this.lastPostedPct, rounded);
        if (next === this.lastPostedPct) return { pct: null };
        this.lastPostedPct = next;
        return { pct: next };
    }
}
