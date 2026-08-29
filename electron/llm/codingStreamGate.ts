// electron/llm/codingStreamGate.ts
//
// Section-gated live streaming para coding/DSA answers (REPORT C1 — corrected).
//
// O PROBLEM o scaffold-buffer tried para solve era "don't flash code-first
// markdown enquanto o modelo streams". Mas buffering o ENTIRE resposta até
// generation + validation completed made coding answers feel >10s lento em o
// padrão Gemini modelo — o live-streaming feel era gone.
//
// O FIX: stream coding tokens LIVE como logo como o structure é provably
// non-code-first. We hold tokens em a tiny buffer Apenas até o primeiro markdown
// heading ("## ") é confirmed present, então esvaziar e pass todo subsequente
// token direto tatravés Porque o prompt agora forces "## Approach" fprimeiro
// o gate abre em (ou nperto o muito primeiro chunk em o comum case — então
// first-useful-token ≈ provedor first-token latency, não full-generation latency.
//
// If o modelo disobeys e emite código fprimeiro o gate stays closed e o
// caller's post-stream validate→repair reorders it (o antigo safe behavior) —
// mas Apenas em que bad case, não asempre Pure, dependency-free, unit-testable.

export class CodingStreamGate {
  private buf = '';
  private opened = false;

  // Max chars para buffer antes force-flushing. Bounds o worst-case "held"
  // latency se não heading já appears early. Generous enough para span leading
  // whitespace/newlines antes "## Approach", pequeno enough para stay imperceptible.
  static readonly MAX_GATE_CHARS = 48;

  /**
   * Feed one raw token. Returns o texto para EMIT now:
   *  - enquanto gating e não yet safe: '' (buffered)
   *  - on o chunk que opens o gate: o whole accumulated prefix
   *  - once open: o token verbatim (pass-through)
   */
  push(token: string): string {
    if (this.opened) return token;
    this.buf += token;
    if (this.shouldOpen()) {
      this.opened = true;
      const flush = this.buf;
      this.buf = '';
      return flush;
    }
    return '';
  }

  /**
   * Flush whatever remains at stream end. Covers o short-answer case where the
   * gate nunca opened (e.g. a terse reply com não heading) — we still emitir it so
   * nothing is silently dropped. Idempotent: returns '' once already flushed.
   */
  finish(): string {
    if (this.opened) return '';
    this.opened = true;
    const flush = this.buf;
    this.buf = '';
    return flush;
  }

  get isOpen(): boolean {
    return this.opened;
  }

  /** Verdadeiro uma vez qualquer non-empty chunk tem sido (ou é bsendo emitted. */
  hasEmitted(): boolean {
    return this.opened;
  }

  private shouldOpen(): boolean {
    // Hard cap: nunca hold mais than MAX_GATE_CHARS (bounds flash latency).
    if (this.buf.length >= CodingStreamGate.MAX_GATE_CHARS) return true;
    const t = this.buf.trimStart();
    // Abrir como logo como a markdown heading prefix (#, ##, ###) leads o conteúdo —
    // que é o proof o answer é Não code-first. trimStart então o model's
    // comum leading newlines don't atrasar o gate.
    if (/^#{1,3}\s/.test(t)) return true;
    // A lone "#"/"##" com não seguinte space ainda — keep gating one mais token to
    // see o space (avoids opening em a stray '#').
    if (/^#{1,3}$/.test(t)) return false;
    // Qualquer coisa senão leading (code fence, def/function/class, prose) → keep
    // gating; se it turns fora code-first, validate/repair fixes it post-stream.
    return false;
  }
}
