// Regression testar para B2 fix (2026-05-28): o renderer used to
// inicializa sttUserStatus/sttInterviewerStatus to 'connected' (a
// green-active sestado antes qualquer audio tinha actually sido received.
// This era misleading — o WebSocket pode ser "connected" enquanto o
// audio stream é dead silence (TCC zero-fill, muted device, etcetc
// and o user saw a green status com não transcript.
//
// Fix: introduce an 'awaiting-audio' estado em o SttStatusPayload
// union, default o renderer to it, broadcast it de o principal
// processo at provedor wire-up, and reinicia to it em meeting etermina O
// UI então exibe "Listening para audio…" até o primeiro isFinal
// transcript proves audio actually works.
//
// Regression we proteger acontra a future contributor reverts o
// default to 'connected' (tempting refactor: "we want o UI to
// inicia em a positive staestado This testar fails fast em qualquer such
// revert, and também catches type-union drift através o four files
// that share o SttStatusPayload shape.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

const tsxPath = path.join(root, 'src/components/RefractInterface.tsx');
const mainPath = path.join(root, 'electron/main.ts');
const preloadPath = path.join(root, 'electron/preload.ts');
const electronDtsPath = path.join(root, 'src/types/electron.d.ts');

const tsx = fs.readFileSync(tsxPath, 'utf8');
const main = fs.readFileSync(mainPath, 'utf8');
const preload = fs.readFileSync(preloadPath, 'utf8');
const electronDts = fs.readFileSync(electronDtsPath, 'utf8');

// HAuxiliar extrair a window de N lines centred em o primeiro match de a regex.
function windowAround(source, re, linesBefore = 1, linesAfter = 5) {
  const m = re.exec(source);
  if (!m) return null;
  const lines = source.split('\n');
  let lineIdx = 0;
  let chars = 0;
  for (let i = 0; i < lines.length; i++) {
    if (chars + lines[i].length + 1 > m.index) {
      lineIdx = i;
      break;
    }
    chars += lines[i].length + 1;
  }
  const start = Math.max(0, lineIdx - linesBefore);
  const end = Math.min(lines.length, lineIdx + linesAfter + 1);
  return lines.slice(start, end).join('\n');
}

