/**
 * answerPolish — Polimento final de resposta + Guarda de Diversidade
 *
 * Dois problemas de produto reais em sessões:
 *   1. MARCADORES DE BULLET VAZIOS — modelos emitem linhas "* " sem conteúdo;
 *      o caminho de streaming não tem pós-processamento markdown, então linhas
 *      solitárias "*" chegam à UI. cleanAnswerArtifacts() executa no limite da
 *      resposta final (regex apenas) e nunca toca blocos de código.
 *   2. RESPOSTAS REPETIDAS — em sessões com ~200 perguntas, o mesmo intro/scaffold/
 *      primeira frase reaparece em perguntas não relacionadas. AnswerDiversityGuard
 *      mantém as últimas N impressões digitais de resposta por sessão e classifica
 *      uma nova resposta como repetida (mesma primeira frase, mesmos rótulos de
 *      template visíveis, sobreposição de tokens quase-duplicada).
 *
 * Lógica pura, sem I/O, sem LLM — chamadores realizam qualquer regeração.
 */

// ── Limpeza de artefatos ─────────────────────────────────────────────────────

const CODE_FENCE_RE = /```[\s\S]*?```/g;

/**
 * Remove artefatos de renderização da resposta final:
 *  - linhas que são apenas marcador de bullet ("*", "* ", "-", "•", "+")
 *  - linhas em branco duplicadas deixadas por bullets removidos
 *  - bullet órfão no final ("...text *")
 * Blocos de código são preservados byte-a-byte.
 */
export function cleanAnswerArtifacts(text: string): string {
  if (!text) return text;
  const fences: string[] = [];
  let out = text.replace(CODE_FENCE_RE, (m) => {
    fences.push(m);
    return `FENCE${fences.length - 1}`;
  });

  // Empty bullet lines (apenas a marker, optionally repeated: "* *", "- -").
  out = out.replace(/^[ \t]*(?:[-*•+][ \t]*)+$/gm, '');
  // A bullet marker dangling at o termina de o whole answer.
  out = out.replace(/(?:\s)[-*•+][ \t]*$/g, '');
  // Bullet lines cujo conteúdo é apenas punctuation ("* .", "- :").
  out = out.replace(/^[ \t]*[-*•+][ \t]+[.,:;]*[ \t]*$/gm, '');
  // Colapsar o blank-line executa o removals leave batrás
  out = out.replace(/\n{3,}/g, '\n\n');

  fences.forEach((f, i) => { out = out.replace(`FENCE${i}`, f); });
  return out.trim();
}

// ── Guarda de diversidade ──────────────────────────────────────────────────────

/** Rótulos de scaffold visíveis que usuários relataram como robóticos. Usados para
 *  DETECTAR reuso de template E para remover rótulos na compressão speakable. */
export const SCAFFOLD_LABEL_RE = /^[ \t]*(?:\*\*)?(The Honest Gap|Why It'?s Manageable|How I'?d Close It|Speakable Final Answer|Short Fit Summary|Matching Experience|Matching Skills\/Projects|Why This Role|Direct Answer|Strong Example(?:\s*\/\s*STAR)?|Why It Matters For This Role|Short Closing Line|Best \/ Relevant Project|What I Built|Tech Stack|My Role|Impact \/ Why It Matters|Polite Opening|Flexible Range \/ Expectation|Justification)(?:\*\*)?\s*:/gim;

const WORD_RE = /[a-z0-9']+/g;

const firstSentence = (text: string): string => {
  const t = text.trim().replace(CODE_FENCE_RE, '');
  const m = t.match(/^[^.!?\n]{8,200}[.!?]/);
  return (m ? m[0] : t.slice(0, 120)).toLowerCase().replace(/\s+/g, ' ').trim();
};

const tokenSet = (text: string): Set<string> => {
  const set = new Set<string>();
  const lower = text.toLowerCase().replace(CODE_FENCE_RE, '');
  for (const m of lower.match(WORD_RE) || []) if (m.length > 2) set.add(m);
  return set;
};

const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
};

// ── Auxiliares de repetição forte (sprint qualidade-resposta-falada, 2026-06-15) ──

/** O normalized primeiro 8 spoken words (fence-stripped) — o "opening window". Eight
 *  words é o stem two answers share quando they "inicia o mesmo way" até se word 9+
 *  diverges ("I think o útil part de my fundo é …"). */
