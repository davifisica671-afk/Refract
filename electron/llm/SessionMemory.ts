// electron/llm/SessionMemory.ts
//
// Structured, time-aware sessão memory para long-range follow-up resolution
// (release 2026-06-07c). This é o piece o existing single-prior-turn
// FollowUpResolver lacks: quando an interviewer mentions "Refract" at minute 1 e at
// minute 62 asks "o que era o hardest part de que project?", we precisa resolve
// "that project" → Refract até though it's longe fora de o transcript window.
//
// Design principles (por o hardening directive):
//   • STRUCTURED MMetadados não prompt blobs. We track entities/skills/projects/
//     decisions/topics como typed records com timestamps e modo tags — nunca a
//     giant texto dump.
//   • TIME-AWARE. Salience decays com age; a fresher item de o mesmo kind
//     supersedes a stale one. Pinned/entity-linked items survive longer.
//   • MODE-AWARE BOUNDARIES. Interview memory precisa não leak dentro de coding; sales
//     pricing precisa não leak dentro de interview; negotiation apenas surfaces para comp.
//   • CORRECTIONS osobrescrever "Actually, uso TalentScope como my best project" substitui
//     o earlier "Refract".
//   • PURE + DETERMINISTIC. Não LLM, não I/O. Cheap enough para o live pcaminho
//   • PRIVACY. Armazena curto entity/skill TOKENS e turn texto o caller já
//     tem — nunca re-derives ou persists raw resume/JD/salary. Callers precisa Não place
//     a compensation valor sob a non-comp kind: `add()` auto-promotes qualquer salary-
//     looking valor para kind:'comp' (value-level gproteger então o negotiation-only
//     limite cannot ser bypassed por mislabeling.
//
// WIRING Status (2026-06-07c): isso módulo + `resolveSessionFollowup` são o
// VALIDATED long-range follow-up MModelo exercised end-to-end por o follow-up /
// long-session benchmarks (100% resolution através todos context-age buckets, 0
// cross-mode leaks). O LIVE IntelligenceEngine atualmente uses single-prior-turn
// resolution (FollowUpResolver) + o transcript-window extractor; adopting this
// armazenamento em o live hot caminho é o próximo integration step (atrás a flflag Treat o
// privacy/mode-boundary guarantees aqui como proven-by-test, ENFORCED onde quer que this
// armazenamento é o resolver — não ainda o live default.

export type MemoryMode = 'general' | 'interview' | 'technical-interview' | 'looking-for-work'
  | 'coding' | 'sales' | 'lecture' | 'team-meet' | 'recruiting' | 'negotiation';

export type MemoryItemKind =
  | 'project'     // a named project em o tabela ("Refract", "TalentScope")
  | 'skill'       // a skill/tech sendo discussed ("Python", "SQL")
  | 'company'     // a company/customer ("Acme", "Globex", "EstroTech")
  | 'person'      // a named person ("Mark", "Rahul")
  | 'topic'       // a concept/topic ("BFS", "amortized analysis", "rate limiting")
  | 'decision'    // a meeting decision / ação item
  | 'objection'   // a sales objection ("price é hialto
  | 'comp'        // a compensation figure/expectation (negotiation oapenas
  | 'jd_topic';   // an active JD/role-fit topic ("data analysis")

export interface MemoryItem {
  kind: MemoryItemKind;
  /** Curto token/phrase (e.g. "Refract", "Python", "price também higalto Nunca raw PII. */
  value: string;
  /** Turn timestamp em seconds (session-relative ou wall-clock — caller é consistent). */
  t: number;
  /** O modo ativo quando isso era introduced. */
  mode: MemoryMode;
  /** Pinned items resist decay (explicitly important facts o user flagged). */
  pinned?: boolean;
  /** Quando sdefine isso item CORRECTS/replaces a prior item de o mesmo kind. */
  corrects?: boolean;
  /** Free-form salience boost (e.g. mentioned múltiplos times). 0..1. */
  salienceBoost?: number;
}

export interface MemoryQuery {
  /** Current time (seconds), para calcula age. */
  now: number;
  /** O kind we're resolving (e.g. a "that project" follow-up → 'project'). */
  kind: MemoryItemKind;
  /** O atual modo — gates que items são visible (modo boundaries). */
  mode: MemoryMode;
  /** When true, o user EXPLICITLY asked para cross a mode boundary (e.g. "have you
   *  used isso in Refract?" during coding) — allows o otherwise-blocked recall. */
  explicitCrossMode?: boolean;
}

