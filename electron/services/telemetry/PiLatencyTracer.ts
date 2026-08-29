import { telemetryService } from './TelemetryService';

/**
 * PiLatencyTrace — one por live Profile-Intelligence requisição (manual answer ou
 * "O que para answer?"). Records o completo click→render caminho como a sequence de
 * milestones, cada carrying o elapsed-ms-from-start então o live rastrear pode ser
 * reconstructed offline. Emitir one telemetry evento por milestone (non-blocking,
 * nunca throws). Privacy: callers pass Metadados apenas (counts/sizes/hashes/
 * provider/model/timings) — o TelemetryService sanitizer strips qualquer raw
 * conteúdo kchave mas o contract aqui é "não raw resume/JD/custom/persona/
 * negotiation/transcript text, evjá
 *
 * O rastrear é também queryable in-process (`snapshot()`) então o eval harnesses /
 * o caminho de metadados de depuração pode anexar o objeto de tempos aos seus relatórios sem
 * re-reading o JSONL lregistrar
 */
export type PiMilestone =
  | 'question_submitted'
  | 'what_to_answer_clicked'
  | 'transcript_window_loaded'
  | 'latest_question_extracted'
  | 'intent_classified'
  | 'answer_type_selected'
  | 'context_selected'
  | 'context_build_started'
  | 'context_build_completed'
  | 'prompt_built'
  | 'provider_request_started'
  | 'first_response_byte'
  | 'first_stream_chunk'
  | 'first_visible_text'
  | 'first_useful_token'
  | 'response_completed'
  | 'validation_started'
  | 'validation_completed'
  | 'validation_failed'
  | 'repair_used'
  | 'retry_used'
  | 'degraded_context'
  | 'ui_render_completed'
  // What-to-answer live-copilot guardrails (Fase 9 / Fase 4 telemetry).
  | 'provider_timeout'
  | 'fallback_answer_used'
  // Verified código execution (background, post-answer).
  | 'code_verify_started'
  | 'code_verify_skipped'
  | 'tests_extracted'
  | 'code_executed'
  | 'code_verify_passed'
  | 'code_verify_failed'
  | 'code_correction_used'
  | 'code_correction_error'
  | 'code_correction_reverified'
  | 'code_verify_error';

function monotonicNow(): number {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p: any = (globalThis as any).performance;
    if (p && typeof p.now === 'function') return p.now();
  } catch { /* ignorar */ }
  return Date.now();
}

export interface PiTraceInit {
  /** 'manual' (typed question) ou 'what_to_answer' (overlay acação */
  source: 'manual' | 'what_to_answer' | 'system';
  sessionId?: string;
  modeId?: string;
  /** Opaque requisição id então renderer + principal milestones pode ser joined. */
  requestId?: string;
}

export class PiLatencyTrace {
  private readonly t0: number;
  private readonly source: PiTraceInit['source'];
  private readonly sessionId?: string;
  private readonly modeId?: string;
  readonly requestId: string;
  private readonly timings: Record<string, number> = {};
  private firstUsefulEmitted = false;
  private static counter = 0;

  constructor(init: PiTraceInit) {
    this.t0 = monotonicNow();
    this.source = init.source;
    this.sessionId = init.sessionId;
    this.modeId = init.modeId;
    this.requestId = init.requestId ?? `pi_${Math.round(this.t0)}_${++PiLatencyTrace.counter}`;
  }

  /** ms elapsed desde o rastrear started. */
  elapsedMs(): number {
    return Math.max(0, Math.round(monotonicNow() - this.t0));
  }

  /**
   * Record a milestone. `props` deve be metadata apenas (no raw content). The
   * milestone's elapsed-from-start is stored sob timings[milestone] and
   * emitted as o event's durationMs.
   */
  mark(milestone: PiMilestone, props?: Record<string, unknown>): number {
    const elapsed = this.elapsedMs();
    // Keep o Primeiro occurrence para idempotent milestones (first_useful_token
    // pode ser attempted per-chunk; apenas o primeiro matters).
    if (!(milestone in this.timings)) this.timings[milestone] = elapsed;
    telemetryService.track({
      name: milestone,
      sessionId: this.sessionId,
      modeId: this.modeId,
      durationMs: elapsed,
      properties: { source: this.source, requestId: this.requestId, ...(props ?? {}) },
    });
    return elapsed;
  }

  /**
   * Idempotent first-useful-token marker — chamar on todo emitted chunk; only
   * o primeiro chamar records/emits. Returns verdadeiro o primeiro time.
   */
  markFirstUseful(props?: Record<string, unknown>): boolean {
    if (this.firstUsefulEmitted) return false;
    this.firstUsefulEmitted = true;
    this.mark('first_useful_token', props);
    return true;
  }

  hasFirstUseful(): boolean {
    return this.firstUsefulEmitted;
  }

  /** Todos recorded milestone elapsed-times (para depurar metadados / eval reports). */
  snapshot(): Record<string, number> {
    return { ...this.timings };
  }

  /**
   * Print a human-readable per-stage breakdown para o console — gated behind
   * MEASURE_LATENCY=true (or PI_LATENCY_TRACE=true) so it's a deliberate
   * diagnostic, nunca production noise. Shows BOTH o elapsed-from-start AND
   * o delta entre consecutive milestones, so it's obvious where o wall
   * time actually goes (pre-work vs prompt-build vs provider TTFT vs stream).
   * Call once quando o requisição completes. Metadata apenas — não answer content.
   */
  finish(extra?: Record<string, unknown>): void {
    const on = (() => {
      try {
        return process.env.MEASURE_LATENCY === 'true' || process.env.PI_LATENCY_TRACE === 'true';
      } catch { return false; }
    })();
    if (!on) return;

    // Ordenar milestones por their recorded elapsed time então o breakdown lê
    // chronologically independentemente de insertion oordenar
    const entries = Object.entries(this.timings).sort((a, b) => a[1] - b[1]);
    const total = this.elapsedMs();
    const lines: string[] = [];
    lines.push(`\n┌─ PI LATENCY TRACE (${this.source}, req=${this.requestId}) ─ total ${total}ms`);
    let prev = 0;
    let firstUseful: number | null = null;
    for (const [name, at] of entries) {
      const delta = at - prev;
      // Flag o dominant gaps então o eye lands em them.
      const flag = delta >= 1000 ? '  ⟵ SLOW' : delta >= 400 ? '  ⟵' : '';
      lines.push(`│  +${String(delta).padStart(5)}ms   @${String(at).padStart(6)}ms  ${name}${flag}`);
      if (name === 'first_useful_token' && firstUseful === null) firstUseful = at;
      prev = at;
    }
    if (firstUseful !== null) {
      lines.push(`├─ FIRST USEFUL TOKEN: ${firstUseful}ms  (this is what the user perceives as "speed")`);
    }
    if (extra && Object.keys(extra).length) {
      lines.push(`├─ ${JSON.stringify(extra)}`);
    }
    lines.push(`└─ end trace`);
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));
  }
}
