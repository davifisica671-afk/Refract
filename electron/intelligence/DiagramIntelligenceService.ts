// electron/intelligence/DiagramIntelligenceService.ts
//
// Spec Fase 15 — Diagram Intelligence. Detects diagram-worthy lecture conteúdo and
// gera válido Mermaid specs (sequence / flowchart / stestado com a confidence
// label e an ASCII fallback. NET-NEW (não diagram generation exists em o repo).
//
// SAFETY (spec): nunca present a low-confidence invented diagram como exact. Quando o
// diagram é derived de a textual explanation (não copied de a fonte visual) it é
// labeled `ai_reconstructed`. Syntax é validated antes o spec é returned; em
// validation failure it falls voltar para ASCII. Pure, deterministic, nunca throws.
//
// This é a DETERMINISTIC generator para o common, well-structured cases (sequenced
// protocolo steps, processo flows, estado machines). It faz não hallucinate: se it can't
// confidently extrair structure, it Retorna a low-confidence/empty result em vez than
// inventing edges.

export type DiagramKind = 'sequence' | 'flowchart' | 'state' | 'none';
export type DiagramConfidenceLabel =
  | 'exact_source_diagram'
  | 'ai_reconstructed_diagram'
  | 'conceptual_diagram'
  | 'low_confidence_diagram';

export interface DiagramCandidate {
  kind: DiagramKind;
  confidence: number; // 0..1
  reason: string;
}

export interface GeneratedDiagram {
  kind: DiagramKind;
  mermaid: string;
  ascii: string;
  valid: boolean;
  confidenceLabel: DiagramConfidenceLabel;
  confidence: number;
  /** O transcript span o diagram era derived de (provenance). */
  sourceSpan: string;
  notes: string;
}

const clean = (t: string) => (t || '').replace(/\s+/g, ' ').trim();

// ── Candidate detection ──────────────────────────────────────────────────────
const SEQUENCE_CUES = /\b(sends?|replies?|responds?|requests?|returns?|acknowledg\w+|->|then the|message|SYN|ACK|handshake|client|server|protocol)\b/i;
const FLOW_CUES = /\b(step|phase|first|second|third|next|then|finally|process|pipeline|stage|followed by|leads to|->)\b/i;
const STATE_CUES = /\b(state|transition|from .* to|becomes|enters|idle|running|waiting|blocked|ready|terminated)\b/i;

export class DiagramCandidateDetector {
  detect(text: string): DiagramCandidate {
    try {
      const t = clean(text);
      if (t.length < 12) return { kind: 'none', confidence: 0, reason: 'too_short' };
      const seq = (t.match(SEQUENCE_CUES) || []).length;
      const flow = (t.match(FLOW_CUES) || []).length;
      const state = (t.match(STATE_CUES) || []).length;
      const max = Math.max(seq, flow, state);
      if (max === 0) return { kind: 'none', confidence: 0, reason: 'no_structure_cues' };
      const kind: DiagramKind = max === seq ? 'sequence' : max === state ? 'state' : 'flowchart';
      const confidence = Math.min(1, 0.4 + max * 0.15);
      return { kind, confidence, reason: `cues:${kind}=${max}` };
    } catch {
      return { kind: 'none', confidence: 0, reason: 'error' };
    }
  }
}

// ── Mermaid validation (structural, não external parser) ───────────────────────
export class DiagramValidator {
  validate(mermaid: string): { valid: boolean; reason: string } {
    try {
      const src = (mermaid || '').trim();
      if (!src) return { valid: false, reason: 'empty' };
      const header = src.split('\n')[0].trim();
      const known = /^(sequenceDiagram|flowchart (TD|LR|TB|RL)|graph (TD|LR|TB|RL)|stateDiagram(-v2)?|classDiagram|mindmap)\b/;
      if (!known.test(header)) return { valid: false, reason: 'unknown_header' };
      // Balanced brackets.
      const opens = (src.match(/[[({]/g) || []).length;
      const closes = (src.match(/[\])}]/g) || []).length;
      if (opens !== closes) return { valid: false, reason: 'unbalanced_brackets' };
      // At menos one edge/message line para graph/sequence types.
      if (/^(sequenceDiagram)/.test(header) && !/->>|-->>|->/.test(src)) return { valid: false, reason: 'no_messages' };
      if (/^(flowchart|graph)/.test(header) && !/-->|---|->/.test(src)) return { valid: false, reason: 'no_edges' };
      return { valid: true, reason: 'ok' };
    } catch {
      return { valid: false, reason: 'error' };
    }
  }
}

