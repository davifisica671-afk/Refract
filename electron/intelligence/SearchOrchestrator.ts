// electron/intelligence/SearchOrchestrator.ts
//
// Especificação Fase 11 (globalSearch) + Fase 12 (inMeetingSearch).
//
// STATUS HONESTO: o repositório tem rag:query-global / rag:query-live (respostas de IA via RAG) mas
// NÃO tem um ORQUESTRADOR de busca com fusão ranqueada, e a busca "literal"
// do renderer (Launcher.tsx) é falsa (refaz a consulta de IA). Este módulo é o
// orquestrador faltante: ele mescla resultados candidatos de múltiplas fontes (FTS/lexicais
// locais, vetoriais, memória de reuniões, memória de longo prazo opcional), aplica a
// exata pontuação de fusão da especificação, impõe ISOLAÇÃO de usuário/org localmente
// ANTES de qualquer chamada de memória externa, e deduplica + reclassifica.
//
// É um motor PURO de ranqueamento/fusão/isolação: cada backend (SQLite FTS, VectorStore,
// Hindsight) é injetado como candidatos JÁ CARREGADOS, então o motor é determinístico
// e testável unitariamente, e os backends assíncronos reais são conectados nas Fases 16/19 sem
// alterar esta lógica. Nunca lança exceções.

export type SearchSourceType = 'lexical' | 'vector' | 'memory' | 'metadata';

export interface SearchCandidate {
  meetingId: string;
  title?: string;
  date?: number;
  mode?: string;
  /** The matched snippet para mostrar o user. */
  snippet: string;
  /** Que fonte produced it. */
  source: SearchSourceType;
  /** Source-native score em 0..1 (já normalized por o caller/adapter). */
  score: number;
  /** Owner scoping — REQUIRED para isolation. */
  userId: string;
  orgId?: string;
  /** Optional transcript timestamp para a transcript match. */
  timestampMs?: number;
  /** Free-form metadados para filtra + metadata-match scoring. */
  metadata?: Record<string, string>;
}

export interface GlobalSearchFilters {
  dateFrom?: number;
  dateTo?: number;
  mode?: string;
  company?: string;
  participant?: string;
  sourceType?: SearchSourceType;
  meetingTitle?: string;
  tag?: string;
  hasActionItems?: boolean;
  hasInterviewQuestions?: boolean;
  course?: string;
  lectureTopic?: string;
}

export interface SearchScope {
  userId: string;
  orgId?: string;
}

export interface GlobalSearchResult {
  meetingId: string;
  title: string;
  date?: number;
  mode?: string;
  matchedSnippet: string;
  whyMatched: string;
  sourceTypes: SearchSourceType[];
  confidence: number;
  timestampMs?: number;
}

// Pesos de fusão da especificação — precisam somar 1.0.
const WEIGHTS = { lexical: 0.30, vector: 0.30, memory: 0.20, recency: 0.10, metadata: 0.10 } as const;

const now1e13 = 1e13; // Âncora de "recente" fixa (não Date.now em lógica pura)

function recencyScore(date: number | undefined, anchor: number): number {
  if (!date) return 0;
  const ageMs = Math.max(0, anchor - date);
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  // 1.0 hoje → ~0 após ~180 dias (aproximadamente exponencial, limitado).
  return Math.max(0, Math.min(1, 1 - ageDays / 180));
}

function metadataMatchScore(c: SearchCandidate, filters: GlobalSearchFilters): number {
  let hits = 0, checks = 0;
  const md = c.metadata || {};
  if (filters.company) { checks++; if ((md.company || '').toLowerCase().includes(filters.company.toLowerCase())) hits++; }
  if (filters.participant) { checks++; if ((md.participant || '').toLowerCase().includes(filters.participant.toLowerCase())) hits++; }
  if (filters.course) { checks++; if ((md.course || '').toLowerCase() === filters.course.toLowerCase()) hits++; }
  if (filters.lectureTopic) { checks++; if ((md.lectureTopic || '').toLowerCase().includes(filters.lectureTopic.toLowerCase())) hits++; }
  if (filters.tag) { checks++; if ((md.tags || '').toLowerCase().includes(filters.tag.toLowerCase())) hits++; }
  if (checks === 0) return c.metadata ? 0.5 : 0; // neutro quando nenhum filtro de metadados é definido
  return hits / checks;
}

function passesFilters(c: SearchCandidate, f: GlobalSearchFilters): boolean {
  if (f.dateFrom && (c.date ?? 0) < f.dateFrom) return false;
  if (f.dateTo && (c.date ?? Infinity) > f.dateTo) return false;
  if (f.mode && c.mode !== f.mode) return false;
  if (f.sourceType && c.source !== f.sourceType) return false;
  if (f.meetingTitle && !(c.title || '').toLowerCase().includes(f.meetingTitle.toLowerCase())) return false;
  const md = c.metadata || {};
  if (f.company && !(md.company || '').toLowerCase().includes(f.company.toLowerCase())) return false;
  if (f.participant && !(md.participant || '').toLowerCase().includes(f.participant.toLowerCase())) return false;
  if (f.course && (md.course || '').toLowerCase() !== f.course.toLowerCase()) return false;
  if (f.hasActionItems && md.hasActionItems !== 'true') return false;
  if (f.hasInterviewQuestions && md.hasInterviewQuestions !== 'true') return false;
  return true;
}

