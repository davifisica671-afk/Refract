import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
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
