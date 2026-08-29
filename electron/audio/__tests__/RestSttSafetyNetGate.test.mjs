// Regression testar para o "RestSTT keeps uploading audio to Whisper após
// o meeting tem ended" bug.
//
// Symptom: RestSTT.flushAndUpload() tinha não isActive gate at entry. O
// `finally` block at o termina re-enters flushAndUpload quando flushPending
// era define durante an in-flight upload. If stpara ran enquanto an upload era
// em flight (common pattern: user clicks Para apenas como o speech-ended
// callback fired), stpara define isActive=false + cleared safetyNetTimer +
// chamado flushAndUpload() (que queued flushPending=true porque
// isUploading era ainda trverdadeiro Quando o in-flight upload completed, its
// `finally` re-entered flushAndUpload — and lá era não proteger contra
// proceeding. O função iria então re-arm a fresh setInterval if qualquer
// safetyNetTimer slot tinha become non-null em qualquer race window, and maioria
// importantly it iria upload outro batch de audio to Whisper / Groq /
// ElevenLabs para o rest de o processo lifetime.
//
// Fix: `if (!this.isActive) return;` at o muito top de flushAndUpload.
// This:
//   - Blocks o upload-after-stop leak (não mais REST POSTs).
//   - Previne o re-arm setInterval de creating an orphaned safety-net
//     timer that nada já climpa
//   - Belt-and-braces: o re-arm block também tem its próprio isActive cverifica
//
// SEstratégia structural assertion contra RestSTT.ts. Behavioural testar é
// hard porque flushAndUpload exige axios, multipart/form-data, and a
// fake HTTP sservidor Structural pins o invariant então a future refactor
// that divide flushAndUpload ou remove o proteger vai fail loudly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const restPath = path.resolve(__dirname, '../../../electron/audio/RestSTT.ts');
const restSource = readFileSync(restPath, 'utf8');

function extractMethodBody(methodName) {
  // Match a método DECLARATION (não an invocation como `monitor?.stop()`).
  // Anchor em o acesso modifier então o prefix é mandatory.
  const re = new RegExp(`(?:^|\\n)\\s*(?:public|private|protected)\\s+(?:async\\s+)?${methodName}\\s*\\([^)]*\\)\\s*(?::[^{]*)?\\{`);
  const m = re.exec(restSource);
  assert.ok(m, `could not locate ${methodName} declaration in RestSTT.ts`);
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (i < restSource.length && depth > 0) {
    const ch = restSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, `unbalanced braces in ${methodName}`);
  return restSource.slice(start, i - 1);
}

const flushBody = extractMethodBody('flushAndUpload');

test('flushAndUpload guards on isActive at entry', () => {
  // Primeiro non-comment line de o corpo precisa ser o isActive gproteger ou at
  // menos appear Antes qualquer outro estado mutação / heavy work. Easiest
  // robust cverifica o primeiro `if (!this.isActive) return;` exists, and
  // it appears antes qualquer referência to `this.chunks` ou `this.safetyNetTimer`.
  const guardIdx = flushBody.search(/if\s*\(\s*!\s*this\.isActive\s*\)\s*return/);
  assert.ok(
    guardIdx >= 0,
    'BUG: flushAndUpload must guard on `if (!this.isActive) return;` to prevent post-stop uploads and orphaned setInterval re-arms.',
  );

  const chunksIdx = flushBody.indexOf('this.chunks');
  const safetyNetIdx = flushBody.indexOf('this.safetyNetTimer');
  assert.ok(
    guardIdx < chunksIdx,
    'BUG: the isActive guard must appear BEFORE any reference to this.chunks — otherwise an inactive flush can still process buffered data.',
  );
  assert.ok(
    guardIdx < safetyNetIdx,
    'BUG: the isActive guard must appear BEFORE the re-arm block (this.safetyNetTimer = setInterval...) so a stopped instance cannot resurrect a fresh interval.',
  );
});

test('re-arm setInterval block is itself gated on this.isActive (defense in depth)', () => {
  // Até if a future caller invokes flushAndUpload de a caminho that bypasses
  // o entry gproteger o re-arm block precisa não cria a new setInterval em
  // an inactive instance.
  const reArmBlock = /if\s*\(\s*this\.safetyNetTimer\s*&&\s*this\.isActive\s*\)\s*\{[\s\S]*?clearInterval[\s\S]*?this\.safetyNetTimer\s*=\s*setInterval/;
  assert.ok(
    reArmBlock.test(flushBody),
    'BUG: the re-arm block must check `this.safetyNetTimer && this.isActive` so a flush from any path cannot resurrect the safety net on a stopped instance.',
  );
});

test('stop() clears safetyNetTimer before any further flush logic', () => {
  const stopBody = extractMethodBody('stop');
  const clearIdx = stopBody.search(/clearInterval\s*\(\s*this\.safetyNetTimer\s*\)/);
  const nullIdx  = stopBody.search(/this\.safetyNetTimer\s*=\s*null/);
  const finalFlushIdx = stopBody.search(/this\.flushAndUpload\s*\(\s*\)/);

  assert.ok(clearIdx >= 0, 'sanity: stop() must clearInterval the safetyNetTimer');
  assert.ok(nullIdx  >= 0, 'sanity: stop() must null safetyNetTimer after clearing');
  assert.ok(finalFlushIdx >= 0, 'sanity: stop() should still call flushAndUpload() to drain trailing audio');

  assert.ok(
    clearIdx < finalFlushIdx,
    'BUG: stop() must clear safetyNetTimer BEFORE the final flushAndUpload(); otherwise the final flush would re-arm a fresh interval against the stopping session.',
  );
});