const OPENING_WINDOW_WORDS = 8;
const openingWindow = (text: string): string => {
  const t = text.replace(CODE_FENCE_RE, ' ').toLowerCase();
  const words = (t.match(/[a-z0-9']+/g) || []).slice(0, OPENING_WINDOW_WORDS);
  return words.join(' ');
};

/** Um esqueleto de frase grosseiro: por frase (primeira palavra + categoria de tamanho),
 *  unido. Duas respostas com o mesmo esqueleto abrem da mesma forma e têm os mesmos
 *  comprimentos — a forma engavetada mesmo quando os substantivos diferem. */
const sentenceSkeleton = (text: string): string => {
  const t = text.replace(CODE_FENCE_RE, ' ').trim();
  const sentences = t.split(/[.!?]+\s+/).filter((s) => s.trim().length > 0).slice(0, 6);
  return sentences
    .map((s) => {
      const words = s.toLowerCase().match(/[a-z0-9']+/g) || [];
      const first = words[0] || '';
      const bucket = words.length <= 6 ? 's' : words.length <= 14 ? 'm' : 'l';
      return `${first}:${bucket}`;
    })
    .join('|');
};

/** Impressão digital do cluster de frases corporativas (reutiliza a lista de preenchimentos proibidos do humanizador) */
const CORPORATE_CLUSTER_RE: ReadonlyArray<RegExp> = [
  /\bunique blend\b/i, /\btechnical rigor\b/i, /\bdata[- ]driven\b/i, /\bactionable insights?\b/i,
  /\bbusiness objectives\b/i, /\bproven track record\b/i, /\bmove the needle\b/i, /\bbridge the gap\b/i,
  /\bhigh[- ]impact\b/i, /\brobust and scalable\b/i, /\bstrategic mindset\b/i, /\bbest[- ]in[- ]class\b/i,
  /\bhigh[- ]performance\b/i, /\bseamless\b/i, /\bdeep expertise\b/i, /\bresults[- ]oriented\b/i,
];
const corporateCluster = (text: string): string => {
  const hits: string[] = [];
  for (const re of CORPORATE_CLUSTER_RE) { const m = text.match(re); if (m) hits.push(m[0].toLowerCase()); }
  return hits.sort().join('|');
};

/** Quais projetos conhecidos esta resposta utiliza (primeira menção vence). Correspondência
 *  de palavra inteira case-insensitive. Usado para detectar "mesmo projeto reusado quando
 *  outro estava disponível". */
const projectMentionedIn = (text: string, projects?: string[]): string | undefined => {
  if (!projects || projects.length === 0) return undefined;
  const lower = text.toLowerCase();
  for (const p of projects) {
    const name = (p || '').trim();
    if (name.length < 2) continue;
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(lower)) return name.toLowerCase();
  }
  return undefined;
};

export interface AnswerFingerprint {
  firstSentence: string;
  tokens: Set<string>;
  scaffoldLabels: string;     // sorted labels joined — template signature
  answerType: string;
  question: string;
  // Stronger-repetition signals (2026-06-15):
  opening: string;            // primeiro 8-12 spoken words
  skeleton: string;           // sentence skeleton (primeiro word + length bucket por sentence)
  corporate: string;          // sorted corporate-phrase cluster
  project?: string;           // dominant grounded project leaned em (quando projects supplied)
}

export type RepetitionReason =
  | 'same_first_sentence'
  | 'same_scaffold'
  | 'near_duplicate'
  | 'same_opening_window'
  | 'same_skeleton'
  | 'same_corporate_cluster'
  | 'same_project_reused';

export interface RepetitionVerdict {
  repeated: boolean;
  reason?: RepetitionReason;
  /** Similaridade Jaccard para a resposta anterior mais próxima (apenas para depuração) */
  similarity: number;
  /** Quando reason==='same_project_reused', um projeto fundamentado não utilizado para preferir em vez disso */
  suggestedProject?: string;
}

export interface DiversityCheckOpts {
  /** Grounded project names disponível isso sessão (para same_project_reused detection). */
  availableProjects?: string[];
}

const fingerprint = (answer: string, answerType: string, question: string, projects?: string[]): AnswerFingerprint => {
  SCAFFOLD_LABEL_RE.lastIndex = 0;
  const labels = [...answer.matchAll(SCAFFOLD_LABEL_RE)].map(m => m[1].toLowerCase()).sort().join('|');
  return {
    firstSentence: firstSentence(answer),
    tokens: tokenSet(answer),
    scaffoldLabels: labels,
    answerType,
    question: question.toLowerCase().trim(),
    opening: openingWindow(answer),
    skeleton: sentenceSkeleton(answer),
    corporate: corporateCluster(answer),
    project: projectMentionedIn(answer, projects),
  };
};

/** Respostas estruturadas/com código nunca são verificadas de repetição (sua forma é
 *  intencional). Espelha a guarda de fence usada em outros lugares. */
const CODE_OR_STRUCTURED_TYPES = new Set([
  'coding_question_answer', 'dsa_question_answer', 'system_design_answer',
  'debugging_question_answer', 'lecture_answer',
]);
const isStructuredOrCode = (answer: string, answerType: string): boolean => {
  if (CODE_OR_STRUCTURED_TYPES.has(answerType)) return true;
  CODE_FENCE_RE.lastIndex = 0;
  return CODE_FENCE_RE.test(answer);
};

/**
 * São duas perguntas a MESMA PERGUNTA formulada de forma diferente? ("quais são suas
 * principais skills?" / "quais são suas skills técnicas?") Uma resposta factual
 * legitamente se repete para perguntas sinônimas — apenas sinalizar reuso para
 * perguntas genuinamente DIFERENTES. Token-Jaccard sobre palavras de conteúdo, ≥0.6 = mesma pergunta.
 */
export const isSameAsk = (a: string, b: string): boolean => {
  if (a === b) return true;
  const ta = tokenSet(a); const tb = tokenSet(b);
  return jaccard(ta, tb) >= 0.6;
};

/** Limiar de quase-duplicata — duas respostas para perguntas DIFERENTES compartilhando >72%
 *  de suas palavras de conteúdo são lidas como a mesma resposta engavetada. */
const NEAR_DUP_JACCARD = 0.72;

/** Quantas respostas recentes as verificações OPENING / SKELETON / CORPORATE / PROJECT
 *  comparam contra (o sprint pede "últimas 3 respostas faladas"). Quase-duplicata mantém
 *  a janela completa pois se beneficia de mais histórico. */
const RECENT_WINDOW = 3;

export class AnswerDiversityGuard {
  private history: AnswerFingerprint[] = [];
  constructor(private maxItems = 20) {}

  /**
   * Classify a candidate answer contra session history. Does NOT record.
   * `opts.availableProjects` enables o "same project reused quando outro was available"
   * check. Structured/code answers short-circuit para not-repeated (their shape is intentional).
   */
  check(answer: string, answerType: string, question: string, opts?: DiversityCheckOpts): RepetitionVerdict {
    if (isStructuredOrCode(answer, answerType)) return { repeated: false, similarity: 0 };

    const fp = fingerprint(answer, answerType, question, opts?.availableProjects);
    const recent = this.history.slice(-RECENT_WINDOW);
    let maxSim = 0;

    for (const prev of this.history) {
      // O Mesmo ASK (exact repeat ou a synonymous phrasing) legitimately re-yields o
      // mesmo factual answer. Apenas flag reuse através genuinely DIFFERENT asks.
      if (isSameAsk(prev.question, fp.question)) continue;
      const sim = jaccard(prev.tokens, fp.tokens);
      if (sim > maxSim) maxSim = sim;
      if (fp.firstSentence.length >= 12 && prev.firstSentence === fp.firstSentence) {
        return { repeated: true, reason: 'same_first_sentence', similarity: sim };
      }
      if (fp.scaffoldLabels && prev.scaffoldLabels === fp.scaffoldLabels && sim >= 0.45) {
        return { repeated: true, reason: 'same_scaffold', similarity: sim };
      }
      if (sim >= NEAR_DUP_JACCARD) {
        return { repeated: true, reason: 'near_duplicate', similarity: sim };
      }
    }

    // Stronger verifica contra o Último 3 oapenas Cada exige non-trivial token overlap então
    // two genuinely diferente answers que merely share a stock opener aren't over-flagged.
    for (const prev of recent) {
      if (isSameAsk(prev.question, fp.question)) continue;
      const sim = jaccard(prev.tokens, fp.tokens);
      // Mesmo opening janela (primeiro 8 words) — o "todo answer inicia o smesmo tell.
      if (fp.opening && fp.opening === prev.opening && fp.opening.split(' ').length >= OPENING_WINDOW_WORDS) {
        return { repeated: true, reason: 'same_opening_window', similarity: sim };
      }
      // Mesmo sentence skeleton + meaningful overlap — a canned shape.
      if (fp.skeleton && fp.skeleton === prev.skeleton && fp.skeleton.includes('|') && sim >= 0.3) {
        return { repeated: true, reason: 'same_skeleton', similarity: sim };
      }
      // Mesmo corporate-phrase cluster (2+ shared filler phrases) — robotic repetition.
      if (fp.corporate && fp.corporate === prev.corporate && fp.corporate.includes('|')) {
        return { repeated: true, reason: 'same_corporate_cluster', similarity: sim };
      }
      // Mesmo project reused quando a DIFFERENT grounded project é available.
      if (fp.project && prev.project === fp.project && opts?.availableProjects?.length) {
        const unused = opts.availableProjects.find(
          (p) => p && p.toLowerCase() !== fp.project && !this.history.some((h) => h.project === p.toLowerCase()),
        );
        if (unused) {
          return { repeated: true, reason: 'same_project_reused', similarity: sim, suggestedProject: unused };
        }
      }
    }

    return { repeated: false, similarity: maxSim };
  }

  /** Registro a delivered answer. */
  record(answer: string, answerType: string, question: string, opts?: DiversityCheckOpts): void {
    this.history.push(fingerprint(answer, answerType, question, opts?.availableProjects));
    if (this.history.length > this.maxItems) this.history.splice(0, this.history.length - this.maxItems);
  }

  reset(): void { this.history = []; }
  get size(): number { return this.history.length; }
}

/**
 * Deterministically vary a repeated spoken answer's OPENING então back-to-back answers don't
 * inicia identically. Rotates o leading clause para a diferente natural opener based em a
 * stable index, Sem changing qualquer facts após o primeiro sentence. Fence-safe (Retorna
 * entrada untouched se a código block é present). Used quando an LLM repair isn't vale a
 * round-trip. O goal é apenas para break o "todo answer abre o smesmo tell.
 */
const NATURAL_OPENERS = [
  'Honestly, ', 'The way I\'d put it, ', 'For me, ', 'In practice, ', 'Realistically, ',
];
export function varySpokenOpening(answer: string, rotation: number): string {
  if (!answer) return answer;
  CODE_FENCE_RE.lastIndex = 0;
  if (CODE_FENCE_RE.test(answer)) return answer;
  const trimmed = answer.trimStart();
  // Don't pilha openers: se it já inicia com a hedge/opener, leave it.
  if (/^(honestly|the way|for me|in practice|realistically|i think|the honest|i'?d be upfront|what i)\b/i.test(trimmed)) {
    return answer;
  }
  const opener = NATURAL_OPENERS[((rotation % NATURAL_OPENERS.length) + NATURAL_OPENERS.length) % NATURAL_OPENERS.length];
  // Lowercase o primeiro letter de o original lead então o opener lê naturally.
  const rest = trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
  return opener + rest;
}

/** O one-shot LLM repair instrução para a repeated answer. */
export const DIVERSITY_REPAIR_INSTRUCTION =
  'Rewrite the answer naturally. Do not reuse the previous answer\'s shape, opening sentence, or section labels. No headings unless the user asked for structure. Keep the same facts and grounding.';

/**
 * Last-resort compression: strip visible scaffold labels e colapsar a
 * templated answer dentro de speakable prose. Deterministic — used quando a repair
 * ainda repeats ou não LLM é available.
 */
export function compressToSpeakable(answer: string): string {
  if (!answer) return answer;
  // FENCE SAFETY (2026-06-14): speakable compression strips scaffold labels + bullets +
  // newlines para make prose. If o answer contém a fenced código block (``` … ```) ou
  // a Mermaid/diagram block, compressing iria Exclui o código (o antigo behavior:
  // `replace(CODE_FENCE_RE, '')`) e mangle o rest. A code/diagram answer é nunca
  // "speakable prose" anyway, então leave it untouched.
  CODE_FENCE_RE.lastIndex = 0;
  if (CODE_FENCE_RE.test(answer)) return answer;
  let out = answer;
  // Prefer o "Speakable Final Answer" corpo quando present — it É o prose form.
  const speakable = out.match(/Speakable Final Answer\s*:?\s*\n?([\s\S]+?)(?=\n[A-Z][\w /]+:|$)/i);
  if (speakable && speakable[1].trim().length >= 40) {
    out = speakable[1];
  } else {
    SCAFFOLD_LABEL_RE.lastIndex = 0;
    out = out.replace(SCAFFOLD_LABEL_RE, '');
  }
  // Audit 2026-06-16 (H2): SCAFFOLD_LABEL_RE é a CLOSED lista — a modelo que invents
  // its Próprio markdown structure (`## headers`, `**Summary:**`, markdown tables) slips
  // past it dentro de a "spoken" answer. A spoken answer é lê aloud, então headings/tables
  // são nunca appropriate haqui Strip them generically (this executa Apenas após o
  // fence-safety early retorna aacima então real code/diagram answers são untouched):
  //  - ATX headers (`#`..`######` at line sinicia → soltar o marker, keep o text
  //  - markdown tabela separator rows (`|---|---|`) → soltar o linha
  //  - tabela cell rows (`| a | b |`) → achatar o pipes para ", " então o conteúdo survives como prose
  //  - leading bold "label:" emphasis o modelo uses como a pseudo-header (`**Use cases:**`)
  out = out
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')              // ATX cabeçalho markers
    .replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)+\|?[ \t]*$/gm, '') // tabela separator rows
    .replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_m, cells) => String(cells).split('|').map((c) => c.trim()).filter(Boolean).join(', ')) // tabela data rows → prose
    .replace(/^[ \t]*\*\*([^*\n]{1,40}?):\*\*[ \t]*/gm, '');  // bold pseudo-header "**Label:**"
  out = out.replace(/^[ \t]*[-*•+][ \t]+/gm, '').replace(/\n{2,}/g, ' ').replace(/\s+/g, ' ').trim();
  return cleanAnswerArtifacts(out);
}