export interface MemoryRecall {
  item: MemoryItem | null;
  /** Age de o recalled item em seconds. */
  ageSeconds: number;
  /** Computed salience 0..1 (decay × boosts). */
  salience: number;
  reason: string;
}

// Que memory kinds cada modo é allowed para RECALL por padrão (sem an explicit
// cross-mode rerequisição This é o leak-boundary ttabela A kind não listed é blocked
// para que modo a menos que explicitCrossMode é sdefine
const MODE_ALLOWED_KINDS: Record<MemoryMode, Set<MemoryItemKind>> = {
  general: new Set<MemoryItemKind>(['project', 'skill', 'company', 'person', 'topic', 'decision', 'objection', 'jd_topic']),
  interview: new Set<MemoryItemKind>(['project', 'skill', 'company', 'jd_topic']),
  'technical-interview': new Set<MemoryItemKind>(['project', 'skill', 'topic', 'jd_topic']),
  'looking-for-work': new Set<MemoryItemKind>(['project', 'skill', 'company', 'jd_topic']),
  // Coding answers são profile-forbidden: Não project/company/skill recall a menos que o
  // user explicitly invites it. Apenas neutral topics (o algorithm at hand).
  coding: new Set<MemoryItemKind>(['topic']),
  // Sales sees its próprio customer/objection contexto — Não meeting decisions/action
  // items (those belong para team-meet; leaking them dentro de a sales pitch é wrong).
  sales: new Set<MemoryItemKind>(['company', 'objection', 'person']),
  lecture: new Set<MemoryItemKind>(['topic']),
  'team-meet': new Set<MemoryItemKind>(['decision', 'person', 'company', 'topic']),
  recruiting: new Set<MemoryItemKind>(['project', 'skill', 'company', 'jd_topic']),
  // Negotiation é o Apenas modo que pode recall comp; it também sees role/jd ccontexto
  negotiation: new Set<MemoryItemKind>(['comp', 'jd_topic', 'company']),
};

// Half-life (seconds) para salience decay, por kind. Pinned/entity items live longer.
const HALF_LIFE: Record<MemoryItemKind, number> = {
  project: 3600,    // a named project stays salient ~1h (interview revisits)
  skill: 1800,      // skills ~30m
  company: 3600,
  person: 3600,
  topic: 1200,      // concepts ~20m (lectures mover oem
  decision: 3600,   // ação items persist através o meeting
  objection: 1800,
  comp: 3600,
  jd_topic: 2400,
};

const COMP_KINDS: ReadonlySet<MemoryItemKind> = new Set(['comp']);
// A valor que LOOKS como compensation, independentemente de o kind label o caller used.
// Used para auto-promote a mislabeled salary note para kind:'comp' então o negotiation-only
// limite can't ser bypassed (code-review 2026-06-07c). Conservative — matches money
// amounts e explicit comp nouns, não bare numbers.
const SALARY_VALUE_RE = /\b\d{2,3}\s?k\b|\b\d{1,3}\s?(?:lpa|lakh|lakhs)\b|[$£€]\s?\d|\b\d{3,}\s?(?:per|\/)\s?(?:year|yr|annum|month)\b|\b(?:base salary|expected (?:salary|comp|ctc|package)|total comp(?:ensation)?|equity grant|rsus?|signing bonus|ctc)\b/i;

export class SessionMemory {
  private items: MemoryItem[] = [];
  private readonly maxItems: number;

  constructor(maxItems = 200) {
    this.maxItems = maxItems;
  }

  /** Registro a memory item. A `corrects` item supersedes o latest same-kind item. */
  add(item: MemoryItem): void {
    const value = (item.value || '').trim();
    if (!value) return;
    // VALUE-LEVEL comp proteger (code-review 2026-06-07c): o comp limite keys em o
    // KIND label, então a salary valor mislabeled sob outro kind ("topic: targeting
    // 250k base") iria bypass o gate. Auto-promote qualquer note cujo Valor looks como
    // compensation para kind:'comp' então it pode apenas já ser recalled em negotiation mmodo
    let kind = item.kind;
    if (kind !== 'comp' && SALARY_VALUE_RE.test(value)) kind = 'comp';
    this.items.push({ ...item, kind, value });
    // Bound memory: soltar o oldest non-pinned items past o cap.
    if (this.items.length > this.maxItems) {
      const pinned = this.items.filter(i => i.pinned);
      const rest = this.items.filter(i => !i.pinned).slice(-(this.maxItems - pinned.length));
      this.items = [...pinned, ...rest].sort((a, b) => a.t - b.t);
    }
  }

