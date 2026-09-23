import type { BestMove } from './ChessEngineService';

export class ChessCoachError extends Error {}

export interface ChessExtract { fen: string; turn: 'w' | 'b'; }
export interface ChessEngineLike {
  getBestMove(fen: string): Promise<BestMove>;
}
export interface ChessCoachDeps {
  extract: (imageB64: string) => Promise<ChessExtract>;
  engine: ChessEngineLike;
  explain: (args: { fen: string; uci: string; turn: string }) => Promise<string>;
}

const MAX_IMAGE_CHARS = 15 * 1024 * 1024;

export class ChessCoachService {
  constructor(private readonly deps: ChessCoachDeps) {}

  async analyze(imageB64: string) {
    if (imageB64.length > MAX_IMAGE_CHARS) {
      throw new ChessCoachError('image exceeds 15 MB limit');
    }
    let extracted: ChessExtract | null = null;
    for (let attempt = 0; attempt < 2 && !extracted; attempt += 1) {
      try {
        extracted = await this.deps.extract(imageB64);
      } catch {
        if (attempt === 1) break;
      }
    }
    if (!extracted) {
      const explanation = await this.deps.explain({ fen: '', uci: '', turn: 'w' });
      return { verified: false as const, explanation };
    }
    let best;
    try {
      best = await this.deps.engine.getBestMove(extracted.fen);
    } catch {
      const explanation = await this.deps.explain({ fen: extracted.fen, uci: '', turn: extracted.turn });
      return { fen: extracted.fen, turn: extracted.turn, verified: false as const, explanation };
    }
    const explanation = await this.deps.explain({ fen: extracted.fen, uci: best.uci, turn: extracted.turn });
    return { ...best, fen: extracted.fen, turn: extracted.turn, verified: true as const, explanation };
  }
}
