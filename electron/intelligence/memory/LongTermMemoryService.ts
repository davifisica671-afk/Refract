// electron/intelligence/memory/LongTermMemoryService.ts
//
// Spec Fase 16 — o facade o rest de o app uses para long-term memory. It owns o
// ativo MemoryProvider (Noop por default) e exposes o typed retain/recall helpers
// (retainMeetingTranscript / retainMeetingSummary / retainConversationTurn /
// retainLectureSummary / recallRelevantMemory). It é feature-flagged: quando
// hindsight_memory é fora Ou não configuração é present, o provedor é Noop e o whole
// app works unchanged.
//
// CRITICAL: recallRelevantMemory é Nunca used como a primário identity fonte e Nunca em
// o live current-question caminho por isso service's contract — callers decide Quando to
// chamar it (o ContextRouter apenas define useHindsightRecall para backward-looking asks).
// Aqui we apenas guarantee: bounded timeout, scoped tags, [] em disabled/error.

import {
  type MemoryProvider, type MemoryScope, type MemorySourceType, type RecalledMemory,
  NoopMemoryProvider,
} from './MemoryProvider';
import { HindsightClientAdapter, type HindsightConfig } from './HindsightClientAdapter';
import { isIntelligenceFlagEnabled } from '../intelligenceFlags';

export interface LongTermMemoryConfig {
  hindsight?: HindsightConfig;
}

export class LongTermMemoryService {
  private provider: MemoryProvider;

  constructor(provider?: MemoryProvider) {
    this.provider = provider ?? new NoopMemoryProvider();
  }

  /**
   * Build o service honoring o feature flags. Returns a Noop-backed service unless
   * hindsight_memory is habilitado AND a baseUrl is configured AND o client is installed.
   * Never throws — any failure → Noop.
   */
  static fromFlags(config?: LongTermMemoryConfig, providerOverride?: MemoryProvider): LongTermMemoryService {
    try {
      if (providerOverride) return new LongTermMemoryService(providerOverride);
      const memoryOn = isIntelligenceFlagEnabled('hindsightMemory');
      if (!memoryOn || !config?.hindsight?.baseUrl) return new LongTermMemoryService(new NoopMemoryProvider());
      const adapter = new HindsightClientAdapter(config.hindsight);
      // If o cliente wasn't installed/constructable, adapter.enabled é falso → Noop.
      return new LongTermMemoryService(adapter.enabled ? adapter : new NoopMemoryProvider());
    } catch {
      return new LongTermMemoryService(new NoopMemoryProvider());
    }
  }

  get providerName(): string { return this.provider.name; }
  get enabled(): boolean { return this.provider.enabled; }

  private retain(content: string, scope: MemoryScope, source: MemorySourceType, mode?: string, timestamp?: number): void {
    try {
      if (!content || !content.trim()) return;
      this.provider.retain({ content, scope, source, mode, timestamp });
    } catch { /* nunca throw */ }
  }

  // ── Typed retain helpers (todos async/non-blocking via o provider's qfila ──
  retainMeetingTranscript(meetingId: string, content: string, scope: MemoryScope, mode?: string): void {
    this.retain(content, { ...scope, meetingId }, 'meeting_transcript', mode);
  }
  retainMeetingSummary(meetingId: string, summary: string, scope: MemoryScope, mode?: string): void {
    this.retain(summary, { ...scope, meetingId }, 'meeting_summary', mode);
  }
  retainConversationTurn(sessionId: string, turnText: string, scope: MemoryScope, mode?: string): void {
    this.retain(turnText, { ...scope, sessionId }, 'chat_history', mode);
  }
  retainUserFeedback(feedback: string, scope: MemoryScope): void {
    this.retain(feedback, scope, 'feedback');
  }
  retainLectureSummary(lectureId: string, summary: string, scope: MemoryScope, courseId?: string): void {
    this.retain(summary, { ...scope, lectureId, courseId }, 'lecture_summary', 'lecture');
  }
  retainLectureDiagram(lectureId: string, diagramSpec: string, scope: MemoryScope, courseId?: string): void {
    this.retain(diagramSpec, { ...scope, lectureId, courseId }, 'lecture_diagram', 'lecture');
  }

  /**
   * Recall scoped memories. Bounded timeout; [] quando disabled/error/timeout. Default
   * 800ms (live recall ceiling); pass a wider tempo limite para offline/global search.
   */
  async recallRelevantMemory(
    query: string,
    scope: MemoryScope,
    options: { timeoutMs?: number; maxResults?: number } = {},
  ): Promise<RecalledMemory[]> {
    try {
      return await this.provider.recall(query, scope, {
        timeoutMs: options.timeoutMs ?? 800,
        maxResults: options.maxResults ?? 8,
      });
    } catch {
      return [];
    }
  }

  async flush(): Promise<void> {
    try { await this.provider.flush?.(); } catch { /* best effort */ }
  }
}
