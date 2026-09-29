import { Worker } from 'worker_threads';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import { Chess } from 'chess.js';
import type { Move, Square } from 'chess.js';

export class ChessEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChessEngineError';
  }
}

export interface BestMove {
  from: string;
  to: string;
  uci: string;
  evalCp: number | null;
}

export interface GetBestMoveOptions {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 2000;
const SEARCH_DEPTH = 12;

const engineRequire = createRequire(__filename);

/**
 * Build the bootstrap script for the Stockfish worker.
 *
 * The engine is an OPTIONAL user-side download (see
 * scripts/download-stockfish.mjs and resolveEnginePath below), never a
 * bundled dependency. The entry file (`stockfish.wasm.js`) is an Emscripten
 * Web-Worker script: it talks through the globals `onmessage`/`postMessage`
 * and loads `stockfish.wasm` via `fetch()`. Neither exists in a Node
 * `worker_threads` worker, so the bootstrap shims them:
 * - `postMessage`/`close` forward to `parentPort`
 * - parent messages are dispatched to the engine's global `onmessage`
 * - `fetch` serves files relative to the engine directory (the `.wasm`
 *   binary) with an `application/wasm` content type so streaming compilation
 *   succeeds.
 */
function buildBootstrap(enginePath: string): string {
  const engineDir = path.dirname(enginePath);
  return [
    "const { parentPort } = require('worker_threads');",
    "const fs = require('fs');",
    "const path = require('path');",
    `const engineDir = ${JSON.stringify(engineDir)};`,
    'const nativeFetch = typeof global.fetch === "function" ? global.fetch.bind(global) : null;',
    'global.fetch = function (input, init) {',
    '  const url = typeof input === "string" ? input : (input && input.url);',
    '  if (typeof url === "string" && !/^[a-zA-Z][a-zA-Z0-9+\\-.]*:/.test(url)) {',
    '    const abs = path.resolve(engineDir, url);',
    '    const buf = fs.readFileSync(abs);',
    '    return Promise.resolve(new Response(buf, { status: 200, headers: { "Content-Type": "application/wasm" } }));',
    '  }',
    '  if (nativeFetch) return nativeFetch(input, init);',
    '  throw new Error("fetch not available");',
    '};',
    'global.postMessage = function (data) { parentPort.postMessage(data); };',
    'global.close = function () { try { parentPort.close(); } catch (err) { void err; } };',
    "parentPort.on('message', function (data) {",
    '  const handler = global.onmessage;',
    "  if (typeof handler === 'function') handler({ data: data });",
    '});',
    `require(${JSON.stringify(enginePath)});`,
  ].join('\n');
}

interface EngineSearchResult {
  uci: string;
  evalCp: number | null;
}

/**
 * Resolve the Stockfish engine entry file (`stockfish.wasm.js`).
 *
 * Resolution order:
 * (a) packaged app: <resourcesPath>/engine/stockfish.wasm.js (electron-builder
 *     extraResources), used when `app?.isPackaged`;
 * (b) dev checkout: <repoRoot>/resources/engine/stockfish.wasm.js — `__dirname`
 *     is dist-electron/electron/services, so 3 ups = repo root (the candidate
 *     is used only when the file actually exists, else resolution continues);
 * (c) legacy: a manually installed `stockfish.js` package (try/catch).
 * First hit with an existing `stockfish.wasm` sibling wins; otherwise throws
 * an 'engine unavailable...' error (graceful degradation upstream).
 */
function resolveEnginePath(): string {
  const candidates: string[] = [];
  if (Boolean(app?.isPackaged) && typeof process.resourcesPath === 'string') {
    candidates.push(path.join(process.resourcesPath, 'engine', 'stockfish.wasm.js'));
  }
  candidates.push(path.resolve(__dirname, '..', '..', '..', 'resources', 'engine', 'stockfish.wasm.js'));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.existsSync(path.join(path.dirname(candidate), 'stockfish.wasm'))) {
      return candidate;
    }
  }
  try {
    const legacy = engineRequire.resolve('stockfish.js');
    if (fs.existsSync(path.join(path.dirname(legacy), 'stockfish.wasm'))) {
      return legacy;
    }
  } catch {
    // No manually installed copy — fall through to the error below.
  }
  throw new ChessEngineError(
    'engine unavailable: stockfish engine not found (run node scripts/download-stockfish.mjs to download the optional engine)',
  );
}

