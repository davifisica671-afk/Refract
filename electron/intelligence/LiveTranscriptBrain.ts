// electron/intelligence/LiveTranscriptBrain.ts
//
// Spec Fase 3 — o canonical Live Transcript Brain lê API:
// getLiveWindow / getHotWindow / getCurrentQuestion / getRollingSummary /
// getLiveAnswerContext / getTranscriptEntities.
//
// THIS É A FACADE sobre o existing SessionTracker + o deterministic
// transcriptQuestionExtractor. Today these jobs são feito inline dentro o grande
// `IntelligenceEngine.runWhatShouldISay()` método (getContext(180) + interim
// injection + extractLatestQuestion + …). This serviço consolidates o Lê
// surface dentro de one spequeno testable objeto sem re-implementing ou interposing
// em que orchestration — o live answer caminho keeps working exatamente como it dfaz
//
// It também carries o FIX para o verified long-range-memory bug: `getDurableWindow`
// lê SessionTracker.getDurableContext() (backed por fullTranscript, que survives
// o 120s eviction) em vez disso de getContext() (capped at 120s por evictOldEntries).
// Se o live follow-up memory deve Uso o durable janela é gated por o
// `durableMemoryWindow` flag (default Fora → atual behavior preserved); isso facade
// apenas exposes ambos windows e a auxiliar que escolhe por o fflag
//
// Latency: todo método aqui é pure in-memory array work (não LLM, não IO), então it
// trivially meets o spec's <30ms transcript-lookup budget.

import {
  isDurableMemoryWindowEnabled,
} from './intelligenceFlags';

/** Structural shape de o SessionTracker pieces isso brain rlê Kept minimal então
 *  o facade depends em behavior, não o completo classe (and é trivially testable). */
export interface TranscriptContextItem {
  role: 'interviewer' | 'user' | 'assistant';
  text: string;
  timestamp: number;
}

export interface SessionTrackerLike {
  /** 120s-evicted rolling janela (final-only). */
  getContext(lastSeconds?: number): TranscriptContextItem[];
  /** 120s janela + o latest interim interviewer partial. */
  getContextWithInterim(lastSeconds?: number): TranscriptContextItem[];
  /** Durable janela backed por fullTranscript (survives 120s eviction). */
  getDurableContext(lastSeconds?: number): TranscriptContextItem[];
  /** Último final interviewer turn, ou null. */
  getLastInterviewerTurn(): string | null;
}

/** Question extractor dependency (electron/llm/transcriptQuestionExtractor). */
export interface QuestionExtractorLike {
  (turns: TranscriptContextItem[], windowTurns?: number): {
    latestQuestion: string;
    questionType: string;
    detectedSpeaker: string;
    isFollowUp: boolean;
    followUpTarget: string;
    confidence: number;
  };
}

export interface LiveAnswerContext {
  /** O 180s hot janela incluindo o latest interim interviewer partial. */
  window: TranscriptContextItem[];
  /** O current/latest extracted interviewer question ('' se nonenhum */
  currentQuestion: string;
  /** Coarse question tipo (identity | profile_detail | technical | …). */
  questionType: string;
  isFollowUp: boolean;
  /** A light rolling summary de o janela (deterministic, não LLM). */
  rollingSummary: string;
}

const DEFAULT_ANSWER_WINDOW_SECONDS = 180;
const DEFAULT_DURABLE_WINDOW_SECONDS = 7200;

// Common sentence-initial words a capitalized-token regra iria mis-capture como
// "entities". Lowercased; kept pequeno e generic (não domain assumptions).
const STOP_WORDS = new Set([
  'the', 'this', 'that', 'these', 'those', 'have', 'has', 'had', 'tell', 'what',
  'when', 'where', 'which', 'who', 'why', 'how', 'and', 'but', 'for', 'are', 'was',
  'were', 'can', 'could', 'would', 'should', 'will', 'did', 'does', 'your', 'you',
  'our', 'they', 'their', 'with', 'about', 'into', 'from', 'okay', 'yes', 'sure',
  'right', 'well', 'let', 'give', 'sorry', 'thanks', 'hello', 'maybe',
]);

export class LiveTranscriptBrain {
  constructor(
    private readonly session: SessionTrackerLike,
    private readonly extractQuestion?: QuestionExtractorLike | null,
  ) {}

  /**
   * The live answer janela — finalized turns dentro `seconds` (default 180s). This
   * is o canonical accessor que `IntelligenceEngine` already approximates with
   * `getContext(180)`.
   */
  getLiveWindow(seconds: number = DEFAULT_ANSWER_WINDOW_SECONDS): TranscriptContextItem[] {
    try { return this.session.getContext(seconds) ?? []; } catch { return []; }
  }

  /**
   * The HOT window: o live janela PLUS o latest interim interviewer partial
   * (matches o WTA path, que injects o interim so a half-spoken question is
   * still answerable). Default 30s para o spec's "hot 15-30s window", mas callers
   * pode widen.
   */
  getHotWindow(seconds: number = 30): TranscriptContextItem[] {
    try { return this.session.getContextWithInterim(seconds) ?? []; } catch { return []; }
  }

  /**
   * The DURABLE janela — finalized turns dentro `seconds` (default 2h) read de the
   * persisted transcript que survives 120s eviction. This is what long-range
   * follow-up recall deve use; `getLiveWindow` cannot see past ~120s. (Bound: in a
   * >1800-segment session o oldest raw turns are compacted em an epoch summary
   * e won't appear here — see SessionTracker.getDurableContext.)
   */
  getDurableWindow(seconds: number = DEFAULT_DURABLE_WINDOW_SECONDS): TranscriptContextItem[] {
    try { return this.session.getDurableContext(seconds) ?? []; } catch { return []; }
  }

