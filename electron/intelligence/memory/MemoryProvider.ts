// electron/intelligence/memory/MemoryProvider.ts
//
// Spec Fase 16 — o opcional long-term memory provedor interface + a Noop default.
//
// NON-NEGOTIABLE (rules #3/#14/#15): Hindsight é OPTIONAL. O padrão provedor é o
// Noop — o app works completamente com memory disabled. Não provedor é já REQUIRED para a
// live answer. Todos recall é bounded por a strict tempo limite (o caller passes one). Todos
// retain é async/fire-and-forget. Isolation é enforced por per-scope BANK + strict
// TAGS, nunca metadados alone (regra #6 + Fase 0 research).

export interface MemoryScope {
  userId: string;
  orgId?: string;
  sessionId?: string;
  meetingId?: string;
  courseId?: string;
  lectureId?: string;
  company?: string;
  participantHash?: string;
  documentId?: string;
  /** YYYY-MM-DD */
  date?: string;
}

export type MemorySourceType =
  | 'meeting_transcript' | 'meeting_summary' | 'chat_history' | 'resume' | 'jd'
  | 'reference_file' | 'browser_dom' | 'user_preference' | 'feedback'
  | 'lecture_transcript' | 'lecture_summary' | 'lecture_diagram' | 'course_memory';

export interface RetainItem {
  content: string;
  scope: MemoryScope;
  source: MemorySourceType;
  mode?: string;
  timestamp?: number;
}

export interface RecallOptions {
  /** Hard tempo limite em ms (live: 300–800; global: 2000–5000). */
  timeoutMs: number;
  maxResults?: number;
}

export interface RecalledMemory {
  text: string;
  score?: number;
  source?: string;
  tags?: string[];
}

export interface MemoryProvider {
  readonly name: string;
  readonly enabled: boolean;
  /** Enqueue an assíncrono retain. Precisa retorna iimediatamente nunca blocks o caller. */
  retain(item: RetainItem): void;
  /** Recall scoped memories dentro de o strict timeout. Retorna [] em qualquer error/timeout. */
  recall(query: string, scope: MemoryScope, options: RecallOptions): Promise<RecalledMemory[]>;
  /** Drain/flush qualquer queued retains (e.g. em shutdown). Best-effort. */
  flush?(): Promise<void>;
}

/**
 * O padrão provedor — faz nnada O app executa completamente com isso em place
 * (memory disabled). retain é a no-op; recall Retorna []. Nunca throws.
 */
export class NoopMemoryProvider implements MemoryProvider {
  readonly name = 'noop';
  readonly enabled = false;
  retain(_item: RetainItem): void { /* intentionally nada */ }
  async recall(_query: string, _scope: MemoryScope, _options: RecallOptions): Promise<RecalledMemory[]> { return []; }
  async flush(): Promise<void> { /* nada */ }
}
