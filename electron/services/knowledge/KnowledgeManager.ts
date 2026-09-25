// Stub (build recovery): OKF knowledge-pack manager.
// Degraded: no pack for any file, no packs for any mode, generation reports
// `unavailable`.
// Signature notes (READ-first adaptations vs the plan sketch):
// - getPackForFile is SYNC (every call site dereferences the return without
//   await: `km.getPackForFile(file.id)`, `pack.cards`, `pack.entities`).
// - getPacksForMode is SYNC (`KnowledgeManager.getInstance().getPacksForMode(modeId).map(...)`
//   feeds the list-packs summary shape directly).
// - generateForFile is SYNC (`const result = ...generateForFile({...}, true)`
//   with no await, then `result.status === 'generated'`), returning a status
//   envelope rather than { ok }.
export interface KnowledgeCard {
  title: string;
  body: string;
  type?: string;
  confidence?: number;
  entities?: string[];
  tags?: string[];
  sourceSections?: unknown[];
}

export interface KnowledgeEntity {
  name: string;
}

export interface KnowledgePack {
  id: string;
  cards: KnowledgeCard[];
  entities: KnowledgeEntity[];
  [key: string]: unknown;
}

export interface KnowledgePackSummary {
  id: string;
  [key: string]: unknown;
}

export interface KnowledgeGenerateResult {
  status: string;
  pack: KnowledgePack | null;
  error?: string;
}

export class KnowledgeManager {
  private static instance: KnowledgeManager | null = null;

  static getInstance(): KnowledgeManager {
    if (!KnowledgeManager.instance) KnowledgeManager.instance = new KnowledgeManager();
    return KnowledgeManager.instance;
  }

  getPackForFile(_fileId: string): KnowledgePack | null {
    return null;
  }

  getPacksForMode(_modeId: string): KnowledgePackSummary[] {
    return [];
  }

  generateForFile(_args: unknown, _force?: boolean): KnowledgeGenerateResult {
    return { status: 'unavailable', pack: null, error: 'not-available' };
  }
}
