// Tipos do motor puro em presenceCoachEngine.mjs (que não carrega tipos próprios).
export const WORD_MS: number;
export const PACE_WINDOW_MS: number;
export const NUDGE_COOLDOWN_MS: number;
export const WARMUP_MS: number;

export interface PresenceSnapshot {
  talk: { userMs: number; otherMs: number; userPct: number };
  maxMonologueMs: number;
  paceWpm: number;
  fillers: { total: number; byWord: Record<string, number> };
  interruptions: number;
  elapsedMs: number;
}
export interface PresenceNudge {
  type: 'monologue' | 'pace' | 'dominating' | 'interrupting';
}
export interface PresenceCoachEngine {
  ingest(seg: { speaker: string; text: string; timestamp: number; final: boolean }): void;
  snapshot(): PresenceSnapshot;
  drainNudges(): PresenceNudge[];
  reset(): void;
}
export function createPresenceCoachEngine(opts?: { now?: () => number; lang?: string }): PresenceCoachEngine;
