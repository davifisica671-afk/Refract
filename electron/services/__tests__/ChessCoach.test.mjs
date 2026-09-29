import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modesPath = path.resolve(__dirname, '../../../dist-electron/electron/services/ModesManager.js');
const promptsPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/prompts.js');

const modesMod = await import(pathToFileURL(modesPath).href);
const promptsMod = await import(pathToFileURL(promptsPath).href);
const { MODE_TEMPLATES, TEMPLATE_NOTE_SECTIONS, isFreeModeTemplate } = modesMod;

describe('chess mode registration', () => {
  test('chess template is listed with notes and is free', () => {
    const tpl = MODE_TEMPLATES.find((t) => t.type === 'chess');
    assert.ok(tpl, 'chess template missing');
    assert.ok(tpl.label.length > 0 && tpl.description.length > 0);
    assert.ok(TEMPLATE_NOTE_SECTIONS.chess.length >= 3, 'needs >=3 note sections');
    assert.equal(isFreeModeTemplate('chess'), true);
  });

  test('chess prompt constrains FEN output', () => {
    assert.ok(typeof promptsMod.MODE_CHESS_PROMPT === 'string');
    assert.match(promptsMod.MODE_CHESS_PROMPT, /FEN/);
  });
});

describe('chessFenExtractor', () => {
  test('parses a clean FEN line', async () => {
    const mod = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/chessFenExtractor.js')).href);
    const out = mod.parseFenReply('FEN: rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
    assert.equal(out.turn, 'b');
    assert.match(out.fen, /^rnbqkbnr/);
  });

  test('rejects garbage and kingless positions', async () => {
    const mod = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/chessFenExtractor.js')).href);
    assert.throws(() => mod.parseFenReply('I see a knight maybe'), /FEN/);
    assert.throws(() => mod.parseFenReply('FEN: 8/8/8/8/8/8/8/8 w - - 0 1'), /king/);
  });
});

describe('chessEngineService', () => {
  test('finds mate in 1 (Scholar mate Qxf7)', async () => {
    // Stockfish is an optional user-side download (scripts/download-stockfish.mjs):
    // run this test only when the engine is present; otherwise skip (graceful degradation).
    const enginePath = path.resolve(__dirname, '../../../resources/engine/stockfish.wasm.js');
    if (!fs.existsSync(enginePath)) return;
    const mod = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/services/ChessEngineService.js')).href);
    const svc = new mod.ChessEngineService();
    try {
      const res = await svc.getBestMove(
        'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 3 3',
        { timeoutMs: 12000 },
      );
      assert.equal(res.uci, 'h5f7');
    } finally {
      await svc.dispose();
    }
  });

  test('rejects illegal FEN without starting the engine', async () => {
    const mod = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/services/ChessEngineService.js')).href);
    const svc = new mod.ChessEngineService();
    try {
      await assert.rejects(() => svc.getBestMove('8/8/8/8/8/8/8/8 w - - 0 1'), /legal|king/i);
    } finally {
      await svc.dispose();
    }
  });
});

describe('chessCoachService', () => {
  test('happy path returns verified move with explanation', async () => {
    const mod = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/services/ChessCoachService.js')).href);
    const svc = new mod.ChessCoachService({
      extract: async () => ({ fen: 'startpos-fen', turn: 'w' }),
      engine: { getBestMove: async () => ({ from: 'g1', to: 'f3', uci: 'g1f3', evalCp: 40 }) },
      explain: async () => 'Develops the knight and controls the center.',
    });
    const res = await svc.analyze('aGVsbG8=');
    assert.equal(res.verified, true);
    assert.equal(res.uci, 'g1f3');
    assert.match(res.explanation, /knight/i);
  });

  test('oversize image rejected before any work', async () => {
    const mod = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/services/ChessCoachService.js')).href);
    let calls = 0;
    const svc = new mod.ChessCoachService({
      extract: async () => { calls += 1; return { fen: 'x', turn: 'w' }; },
      engine: { getBestMove: async () => ({ from: 'a', to: 'b', uci: 'ab', evalCp: null }) },
      explain: async () => 'x',
    });
    await assert.rejects(() => svc.analyze('x'.repeat(16 * 1024 * 1024)), /15 MB/);
    assert.equal(calls, 0);
  });

  test('extractor failure falls back to unverified', async () => {
    const mod = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/services/ChessCoachService.js')).href);
    const svc = new mod.ChessCoachService({
      extract: async () => { throw new Error('bad screenshot'); },
      engine: { getBestMove: async () => { throw new Error('unreachable'); } },
      explain: async () => 'Could not read the board — try a tighter crop.',
    });
    const res = await svc.analyze('aGVsbG8=');
    assert.equal(res.verified, false);
  });

  test('engine failure falls back to unverified with position context', async () => {
    const mod = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/services/ChessCoachService.js')).href);
    let seenUci = 'unset';
    const svc = new mod.ChessCoachService({
      extract: async () => ({ fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 3 3', turn: 'w' }),
      engine: { getBestMove: async () => { throw new Error('engine timeout'); } },
      explain: async (args) => { seenUci = args.uci; return 'Engine unavailable — analyze this sharp line manually.'; },
    });
    const res = await svc.analyze('aGVsbG8=');
    assert.equal(res.verified, false);
    assert.equal(res.fen.startsWith('r1bqkbnr'), true);
    assert.equal(seenUci, '');
  });
});
