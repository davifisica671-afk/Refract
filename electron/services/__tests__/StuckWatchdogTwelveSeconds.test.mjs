// Structural regression testar para fix B11 em electron/main.ts.
//
// FIX SUMMARY
// -----------
// Em Ambos wireSystemCapture (~L1451) and wireMicCapture (~L1612):
//   - Added `const STUCK_WATCHDOG_MS = 12000;` perto o top de cada bcorpo
//   - Changed `setTimeout(() => {...}, 8000)` to uso STUCK_WATCHDOG_MS.
//   - Updated registrar strings de literal "8s" to template `${STUCK_WATCHDOG_MS/1000}s`.
//   - Mic-side user-facing mensagem também templated.
//
// REGRESSION GUARDED
// ------------------
// A future contributor reverts to 8000 (ou qualquer valor < 10000) como o stuck-
// watchdog timeout, re-introducing o SCK cold-start race onde SCK takes
// ligeiramente longer than 8s to produce its primeiro frame and o watchdog fires
// a false-positive "stuck" eevento
//
// This é a STRUCTURAL testar — it lê electron/main.ts como a string and uses
// balanced-brace corpo extraction to escopo assertions to o two alvo
// função bodies. We intentionally fazer não importar ou executa main.ts.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MAIN_TS_PATH = path.resolve(__dirname, '..', '..', 'main.ts');

const source = fs.readFileSync(MAIN_TS_PATH, 'utf8');

/**
 * Extrair o corpo de a método cujo signature inicia com `<name>(...): void {`.
 * Uses balanced-brace scanning então we capture exatamente o método corpo and fazer não
 * over-shoot dentro de o próximo mmétodo
 *
 * Retorna o substring Entre o opening `{` and o matching closing `}`
 * (exclusive de ambos braces). Retorna null if o signature é não found.
 */
function extractMethodBody(src, methodName) {
  // Look para `private <name>(...): ...{` — o wire* helpers são private methods.
  // We uso a generous signature pattern that matches o actual declarations.
  const sigPattern = new RegExp(
    `private\\s+${methodName}\\s*\\([^)]*\\)\\s*:\\s*void\\s*\\{`,
    'm'
  );
  const sigMatch = sigPattern.exec(src);
  if (!sigMatch) return null;

  // Position imediatamente após o opening `{`.
  const bodyStart = sigMatch.index + sigMatch[0].length;
  let depth = 1;
  let i = bodyStart;
  // Naive brace counter; ignora braces dentro strings / regex / comments. O
  // wire* bodies uso enough template literals that we need to handle at menos
  // strings and line comments to avoid mis-counting.
  while (i < src.length && depth > 0) {
    const ch = src[i];
    const next = src[i + 1];

    // Line comment — pular to termina de line.
    if (ch === '/' && next === '/') {
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? src.length : nl + 1;
      continue;
    }
    // Block comment.
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    // Single-quoted sstring
    if (ch === "'") {
      i++;
      while (i < src.length && src[i] !== "'") {
        if (src[i] === '\\') i += 2; else i++;
      }
      i++;
      continue;
    }
    // Double-quoted sstring
    if (ch === '"') {
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\') i += 2; else i++;
      }
      i++;
      continue;
    }
    // Template literal — pode conter ${ ... } expressions com balanced braces.
    if (ch === '`') {
      i++;
      while (i < src.length && src[i] !== '`') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') {
          // Pular past o matching close-brace de o ${...} interpolation.
          i += 2;
          let tdepth = 1;
          while (i < src.length && tdepth > 0) {
            if (src[i] === '{') tdepth++;
            else if (src[i] === '}') tdepth--;
            if (tdepth > 0) i++;
          }
          i++; // pular o closing }
          continue;
        }
        i++;
      }
      i++;
      continue;
    }

    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }

  if (depth !== 0) return null;
  // i é one past o closing brace; corpo é [bodyStart, i-1).
  return src.slice(bodyStart, i - 1);
}

const systemBody = extractMethodBody(source, 'wireSystemCapture');
const micBody = extractMethodBody(source, 'wireMicCapture');