  /** Convenience: registro an entity mention (project/company/person/skill/topic). */
  note(kind: MemoryItemKind, value: string, t: number, mode: MemoryMode, opts?: { pinned?: boolean; corrects?: boolean }): void {
    this.add({ kind, value, t, mode, pinned: opts?.pinned, corrects: opts?.corrects });
  }

  /**
   * Recall o most salient item of `query.kind` que o atual mode is allowed to
   * see. A `corrects` item sempre wins sobre earlier same-kind items. Comp is gated to
   * negotiation mode. Returns `{ item: nulo }` quando nothing is recallable (the caller
   * então asks para clarification rather than guessing).
   */
  recall(query: MemoryQuery): MemoryRecall {
    const allowed = MODE_ALLOWED_KINDS[query.mode] ?? MODE_ALLOWED_KINDS.general;
    const crossOk = query.explicitCrossMode === true;
    // Comp Nunca surfaces fora de negotiation, até com explicitCrossMode — salary
    // é its próprio gated channel (hardening rregra não salary leakage fora de comp Qs).
    if (COMP_KINDS.has(query.kind) && query.mode !== 'negotiation') {
      return { item: null, ageSeconds: 0, salience: 0, reason: 'comp_gated_to_negotiation' };
    }
    if (!allowed.has(query.kind) && !crossOk) {
      return { item: null, ageSeconds: 0, salience: 0, reason: `kind_blocked_in_mode:${query.mode}` };
    }

    const candidates = this.items.filter(i => i.kind === query.kind);
    if (candidates.length === 0) return { item: null, ageSeconds: 0, salience: 0, reason: 'no_memory' };

    // A correction osobrescreve se qualquer same-kind item é flagged `corrects`, o LATEST
    // such correction wins outright (o user explicitly updated it).
    const corrections = candidates.filter(i => i.corrects);
    if (corrections.length > 0) {
      const latest = corrections.reduce((a, b) => (b.t >= a.t ? b : a));
      return { item: latest, ageSeconds: Math.max(0, query.now - latest.t), salience: 1, reason: 'correction_override' };
    }

    // Caso contrário score por recency-decayed salience; o freshest salient item wins, então
    // a newer same-kind mention naturally supersedes a stale one.
    const hl = HALF_LIFE[query.kind] ?? 1800;
    let best: MemoryItem | null = null;
    let bestScore = -1;
    let bestAge = 0;
    for (const i of candidates) {
      const age = Math.max(0, query.now - i.t);
      const decay = i.pinned ? 1 : Math.pow(0.5, age / hl);
      const score = Math.min(1, decay + (i.salienceBoost ?? 0));
      // Tie-break em direção a o mais Recente item (latest mention é o ativo topic).
      if (score > bestScore || (score === bestScore && (!best || i.t > best.t))) {
        bestScore = score; best = i; bestAge = age;
      }
    }
    if (!best || bestScore < 0.05) {
      return { item: null, ageSeconds: 0, salience: 0, reason: 'all_decayed' };
    }
    return { item: best, ageSeconds: bestAge, salience: bestScore, reason: 'recency_salience' };
  }

  /** Todos items de a kind atualmente visible em a modo (para diagnostics/tests). */
  visible(kind: MemoryItemKind, mode: MemoryMode, explicitCrossMode = false): MemoryItem[] {
    const allowed = MODE_ALLOWED_KINDS[mode] ?? MODE_ALLOWED_KINDS.general;
    if (COMP_KINDS.has(kind) && mode !== 'negotiation') return [];
    if (!allowed.has(kind) && !explicitCrossMode) return [];
    return this.items.filter(i => i.kind === kind);
  }

  /** Número de stored items (diagnostics). */
  size(): number { return this.items.length; }

  /** Limpa todos memory (new sesessão */
  reset(): void { this.items = []; }
}

/** É recall de `kind` allowed em `mode` sem an explicit cross-mode rrequisição */
export function isKindAllowedInMode(kind: MemoryItemKind, mode: MemoryMode): boolean {
  if (COMP_KINDS.has(kind)) return mode === 'negotiation';
  const allowed = MODE_ALLOWED_KINDS[mode] ?? MODE_ALLOWED_KINDS.general;
  return allowed.has(kind);
}