// ── Spec generation ───────────────────────────────────────────────────────────
export class DiagramSpecGenerator {
  // SEQUENCE: extrair "A <verb> B: mmensagem estilo steps.
  sequence(text: string): { mermaid: string; ascii: string; steps: number } {
    const t = clean(text);
    const steps: Array<{ from: string; to: string; msg: string }> = [];
    // Pattern: "<Actor> sends/replies (wcom <MSG> para <Actor>" e o canonical SYN/ACK form.
    // O inter-token gaps são bounded ({0,80}, não unbounded *?) então a longo single
    // "sentence" (não period) can't drive quadratic backtracking (security review
    // 2026-06-13). A real "A envia X para B" clause fits bem dentro de 80 chars por gap.
    const SEND_RE = /\b(client|server|sender|receiver|host|node|browser|user|[A-Z][a-z]+)\b[^.]{0,80}?\b(sends?|replies?|responds?|returns?|requests?|acknowledg\w+|with)\b[^.]{0,80}?\b([A-Z][A-Z-]{1,}|[a-z]{3,})\b[^.]{0,80}?\b(to|back to)\b\s+\b(client|server|sender|receiver|host|node|browser|user|[A-Z][a-z]+)\b/gi;
    let m: RegExpExecArray | null;
    SEND_RE.lastIndex = 0;
    while ((m = SEND_RE.exec(t)) !== null) {
      steps.push({ from: cap(m[1]), to: cap(m[5]), msg: m[3].toUpperCase().length <= 8 ? m[3].toUpperCase() : m[3] });
      if (steps.length >= 12) break;
    }
    // Canonical handshake alternativa (cliente SYN → servidor SYN-ACK → cliente ACK).
    if (steps.length === 0 && /\bSYN\b/i.test(t) && /\bACK\b/i.test(t)) {
      steps.push({ from: 'Client', to: 'Server', msg: 'SYN' });
      steps.push({ from: 'Server', to: 'Client', msg: 'SYN-ACK' });
      steps.push({ from: 'Client', to: 'Server', msg: 'ACK' });
    }
    if (steps.length === 0) return { mermaid: '', ascii: '', steps: 0 };
    const actors = [...new Set(steps.flatMap((s) => [s.from, s.to]))];
    const lines = ['sequenceDiagram'];
    for (const a of actors) lines.push(`    participant ${a}`);
    for (const s of steps) lines.push(`    ${s.from}->>${s.to}: ${s.msg}`);
    const ascii = steps.map((s) => `${s.from} --${s.msg}--> ${s.to}`).join('\n');
    return { mermaid: lines.join('\n'), ascii, steps: steps.length };
  }

  // FLOWCHART: ordered phases ("first/then/next/finally" ou "A leads para B").
  flowchart(text: string): { mermaid: string; ascii: string; steps: number } {
    const t = clean(text);
    // Divide em ordinal/sequence markers dentro de fase fragments.
    const parts = t.split(/\b(?:first|second|third|then|next|after that|finally|followed by|leads to|->)\b/i)
      .map((p) => clean(p).replace(/^[,:;-]+/, '').trim())
      .filter((p) => p.length >= 4 && p.length <= 60);
    const phases = parts.slice(0, 8);
    if (phases.length < 2) return { mermaid: '', ascii: '', steps: 0 };
    const lines = ['flowchart TD'];
    phases.forEach((p, i) => { lines.push(`    N${i}["${escapeNode(p)}"]`); });
    for (let i = 0; i < phases.length - 1; i++) lines.push(`    N${i} --> N${i + 1}`);
    const ascii = phases.map((p, i) => `${i + 1}. ${p}`).join('\n  ↓\n');
    return { mermaid: lines.join('\n'), ascii, steps: phases.length };
  }