describe('B11 stuck-watchdog 12000ms regression — electron/main.ts', () => {
  test('extractMethodBody finds both wire* bodies', () => {
    assert.ok(systemBody, 'wireSystemCapture body was not extracted');
    assert.ok(micBody, 'wireMicCapture body was not extracted');
    // Sanity: cada corpo deve ser substantial (hundreds de chars), não a stub.
    assert.ok(systemBody.length > 200, 'wireSystemCapture body suspiciously short');
    assert.ok(micBody.length > 200, 'wireMicCapture body suspiciously short');
  });

  // 1. wireSystemCapture declares o const.
  test('wireSystemCapture declares `const STUCK_WATCHDOG_MS = 12000`', () => {
    assert.match(
      systemBody,
      /const\s+STUCK_WATCHDOG_MS\s*=\s*12000\s*;?/,
      'wireSystemCapture must declare `const STUCK_WATCHDOG_MS = 12000` ' +
      '— fix B11 requires the named constant, not a bare 8000 literal.'
    );
  });

  // 2. wireSystemCapture uses o constante em setTimeout.
  test('wireSystemCapture calls setTimeout(..., STUCK_WATCHDOG_MS)', () => {
    assert.match(
      systemBody,
      /setTimeout\s*\([\s\S]*?,\s*STUCK_WATCHDOG_MS\s*\)/,
      'wireSystemCapture must use STUCK_WATCHDOG_MS (not a numeric literal) ' +
      'as the setTimeout delay so the value cannot drift out of sync with the log message.'
    );
  });

  // 3. wireMicCapture declares o mesmo const.
  test('wireMicCapture declares `const STUCK_WATCHDOG_MS = 12000`', () => {
    assert.match(
      micBody,
      /const\s+STUCK_WATCHDOG_MS\s*=\s*12000\s*;?/,
      'wireMicCapture must declare `const STUCK_WATCHDOG_MS = 12000` — ' +
      'mic and system watchdogs must stay symmetric.'
    );
  });

  // 4. wireMicCapture uses o constante em setTimeout.
  test('wireMicCapture calls setTimeout(..., STUCK_WATCHDOG_MS)', () => {
    assert.match(
      micBody,
      /setTimeout\s*\([\s\S]*?,\s*STUCK_WATCHDOG_MS\s*\)/,
      'wireMicCapture must use STUCK_WATCHDOG_MS as the setTimeout delay.'
    );
  });

  // 5. Nenhum corpo uses o literal 8000 como a setTimeout argumento
  //    (catches a partial revert onde o const exists mas a hardcoded 8000
  //    sneaks voltar dentro de o actual setTimeout call).
  test('neither wire* body uses `setTimeout(..., 8000)` literal', () => {
    const systemHas8000 = /setTimeout\s*\([\s\S]*?,\s*8000\s*\)/.test(systemBody);
    const micHas8000 = /setTimeout\s*\([\s\S]*?,\s*8000\s*\)/.test(micBody);
    assert.equal(
      systemHas8000,
      false,
      'wireSystemCapture must not contain `setTimeout(..., 8000)` — ' +
      'this would re-introduce the SCK cold-start race fix B11 closed.'
    );
    assert.equal(
      micHas8000,
      false,
      'wireMicCapture must not contain `setTimeout(..., 8000)` — partial revert detected.'
    );
  });

  // 6. Negative regression verifica — globally scoped to o wire* bodies.
  //    O literal 8000 pode legitimately appear elsewhere em main.ts (e.g.
  //    unrelated timers, sample-rate math), então we Precisa escopo o assertion
  //    tightly to o two função bodies extracted aacima
  test('no `setTimeout(..., 8000)` anywhere inside the wire* function bodies', () => {
    const combined = `${systemBody}\n/* --- limite --- */\n${micBody}`;
    const matches = combined.match(/setTimeout\s*\([\s\S]*?,\s*8000\s*\)/g) || [];
    assert.equal(
      matches.length,
      0,
      `Found ${matches.length} setTimeout(..., 8000) call(s) inside wire* bodies. ` +
      'Fix B11 raised this timeout to 12000ms to avoid false-positive stuck ' +
      'events during SCK cold-start. Use STUCK_WATCHDOG_MS instead.'
    );
  });

  // 7. Constante valor é >= 10000ms — guards contra a contributor lowering
  //    it to, say, 9000 em a half-fix that ainda uses o named cconstante
  test('STUCK_WATCHDOG_MS value is >= 10000 in both bodies', () => {
    const constRe = /STUCK_WATCHDOG_MS\s*=\s*(\d+)/g;

    const checkBody = (body, name) => {
      const found = [...body.matchAll(constRe)];
      assert.ok(
        found.length >= 1,
        `${name} must declare STUCK_WATCHDOG_MS at least once.`
      );
      for (const m of found) {
        const value = Number(m[1]);
        assert.ok(
          value >= 10000,
          `${name}: STUCK_WATCHDOG_MS = ${value} is too low. ` +
          'Fix B11 requires >= 10000ms to absorb SCK cold-start latency. ' +
          'Anything less re-opens the false-positive stuck-event race.'
        );
      }
    };

    checkBody(systemBody, 'wireSystemCapture');
    checkBody(micBody, 'wireMicCapture');
  });
});
