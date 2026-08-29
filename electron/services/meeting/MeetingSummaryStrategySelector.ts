// MeetingSummaryStrategySelector.ts (Fase 6)
// Escolhe como a transcript é summarized:
//   - direct       : curto transcript → a único chunk → one structured extraction pass
//   - map_reduce   : medium/long → chunk + overlap → per-chunk atoms → reduzir  (default)
//   - long_context : medium band oapenas quando a long-context modelo é ativo AND token count
//                    é safely sob a conservative cap. Até então we PREFER map_reduce para
//                    muito longo meetings para avoid "lost em o middle"; long_context apenas
//                    salva latency em o medium band. Falls voltar para map_reduce em failure.
//
// This selector é pure (não I/O) e deterministic given its inputs.

import type { NormalizedTranscript } from './types';
import type { SummaryStrategy } from './MeetingSummaryV3';

export interface StrategySelectorOptions {
  // Token thresholds (estimates, ~4 chars/token).
  shortThresholdTokens?: number;     // <= this → direct
  longContextSafeTokens?: number;    // <= this AND long-context allowed → long_context candidate
  // Se o ativo model/provider suporta a grande contexto janela safely.
  longContextAllowed?: boolean;
  // Master alternar para o long_context single-pass optimization.
  enableLongContext?: boolean;
}

const DEFAULT_SHORT_THRESHOLD_TOKENS = 1500;
const DEFAULT_LONG_CONTEXT_SAFE_TOKENS = 48000;

export interface StrategyDecision {
  strategy: SummaryStrategy;
  reason: string;
  totalTokensEstimate: number;
}

export class MeetingSummaryStrategySelector {
  select(transcript: NormalizedTranscript, options: StrategySelectorOptions = {}): StrategyDecision {
    const shortThreshold = Math.max(250, options.shortThresholdTokens ?? DEFAULT_SHORT_THRESHOLD_TOKENS);
    const longContextSafe = Math.max(shortThreshold, options.longContextSafeTokens ?? DEFAULT_LONG_CONTEXT_SAFE_TOKENS);
    const tokens = transcript.totalTokensEstimate;

    if (transcript.segments.length === 0) {
      return { strategy: 'fallback', reason: 'empty transcript', totalTokensEstimate: tokens };
    }

    if (tokens <= shortThreshold) {
      return { strategy: 'direct', reason: `short transcript (${tokens} tok <= ${shortThreshold})`, totalTokensEstimate: tokens };
    }

    // Long-context único pass é a medium-band optimization apenas e precisa ser explicitly
    // enabled. Muito longo meetings sempre uso map_reduce.
    if (options.enableLongContext && options.longContextAllowed && tokens <= longContextSafe) {
      return { strategy: 'long_context', reason: `medium transcript with long-context model (${tokens} tok <= ${longContextSafe})`, totalTokensEstimate: tokens };
    }

    return { strategy: 'map_reduce', reason: `medium/long transcript (${tokens} tok)`, totalTokensEstimate: tokens };
  }
}