  // SEstado "de X para Y" transitions.
  state(text: string): { mermaid: string; ascii: string; steps: number } {
    const t = clean(text);
    const transitions: Array<{ from: string; to: string }> = [];
    const RE = /\bfrom\s+([A-Za-z]{3,})\s+(?:state\s+)?to\s+([A-Za-z]{3,})\b|\b([A-Za-z]{3,})\s+(?:state\s+)?(?:transitions?|moves?|goes?|changes?)\s+to\s+([A-Za-z]{3,})\b/gi;
    let m: RegExpExecArray | null;
    while ((m = RE.exec(t)) !== null) {
      const from = cap(m[1] || m[3]); const to = cap(m[2] || m[4]);
      if (from && to) transitions.push({ from, to });
      if (transitions.length >= 12) break;
    }
    if (transitions.length === 0) return { mermaid: '', ascii: '', steps: 0 };
    const lines = ['stateDiagram-v2'];
    for (const tr of transitions) lines.push(`    ${tr.from} --> ${tr.to}`);
    const ascii = transitions.map((tr) => `[${tr.from}] --> [${tr.to}]`).join('\n');
    return { mermaid: lines.join('\n'), ascii, steps: transitions.length };
  }
}

function cap(s: string): string { const t = (s || '').trim(); return t ? t[0].toUpperCase() + t.slice(1) : t; }
function escapeNode(s: string): string { return s.replace(/"/g, "'").replace(/[[\]{}()]/g, ''); }

export interface GenerateDiagramInput {
  text: string;
  /** Verdadeiro quando derived de an actual fonte visual (screenshot) → exact. */
  fromSourceVisual?: boolean;
  title?: string;
}

/** Facade: detect → gera → valida → label. */
export class DiagramIntelligenceService {
  private readonly detector = new DiagramCandidateDetector();
  private readonly gen = new DiagramSpecGenerator();
  private readonly validator = new DiagramValidator();

  generate(input: GenerateDiagramInput): GeneratedDiagram {
    const sourceSpan = clean(input.text).slice(0, 200);
    const empty: GeneratedDiagram = {
      kind: 'none', mermaid: '', ascii: '', valid: false,
      confidenceLabel: 'low_confidence_diagram', confidence: 0, sourceSpan, notes: 'no diagram-worthy structure detected',
    };
    try {
      const candidate = this.detector.detect(input.text);
      if (candidate.kind === 'none') return empty;

      const built =
        candidate.kind === 'sequence' ? this.gen.sequence(input.text) :
        candidate.kind === 'state' ? this.gen.state(input.text) :
        this.gen.flowchart(input.text);

      if (!built.mermaid || built.steps === 0) {
        return { ...empty, kind: candidate.kind, notes: 'structure cues present but no extractable steps — not inventing edges' };
      }

      const { valid, reason } = this.validator.validate(built.mermaid);
      // SAFETY: confidence label. fromSourceVisual=exact; senão ai_reconstructed (ou
      // low-confidence quando o detector wasn't certo / poucos steps).
      let confidenceLabel: DiagramConfidenceLabel;
      if (input.fromSourceVisual) confidenceLabel = 'exact_source_diagram';
      else if (candidate.confidence >= 0.7 && built.steps >= 2) confidenceLabel = 'ai_reconstructed_diagram';
      else if (built.steps >= 2) confidenceLabel = 'conceptual_diagram';
      else confidenceLabel = 'low_confidence_diagram';

      const notes = input.fromSourceVisual
        ? 'Diagram copied/derived from a source visual.'
        : 'AI-reconstructed from the lecture explanation (not copied from a source visual).';

      return {
        kind: candidate.kind,
        mermaid: valid ? built.mermaid : '',
        ascii: built.ascii,
        valid,
        confidenceLabel,
        confidence: candidate.confidence,
        sourceSpan,
        notes: valid ? notes : `${notes} (mermaid validation failed: ${reason} — using ASCII fallback)`,
      };
    } catch {
      return empty;
    }
  }
}