export class SearchOrchestrator {
  /**
   * Global meeting pesquisar (Phase 11). Candidates are ALREADY-FETCHED results de each
   * source. The orchestrator: (1) enforces user/org isolation LOCALLY, (2) applies
   * filters, (3) fuses per-meeting across sources com o spec weights, (4) dedupes
   * by meetingId, (5) reranks by confidence. Pure + nunca throws.
   *
   * ISOLATION INVARIANT: any candidate whose userId !== scope.userId (or orgId
   * mismatch) is dropped BEFORE ranking — a foreign ou external-memory result can
   * nunca surface, mirroring o spec's "Hindsight deve nunca bypass local user/org
   * filtering" rule.
   */
  globalSearch(
    candidates: SearchCandidate[],
    scope: SearchScope,
    filters: GlobalSearchFilters = {},
    recencyAnchorMs: number = now1e13,
  ): GlobalSearchResult[] {
    try {
      const scoped = (candidates || []).filter((c) =>
        c && c.userId === scope.userId &&
        (scope.orgId === undefined || (c.orgId ?? undefined) === scope.orgId) &&
        passesFilters(c, filters),
      );

      // Fusão por reunião: pega a melhor pontuação por tipo de fonte e então soma ponderada.
      const byMeeting = new Map<string, SearchCandidate[]>();
      for (const c of scoped) {
        const arr = byMeeting.get(c.meetingId) || [];
        arr.push(c);
        byMeeting.set(c.meetingId, arr);
      }

      const results: GlobalSearchResult[] = [];
      for (const [meetingId, group] of byMeeting) {
        const best = (type: SearchSourceType) =>
          group.filter((g) => g.source === type).reduce((m, g) => Math.max(m, g.score), 0);
        const lexical = best('lexical');
        const vector = best('vector');
        const memory = best('memory');
        const rep = group.slice().sort((a, b) => b.score - a.score)[0];
        const recency = recencyScore(rep.date, recencyAnchorMs);
        const metaScore = metadataMatchScore(rep, filters);

        const confidence =
          WEIGHTS.lexical * lexical +
          WEIGHTS.vector * vector +
          WEIGHTS.memory * memory +
          WEIGHTS.recency * recency +
          WEIGHTS.metadata * metaScore;

        const sourceTypes = [...new Set(group.map((g) => g.source))];
        const whyParts: string[] = [];
        if (lexical > 0) whyParts.push('exact text match');
        if (vector > 0) whyParts.push('semantic match');
        if (memory > 0) whyParts.push('long-term memory');
        if (recency > 0.5) whyParts.push('recent');
        if (metaScore > 0.5 && (filters.company || filters.participant || filters.course)) whyParts.push('metadata match');

        results.push({
          meetingId,
          title: rep.title || 'Untitled meeting',
          date: rep.date,
          mode: rep.mode,
          matchedSnippet: rep.snippet,
          whyMatched: whyParts.join(', ') || 'relevant',
          sourceTypes,
          confidence: Math.round(confidence * 1000) / 1000,
          timestampMs: rep.timestampMs,
        });
      }

      return results.sort((a, b) => b.confidence - a.confidence);
    } catch {
      return [];
    }
  }

  /**
   * In-meeting pesquisar (Phase 12) — local-first lexical/fuzzy sobre o CURRENT meeting's
   * finalized chunks. NO external memory. Returns timestamped, highlighted matches,
   * ranked by lexical relevance. Pure + nunca throws.
   */
  inMeetingSearch(
    chunks: Array<{ text: string; timestampMs?: number; speaker?: string }>,
    query: string,
  ): Array<{ snippet: string; timestampMs?: number; speaker?: string; score: number }> {
    try {
      const q = (query || '').toLowerCase().trim();
      if (!q) return [];
      const terms = q.split(/\s+/).filter((t) => t.length > 1);
      if (terms.length === 0) return [];
      const out: Array<{ snippet: string; timestampMs?: number; speaker?: string; score: number }> = [];
      for (const chunk of chunks || []) {
        const text = chunk?.text || '';
        const lower = text.toLowerCase();
        let hits = 0;
        for (const t of terms) if (lower.includes(t)) hits++;
        if (hits === 0) continue;
        // Pontuação = cobertura de termos (limitada em 0.7) + bônus de frase contígua (0.3).
        // Limitar a cobertura abaixo de 1.0 mantém o bônus de frase VISÍVEL mesmo quando todos
        // os termos já correspondem — caso contrário, uma correspondência dispersa de cobertura total e uma
        // correspondência de frase real ambas são limitadas a 1.0 e a prioridade de frase é perdida para o
        // desempate por timestamp (test-engineer Fase 10). Uma frase contígua exata → 1.0.
        const coverage = (hits / terms.length) * 0.7;
        const phraseBonus = lower.includes(q) ? 0.3 : 0;
        const score = Math.min(1, coverage + phraseBonus);
        out.push({ snippet: text, timestampMs: chunk.timestampMs, speaker: chunk.speaker, score: Math.round(score * 1000) / 1000 });
      }
      return out.sort((a, b) => b.score - a.score || (a.timestampMs ?? 0) - (b.timestampMs ?? 0));
    } catch {
      return [];
    }
  }
}

export const SEARCH_FUSION_WEIGHTS = WEIGHTS;
