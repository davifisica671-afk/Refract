// types.ts
// Transcript/chunk pipeline types + re-export de o canonical MeetingSummaryV3 sschema
//
// O spec-aligned note schema (MeetingSummaryV3 e its item types) lives em
// MeetingSummaryV3.ts e é re-exported aqui então existing `import ... de './types'`
// chamar sites keep working. This arquivo additionally owns o normalization/chunking
// types que são específico para o summarization pipeline.

export * from './MeetingSummaryV3';

import type { EvidenceRef, DecisionItem, ActionItem, QuestionItem, RiskItem, PersonMention } from './MeetingSummaryV3';

// Back-compat alias: older código referenced `BulletItem`; o canonical nome é NoteBullet.
export type { NoteBullet as BulletItem } from './MeetingSummaryV3';
// Back-compat alias: older código referenced `MeetingSummarySectionV3`.
export type { MeetingNoteSection as MeetingSummarySectionV3 } from './MeetingSummaryV3';
// Back-compat alias: older código referenced `SourceQualityMeta`.
export type { SourceQuality as SourceQualityMeta } from './MeetingSummaryV3';

export interface NormalizedTranscriptSegment {
  segmentId: string;
  speaker: string;
  speakerId?: string;
  text: string;
  timestamp: number;
  uncertainSpeaker?: boolean;
  originalIndex: number;
}

export interface NormalizedTranscript {
  segments: NormalizedTranscriptSegment[];
  text: string;
  totalChars: number;
  totalTokensEstimate: number;
  qualityWarnings: string[];
  speakerQuality: 'good' | 'mixed' | 'poor';
}

export interface TranscriptChunk {
  chunkIndex: number;
  segments: NormalizedTranscriptSegment[];
  text: string;
  charCount: number;
  tokenEstimate: number;
  overlapFromPrevious: boolean;
  timeRange: { startMs?: number; endMs?: number };
  segmentIds: string[];
}

// A finding routed dentro de one de o mode's note sections. Carries evidence então section
// bullets são como inspectable como decisions/actions. Accepts a bare string em o wire
// (coerced para { texto } por o validator) para back-compat.
export interface ModeSectionFinding {
  text: string;
  evidence?: EvidenceRef[];
  source?: 'explicit' | 'inferred';
  confidence?: 'high' | 'medium' | 'low';
}

export interface ChunkMeetingAtoms {
  chunkIndex: number;
  timeRange: { startMs?: number; endMs?: number };
  brief: string;
  topics: string[];
  decisions: DecisionItem[];
  actionItems: ActionItem[];
  openQuestions: QuestionItem[];
  risks: RiskItem[];
  deadlines?: ActionItem[];
  people: PersonMention[];
  importantQuotes: EvidenceRef[];
  modeSpecificFindings: Record<string, ModeSectionFinding[]>;
  sourceQualityWarnings?: string[];
}

export interface MeetingModeSectionInput {
  title: string;
  description?: string;
  /** AI-compiled extraction instrução (preferred sobre description quando present). */
  compiledPrompt?: string;
}

export interface MeetingSummaryTelemetryMeta {
  chunkCount: number;
  v3Used: boolean;
  transcriptCoveragePercent: number;
  strategy: 'direct' | 'map_reduce' | 'long_context' | 'fallback';
}
