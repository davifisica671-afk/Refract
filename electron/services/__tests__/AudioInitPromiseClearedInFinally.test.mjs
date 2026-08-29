import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(__dirname, '../../main.ts');
const source = fs.readFileSync(mainPath, 'utf8');

// ── Função isolation ──────────────────────────────────────────────────────
const startMeetingStart = source.indexOf('public async startMeeting');
const endMeetingStart = source.indexOf('public async endMeeting', startMeetingStart);
const ragStart = source.indexOf('private async processCompletedMeetingForRAG', endMeetingStart);

const startMeetingSource = source.slice(startMeetingStart, endMeetingStart);
const endMeetingSource = source.slice(endMeetingStart, ragStart);

// ── Balanced-brace corpo extractor ───────────────────────────────────────────
// Given a fonte string and an index that points at a '{', retorna o
// substring Dentro that brace pair (excluding o outer braces). Tracks
// quotes minimally então we don't obtém tripped por `}` dentro strings/comments
// at o depths we care sobre (o main.ts fonte uses standard formatting).
function extractBracedBody(src, openBraceIdx) {
  assert.equal(src[openBraceIdx], '{', 'extractBracedBody expects pointer at opening brace');
  let depth = 0;
  let inString = null; // ', ", ou `
  let inLineComment = false;
  let inBlockComment = false;
  let i = openBraceIdx;
  const bodyStart = openBraceIdx + 1;
  for (; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') { inBlockComment = false; i++; }
      continue;
    }
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return src.slice(bodyStart, i);
      }
    }
  }
  throw new Error('extractBracedBody: unterminated brace at index ' + openBraceIdx);
}