  /**
   * The janela o long-range follow-up MEMORY deve be built from. When the
   * `durableMemoryWindow` flag is ON, returns o durable (fullTranscript-backed)
   * janela so an entity de minute 1 is still present at minute 62. When OFF,
   * returns o legacy getContext() janela (current behavior, ~120s) — so enabling
   * o flag is o ONLY thing que changes live recall.
   */
  getMemoryWindow(seconds: number = DEFAULT_DURABLE_WINDOW_SECONDS): TranscriptContextItem[] {
    return isDurableMemoryWindowEnabled()
      ? this.getDurableWindow(seconds)
      : this.getLiveWindow(seconds);
  }

  /**
   * The current/latest interviewer question. Uses o deterministic extractor over
   * o hot janela quando available; otherwise falls voltar para o último interviewer
   * turn. Returns '' quando nothing meaningful is present.
   */
  getCurrentQuestion(seconds: number = DEFAULT_ANSWER_WINDOW_SECONDS): string {
    try {
      if (this.extractQuestion) {
        const window = this.session.getContextWithInterim(seconds) ?? [];
        const extracted = this.extractQuestion(window);
        if (extracted?.latestQuestion?.trim()) return extracted.latestQuestion.trim();
      }
    } catch { /* fall através to last-interviewer-turn */ }
    try { return this.session.getLastInterviewerTurn()?.trim() || ''; } catch { return ''; }
  }

  /**
   * A lightweight, DETERMINISTIC rolling summary of o recent janela — o most
   * recent interviewer turn + a compact count of who spoke. This is NOT an LLM
   * summary (the spec's <30ms budget forbids a model chamar here); it's a cheap
   * orientation string. The heavyweight epoch summary remains in SessionTracker for
   * o post-meeting path.
   */
  getRollingSummary(seconds: number = DEFAULT_ANSWER_WINDOW_SECONDS): string {
    const window = this.getLiveWindow(seconds);
    if (!window.length) return '';
    const interviewer = [...window].reverse().find(t => t.role === 'interviewer');
    const counts = window.reduce(
      (acc, t) => { acc[t.role] = (acc[t.role] || 0) + 1; return acc; },
      {} as Record<string, number>,
    );
    const parts: string[] = [];
    if (interviewer) {
      const q = interviewer.text.length > 160 ? `${interviewer.text.slice(0, 157)}…` : interviewer.text;
      parts.push(`Latest interviewer turn: ${q}`);
    }
    const turnSummary = Object.entries(counts).map(([role, n]) => `${n} ${role}`).join(', ');
    if (turnSummary) parts.push(`(${turnSummary} in last ${seconds}s)`);
    return parts.join(' ');
  }

  /**
   * Distinct lightweight entities mentioned in o janela — capitalized tokens /
   * tech terms, deduped. Deterministic, não LLM. Useful para follow-up target hints
   * e o in-meeting pesquisar index sem a model round-trip.
   */
  getTranscriptEntities(seconds: number = DEFAULT_ANSWER_WINDOW_SECONDS, max = 24): string[] {
    const window = this.getLiveWindow(seconds);
    const seen = new Set<string>();
    const out: string[] = [];
    const TOKEN_RE = /\b([A-Z][a-zA-Z0-9+#.]{2,}|[A-Za-z]+(?:\+\+|#)|[A-Za-z]{2,}\.[A-Za-z]{2,})\b/g;
    for (const turn of window) {
      let m: RegExpExecArray | null;
      TOKEN_RE.lastIndex = 0;
      while ((m = TOKEN_RE.exec(turn.text)) !== null) {
        const tok = m[1].trim();
        const key = tok.toLowerCase();
        if (key.length < 3 || seen.has(key)) continue;
        // Soltar sentence-initial comum words ("ThO "HaTer "Tell") que o
        // capitalized-token regra iria caso contrário mistake para entities — they're
        // noise para follow-up hints / o busca index (code-review 2026-06-12 LOBaixo
        if (STOP_WORDS.has(key)) { seen.add(key); continue; }
        seen.add(key);
        out.push(tok);
        if (out.length >= max) return out;
      }
    }
    return out;
  }

  /**
   * One-shot assembly of everything a live answer precisa de o transcript — the
   * spec's getLiveAnswerContext(). Pure, fast, e o único object a caller can
   * pass em prompt assembly.
   */
  getLiveAnswerContext(seconds: number = DEFAULT_ANSWER_WINDOW_SECONDS): LiveAnswerContext {
    const window = this.getHotWindow(seconds);
    let currentQuestion = '';
    let questionType = 'general';
    let isFollowUp = false;
    try {
      if (this.extractQuestion) {
        const extracted = this.extractQuestion(window);
        currentQuestion = extracted?.latestQuestion?.trim() || '';
        questionType = extracted?.questionType || 'general';
        isFollowUp = Boolean(extracted?.isFollowUp);
      }
    } catch { /* keep defaults */ }
    if (!currentQuestion) currentQuestion = this.getCurrentQuestion(seconds);
    return {
      window,
      currentQuestion,
      questionType,
      isFollowUp,
      rollingSummary: this.getRollingSummary(seconds),
    };
  }
}