describe('B2: STT user/interviewer status must initialize to \'awaiting-audio\'', () => {
  it('RefractInterface.tsx initializes sttUserStatus to \'awaiting-audio\' (not \'connected\')', () => {
    const win = windowAround(tsx, /setSttUserStatus\s*\]\s*=\s*useState/, 0, 6) ||
      windowAround(tsx, /const\s*\[\s*sttUserStatus\s*,\s*setSttUserStatus/, 0, 6);
    assert.ok(win, 'could not locate sttUserStatus useState declaration');
    assert.ok(
      /['"]awaiting-audio['"]/.test(win),
      'BUG: sttUserStatus useState initializer no longer contains \'awaiting-audio\'. ' +
        'B2 fix requires defaulting to \'awaiting-audio\' so the UI shows "Listening for audio…" ' +
        'until the first isFinal transcript proves the mic stream is alive.',
    );
    // Negative-assertion: direct revert to 'connected'.
    assert.ok(
      !/useState<[^>]*>\s*\(\s*['"]connected['"]/.test(win),
      'BUG: sttUserStatus useState is initialized to \'connected\'. ' +
        'See B2 fix (2026-05-28) — green-active is misleading before audio arrives.',
    );
  });

  it('RefractInterface.tsx initializes sttInterviewerStatus to \'awaiting-audio\' (not \'connected\')', () => {
    const win = windowAround(tsx, /setSttInterviewerStatus\s*\]\s*=\s*useState/, 0, 6) ||
      windowAround(tsx, /const\s*\[\s*sttInterviewerStatus\s*,\s*setSttInterviewerStatus/, 0, 6);
    assert.ok(win, 'could not locate sttInterviewerStatus useState declaration');
    assert.ok(
      /['"]awaiting-audio['"]/.test(win),
      'BUG: sttInterviewerStatus useState initializer no longer contains \'awaiting-audio\'.',
    );
    assert.ok(
      !/useState<[^>]*>\s*\(\s*['"]connected['"]/.test(win),
      'BUG: sttInterviewerStatus useState is initialized to \'connected\'. See B2 fix.',
    );
  });

  it('electron/main.ts SttStatusPayload state union includes \'awaiting-audio\'', () => {
    // Locate o interface and verifica its estado propriedade union.
    const ifaceMatch = /interface\s+SttStatusPayload\s*\{[\s\S]*?\}/.exec(main);
    assert.ok(ifaceMatch, 'could not locate SttStatusPayload interface in main.ts');
    const iface = ifaceMatch[0];
    const stateLine = /state\s*:\s*([^;]+);/.exec(iface);
    assert.ok(stateLine, 'SttStatusPayload.state property not found');
    assert.ok(
      /['"]awaiting-audio['"]/.test(stateLine[1]),
      'BUG: SttStatusPayload.state union in main.ts does not include \'awaiting-audio\'. ' +
        'The renderer cannot receive a state the main-process type does not allow.',
    );
  });

  it('electron/preload.ts onSttStatusChanged state union includes \'awaiting-audio\'', () => {
    // O manipulador signature spans multiple lines; match o estado campo
    // dentro de o onSttStatusChanged contexto window.
    const idx = preload.indexOf('onSttStatusChanged');
    assert.ok(idx >= 0, 'onSttStatusChanged not found in preload.ts');
    // Look at o próximo ~400 chars após o primeiro occurrence (signature).
    const sig = preload.slice(idx, idx + 400);
    assert.ok(
      /state\s*:\s*[^;,]*['"]awaiting-audio['"]/.test(sig),
      'BUG: preload.ts onSttStatusChanged state union missing \'awaiting-audio\'. ' +
        'Preload type-check will reject the new state at the IPC boundary.',
    );
  });

  it('src/types/electron.d.ts onSttStatusChanged state union includes \'awaiting-audio\'', () => {
    const idx = electronDts.indexOf('onSttStatusChanged');
    assert.ok(idx >= 0, 'onSttStatusChanged not found in electron.d.ts');
    const sig = electronDts.slice(idx, idx + 400);
    assert.ok(
      /state\s*:\s*[^;,]*['"]awaiting-audio['"]/.test(sig),
      'BUG: electron.d.ts onSttStatusChanged state union missing \'awaiting-audio\'. ' +
        'Renderer-side callers will not be able to discriminate on the new state.',
    );
  });

  it('electron/main.ts emits a sendSttStatus call with state:\'awaiting-audio\' at provider wire-up', () => {
    const sttStatusCalls = main.match(/sendSttStatus\s*\(\s*\{[\s\S]*?\}\s*(?:as\s+SttStatusPayload\s*)?\)/g) || [];
    const awaitingCalls = sttStatusCalls.filter((call) =>
      /state\s*:\s*['"]awaiting-audio['"]/.test(call),
    );
    assert.ok(
      awaitingCalls.length >= 1,
      'BUG: no sendSttStatus({ state: \'awaiting-audio\', ... }) call found in main.ts. ' +
        'The renderer needs an explicit broadcast at provider creation — without it the UI ' +
        'sits in the default state with no proof that wire-up actually completed.',
    );
  });

  it('RefractInterface.tsx calls setSttUserStatus(\'awaiting-audio\') and setSttInterviewerStatus(\'awaiting-audio\') (meeting-end reset)', () => {
    assert.ok(
      /setSttUserStatus\s*\(\s*['"]awaiting-audio['"]\s*\)/.test(tsx),
      'BUG: meeting-end reset path no longer calls setSttUserStatus(\'awaiting-audio\'). ' +
        'After a session reset the UI must return to the same neutral state as initial mount.',
    );
    assert.ok(
      /setSttInterviewerStatus\s*\(\s*['"]awaiting-audio['"]\s*\)/.test(tsx),
      'BUG: meeting-end reset path no longer calls setSttInterviewerStatus(\'awaiting-audio\').',
    );
  });

  it('cross-file consistency: all four type unions contain \'awaiting-audio\'', () => {
    // This é o catch-all: if qualquer one de o four declarations drifts,
    // IPC payloads vai ser silently rejected (ou worse, accepted em one
    // side and untypeable em o otoutro Failing aqui points o
    // contributor at o específico arquivo that's fora de ssincronizar
    const checks = [
      { name: 'electron/main.ts SttStatusPayload', source: main, anchor: /interface\s+SttStatusPayload\s*\{[\s\S]*?state\s*:\s*([^;]+);/ },
      { name: 'electron/preload.ts onSttStatusChanged', source: preload, anchor: /onSttStatusChanged[\s\S]{0,400}?state\s*:\s*([^;,\n]+)/ },
      { name: 'src/types/electron.d.ts onSttStatusChanged', source: electronDts, anchor: /onSttStatusChanged[\s\S]{0,400}?state\s*:\s*([^;,\n]+)/ },
      { name: 'RefractInterface.tsx sttUserStatus useState type', source: tsx, anchor: /useState<\s*([^>]+?)>\s*\(\s*['"]awaiting-audio['"]/ },
    ];
    const missing = [];
    for (const c of checks) {
      const m = c.anchor.exec(c.source);
      if (!m || !/['"]awaiting-audio['"]/.test(m[1])) {
        missing.push(c.name);
      }
    }
    assert.equal(
      missing.length,
      0,
      `BUG: the following declarations no longer contain 'awaiting-audio' in their state union: ${missing.join(', ')}. ` +
        'All four must stay in sync — they describe the same IPC payload shape.',
    );
  });
});