export class ChessEngineService {
  private readonly cache = new Map<string, BestMove>();
  private readonly liveWorkers = new Set<Worker>();

  async getBestMove(fen: string, opts?: GetBestMoveOptions): Promise<BestMove> {
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    let chess: Chess;
    try {
      chess = new Chess(fen);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new ChessEngineError(`illegal FEN: ${detail}`);
    }

    const cached = this.cache.get(fen);
    if (cached !== undefined) {
      return cached;
    }

    const { uci, evalCp } = await this.search(fen, timeoutMs);
    const best = this.validateEngineMove(chess, fen, uci, evalCp);
    this.cache.set(fen, best);
    return best;
  }

  async dispose(): Promise<void> {
    const workers = [...this.liveWorkers];
    this.liveWorkers.clear();
    for (const worker of workers) {
      try {
        await worker.terminate();
      } catch {
        // Best-effort cleanup.
      }
    }
  }

  private validateEngineMove(chess: Chess, fen: string, uci: string, evalCp: number | null): BestMove {
    const shape = /^[a-h][1-8][a-h][1-8][qrbn]?$/.exec(uci);
    if (shape === null) {
      throw new ChessEngineError(`engine returned illegal move ${uci} for FEN ${fen}`);
    }
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    let legal: Move[];
    try {
      legal = chess.moves({ square: from as Square, verbose: true });
    } catch {
      throw new ChessEngineError(`engine returned illegal move ${uci} for FEN ${fen}`);
    }
    const found = legal.some((move: Move) => move.to === to);
    if (!found) {
      throw new ChessEngineError(`engine returned illegal move ${uci} for FEN ${fen}`);
    }
    return { from, to, uci, evalCp };
  }

  private search(fen: string, timeoutMs: number): Promise<EngineSearchResult> {
    return new Promise<EngineSearchResult>((resolve, reject) => {
      let settled = false;
      let worker: Worker | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = (): void => {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
        if (worker !== undefined) {
          this.liveWorkers.delete(worker);
          void worker.terminate();
          worker = undefined;
        }
      };

      const fail = (err: ChessEngineError): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(err);
      };

      let enginePath: string;
      try {
        enginePath = resolveEnginePath();
      } catch (err) {
        fail(err instanceof ChessEngineError ? err : new ChessEngineError(`engine unavailable: ${err instanceof Error ? err.message : String(err)}`));
        return;
      }

      try {
        worker = new Worker(buildBootstrap(enginePath), { eval: true });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        fail(new ChessEngineError(`engine unavailable: ${detail}`));
        return;
      }
      const active: Worker = worker;
      this.liveWorkers.add(active);

      let evalCp: number | null = null;
      active.on('message', (msg: unknown) => {
        if (settled) {
          return;
        }
        const line = String(msg).trim();
        if (line === 'uciok') {
          active.postMessage('isready');
          return;
        }
        if (line === 'readyok') {
          active.postMessage(`position fen ${fen}`);
          active.postMessage(`go depth ${SEARCH_DEPTH}`);
          return;
        }
        const score = /\bscore\s+cp\s+(-?\d+)/.exec(line);
        if (score !== null) {
          evalCp = Number.parseInt(score[1], 10);
        }
        const best = /^bestmove\s+(\S+)/.exec(line);
        if (best !== null) {
          settled = true;
          cleanup();
          const uci = best[1];
          if (uci === '(none)') {
            reject(new ChessEngineError(`engine returned illegal move (none) for FEN ${fen}`));
            return;
          }
          resolve({ uci, evalCp });
        }
      });
      active.on('error', (err: Error) => {
        fail(new ChessEngineError(`engine failed: ${err.message}`));
      });
      active.on('exit', (code: number) => {
        fail(new ChessEngineError(`engine failed: worker exited with code ${code}`));
      });

      timer = setTimeout(() => {
        fail(new ChessEngineError('engine timeout'));
      }, timeoutMs);
      active.postMessage('uci');
    });
  }
}