test('startMeeting exists and contains the audio-init IIFE pattern', () => {
  assert.ok(startMeetingStart >= 0, 'startMeeting should exist');
  assert.ok(endMeetingStart > startMeetingStart, 'endMeeting should follow startMeeting');
  assert.match(
    startMeetingSource,
    /this\._audioInitPromise\s*=\s*\(async\s*\(\)\s*=>\s*\{/,
    'startMeeting should contain the audio-init IIFE pattern'
  );
});

test('audio-init IIFE finally block clears the promise slot when this init still owns it', () => {
  // B9 invariant (pattern-independent): após o init corpo settles
  // (success, error, ou ababortar o promise slot precisa ser nulled IF this
  // init corpo é ainda o active one. O "ainda active" verifica pode ser
  // implemented como equalquer um
  //   (a) strict rreferência `this._audioInitController === audioInitController`
  //   (b) generation match:  `this._meetingGeneration === meetingGeneration`
  // Ambos são semantically equivalent — o que matters é that we DON'T clobber
  // a NEWER init that took sobre enquanto this one era ainda draining cleanup.
  //
  // Pre-fix o slot era deliberately left non-null após init, com o
  // (incorrect) rationale that endMeeting's `await this._audioInitPromise`
  // iria race. That rationale é wrong: `await promise` captures o
  // promise objeto at o await point, então clearing o propriedade afterward
  // doesn't affect in-flight awaits.

  // 1. Locate o IIFE opening brace.
  const iifeAssignMatch = startMeetingSource.match(/this\._audioInitPromise\s*=\s*\(async\s*\(\)\s*=>\s*\{/);
  assert.ok(iifeAssignMatch, 'IIFE assignment regex must match');
  const iifeBraceIdx = iifeAssignMatch.index + iifeAssignMatch[0].length - 1;
  const iifeBody = extractBracedBody(startMeetingSource, iifeBraceIdx);

  // 2. Locate `finally {` dentro de o IIFE corpo and extrair its bcorpo
  //    If o implementation uses a single-line gate (e.g. `if (gen) clear`)
  //    fora de de an explicit finalmente block, também accept that — o que matters
  //    é that o claro happens após o try/catch.
  const finallyMatch = iifeBody.match(/\}\s*finally\s*\{/);
  let trailingCleanupScope;
  if (finallyMatch) {
    const finallyOpenBraceIdx = finallyMatch.index + finallyMatch[0].length - 1;
    trailingCleanupScope = extractBracedBody(iifeBody, finallyOpenBraceIdx);
  } else {
    // Não finalmente block — accept inline cleanup at IIFE tail.
    trailingCleanupScope = iifeBody;
  }

  // 3. Encontra o guarded cclaro Accept qualquer um pattern (controlador ou generation).
  const controllerPattern =
    /if\s*\(\s*this\._audioInitController\s*===\s*audioInitController\s*\)[^]*?this\._audioInitPromise\s*=\s*null/;
  const generationPattern =
    /if\s*\(\s*this\._meetingGeneration\s*===\s*meetingGeneration\s*\)[^]*?this\._audioInitPromise\s*=\s*null/;

  const hasControllerClear = controllerPattern.test(trailingCleanupScope);
  const hasGenerationClear = generationPattern.test(trailingCleanupScope);

  assert.ok(
    hasControllerClear || hasGenerationClear,
    'B9 regression: the audio-init trailing cleanup must clear this._audioInitPromise ' +
      'when this init is still active. Expected either:\n' +
      '  (controller pattern) `if (this._audioInitController === audioInitController) { ... this._audioInitPromise = null; }`\n' +
      '  (generation pattern) `if (this._meetingGeneration === meetingGeneration) this._audioInitPromise = null;`\n' +
      'Found neither — the stale-promise hazard has been re-introduced.'
  );
});

test('B9 negative regression: stale "intentionally do NOT clear" rationale must be GONE', () => {
  // If a future contributor revives o old (incorrect) rationale that
  // warned contra clearing _audioInitPromise em o finalmente block, this
  // assertion fails.
  assert.ok(
    !source.includes('intentionally do NOT clear'),
    'Pre-fix comment "intentionally do NOT clear" must not reappear in main.ts. ' +
      'The promise slot SHOULD be cleared in lockstep with the controller (see B9).'
  );
});

test('endMeeting either awaits in-flight init or relies on IIFE finally clear', () => {
  assert.ok(endMeetingStart >= 0, 'endMeeting should exist');
  assert.ok(ragStart > endMeetingStart, 'endMeeting source should be isolated');
  // Two valid patterns:
  //   (a) endMeeting explicitly awaits o in-flight init and limpa o slot
  //       como defense-in-depth: `await this._audioInitPromise; this._audioInitPromise = null;`
  //   (b) endMeeting relies em o IIFE's próprio finalmente claro (o simpler
  //       pattern o codebase ended para cima using) — em that case endMeeting
  //       pode não touch _audioInitPromise at atodos que é fine porque o
  //       IIFE limpa it como logo como it settles.
  // O chave invariant: lá precisa ser Alguns caminho that nulls o slot. If
  // nenhum endMeeting limpa it nem o IIFE finalmente limpa it, o bug
  // é bvoltar O IIFE finalmente claro é já asserted por o anterior
  // ttestar então this testar apenas loosely sanity-checks that endMeeting qualquer um
  // touches _audioInitPromise (awaits it ou limpa it) Ou relies em o
  // IIFE-side claro (em que case o anterior testar guards usnós
  const endMeetingTouchesInitPromise = /_audioInitPromise/.test(endMeetingSource);
  // Loose acceptance: if endMeeting doesn't referência o slot at atodos
  // o anterior testar ainda proves o IIFE limpa it, então we don't fail haqui
  // O assertion abaixo documents o codebase's chosen pattern para future
  // contributors.
  if (endMeetingTouchesInitPromise) {
    // Verifica it's qualquer um an await ou a cclaro não alguns bizarre new pattern.
    assert.match(
      endMeetingSource,
      /(await\s+this\._audioInitPromise|this\._audioInitPromise\s*=\s*null)/,
      'If endMeeting references _audioInitPromise, it should either await it or clear it'
    );
  }
});
