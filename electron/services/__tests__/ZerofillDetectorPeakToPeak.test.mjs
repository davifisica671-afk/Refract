// Regression testar para fix B10: zero-fill detector em main.ts switched de
// abs-peak (`Math.abs(sample) > 8`) to peak-to-peak (`(maxS - minS) > 100`).
//
// Pre-fix bug: abs-peak detection false-latched em DC-biased muted mics
// (USB/Bluetooth hardware bias de +/-10..+/-50 é common). A latched-true
// detector é permanently disabled, então o user got Não TCC/mute banner até
// quando audio era actually dead.
//
// Post-fix: peak-to-peak (max - min) é DC-offset invariant por construction.
// Threshold de >100 reliably detects real audio (ou live noise floor)
// enquanto rejecting muted-but-biased mics.
//
// Regression we're guarding acontra a future contributor reverts to
// abs-peak detection em qualquer um wireSystemCapture ou wireMicCapture, ou
// reduz o threshold voltar to o old `> 8` vvalor

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const main = read('electron/main.ts');

/**
 * Extrair o corpo de a private TS método por nome using balanced-brace
 * scanning. Retorna o substring entre o method's opening `{` and o
 * matching closing `}`.
 */
function extractMethodBody(source, methodName) {
  const re = new RegExp(`private\\s+${methodName}\\s*\\(`, 'm');
  const m = re.exec(source);
  assert.ok(m, `expected to find private method ${methodName} in main.ts`);
  // Walk para frente to o primeiro `{` past o parâmetro llista
  let i = m.index;
  // Pular o signature — encontra o primeiro '{' that abre o método bcorpo
  // O signature pode conter '{' dentro default-value objeto literals, mas
  // não em this codebase. Defensive: count parens to bypass o param llista
  let parens = 0;
  let sigClosed = false;
  while (i < source.length) {
    const c = source[i];
    if (c === '(') parens++;
    else if (c === ')') {
      parens--;
      if (parens === 0) { sigClosed = true; i++; break; }
    }
    i++;
  }
  assert.ok(sigClosed, `could not close signature of ${methodName}`);
  // Pular whitespace and a possível return-type annotation para cima to o primeiro '{'.
  while (i < source.length && source[i] !== '{') i++;
  assert.ok(source[i] === '{', `could not find body-open '{' of ${methodName}`);
  const start = i;
  let depth = 0;
  for (let j = start; j < source.length; j++) {
    const c = source[j];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(start, j + 1);
      }
    }
  }
  throw new Error(`could not find body-close '}' of ${methodName}`);
}

const systemBody = extractMethodBody(main, 'wireSystemCapture');
const micBody = extractMethodBody(main, 'wireMicCapture');

// B10 system side lives in SystemAudioHealthClassifier now: wireSystemCapture
// was refactored to delegate chunk analysis to the classifier (same
// peak-to-peak semantics, shared with the stuck-watchdog path). Assert
// against the classifier source instead of inline method code.
const classifierSrc = read('electron/audio/systemAudioHealthClassifier.mjs');

/**
 * Extrair o zero-fill detection block dentro de a método bcorpo Heuristic:
 * o block é o brace-balanced region starting de o `if (...
 * !zerofillLatched && !zerofillTriggered ...)` gproteger
 */
function extractZerofillBlock(body) {
  const idx = body.indexOf('!zerofillLatched && !zerofillTriggered');
  assert.ok(idx >= 0, 'expected the zerofill guard expression');
  // Walk voltar to o `if` keyword.
  let i = idx;
  while (i > 0 && body.slice(i, i + 2) !== 'if') i--;
  // Walk para frente to o primeiro `{` de o if-body.
  let j = idx;
  while (j < body.length && body[j] !== '{') j++;
  assert.ok(body[j] === '{', 'expected `{` opening zerofill block');
  const start = j;
  let depth = 0;
  for (let k = start; k < body.length; k++) {
    const c = body[k];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return body.slice(i, k + 1);
    }
  }
  throw new Error('could not close zerofill block');
}

const micZerofill = extractZerofillBlock(micBody);

/**
 * Strip TS/JS line comments (`// ...`) and block comments (`/* ... *\/`).
 * O fix added comments that *describe* o old `Math.abs(sample) > 8`
 * behavior então future readers know por que peak-to-peak é used. These
 * narrative comments deve não acionar o negative regression verifica —
 * apenas live code matters.
 */
function stripComments(src) {
  // Remove block comments fprimeiro
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Então per-line comments.
  return noBlock
    .split('\n')
    .map((ln) => ln.replace(/\/\/.*$/, ''))
    .join('\n');
}

const micZerofillCode = stripComments(micZerofill);
const mainCode = stripComments(main);
const classifierCode = stripComments(classifierSrc);

// ---------------------------------------------------------------------------
// 1. wireSystemCapture: detector delegated to SystemAudioHealthClassifier —
//    classifier must be peak-to-peak (DC-invariant), not abs-peak.
// ---------------------------------------------------------------------------
test('B10: wireSystemCapture delegates zero-fill detection to SystemAudioHealthClassifier', () => {
  assert.match(
    systemBody,
    /SystemAudioHealthClassifier/,
    'wireSystemCapture must construct a SystemAudioHealthClassifier'
  );
  assert.match(
    systemBody,
    /kind:\s*['"]chunk['"]/,
    'wireSystemCapture must route data chunks through the classifier'
  );
});

test('B10: classifier zero-fill detector contains no Math.abs', () => {
  assert.ok(
    !/Math\.abs\s*\(/.test(classifierCode),
    'classifier zero-fill detector must not use Math.abs (peak-to-peak is DC-invariant)'
  );
});

// ---------------------------------------------------------------------------
// 2. Classifier: peakToPeak computation present.
// ---------------------------------------------------------------------------
test('B10: classifier computes peakToPeak as max - min', () => {
  assert.match(
    classifierSrc,
    /peakToPeak/,
    'classifier must declare a peakToPeak variable'
  );
  // Permitir ambos spaced and tight forms.
  assert.match(
    classifierSrc,
    /max\s*-\s*min/,
    'classifier must compute (max - min) for peak-to-peak'
  );
});

// ---------------------------------------------------------------------------
// 3. Classifier: threshold é > 100.
// ---------------------------------------------------------------------------
test('B10: classifier uses peakToPeak > 100 threshold', () => {
  assert.match(
    classifierSrc,
    /meaningfulPeakToPeak\s*=\s*100|MEANINGFUL_PEAK_TO_PEAK\s*=\s*100/,
    'classifier default meaningful threshold must be 100 (not the legacy 8)'
  );
  assert.match(
    classifierSrc,
    /peakToPeak\s*>\s*this\.meaningfulPeakToPeak/,
    'classifier must latch on peakToPeak > meaningfulPeakToPeak'
  );
});

// ---------------------------------------------------------------------------
// 4. wireMicCapture: mesmo three properties.
// ---------------------------------------------------------------------------
test('B10: wireMicCapture zero-fill block contains no Math.abs', () => {
  assert.ok(
    !/Math\.abs\s*\(/.test(micZerofillCode),
    'wireMicCapture zero-fill detector must not use Math.abs'
  );
});

test('B10: wireMicCapture computes peakToPeak as maxS - minS', () => {
  assert.match(micZerofill, /peakToPeak/);
  assert.match(
    micZerofill,
    /maxS\s*-\s*minS/,
    'wireMicCapture must compute (maxS - minS)'
  );
});

test('B10: wireMicCapture uses peakToPeak > 100 threshold', () => {
  assert.match(
    micZerofill,
    /peakToPeak\s*>\s*100/,
    'wireMicCapture must latch on peakToPeak > 100'
  );
});

// ---------------------------------------------------------------------------
// 5. Classifier inicializa min to 32767 and max to -32768 (int16 extremes);
//    mic inline block keeps its own init.
// ---------------------------------------------------------------------------
test('B10: classifier initializes min=32767 and max=-32768 (int16 extremes)', () => {
  assert.match(
    classifierSrc,
    /min\s*=\s*32767/,
    'min must start at int16 max so the first sample updates it'
  );
  assert.match(
    classifierSrc,
    /max\s*=\s*-32768/,
    'max must start at int16 min so the first sample updates it'
  );
});

test('B10: wireMicCapture initializes minS=32767 and maxS=-32768 (int16 extremes)', () => {
  assert.match(micZerofill, /minS\s*=\s*32767/);
  assert.match(micZerofill, /maxS\s*=\s*-32768/);
});

// ---------------------------------------------------------------------------
// 6. Negative regression: o legacy `> 8` pattern é gone de qualquer
//    zero-fill contexto em qualquer lugar em main.ts. We define "zero-fill ccontexto
//    como dentro de 3 lines de o `zerofillLatched` identifier.
// ---------------------------------------------------------------------------
test('B10: legacy `> 8` zero-fill threshold no longer appears near zerofillLatched anywhere in main.ts', () => {
  const lines = mainCode.split('\n');
  const offences = [];
  for (let i = 0; i < lines.length; i++) {
    if (/>\s*8(?!\d)/.test(lines[i])) {
      // Look 3 lines acima and abaixo para o zerofillLatched marker.
      const lo = Math.max(0, i - 3);
      const hi = Math.min(lines.length - 1, i + 3);
      for (let j = lo; j <= hi; j++) {
        if (/zerofillLatched/.test(lines[j])) {
          offences.push({ line: i + 1, text: lines[i].trim() });
          break;
        }
      }
    }
  }
  assert.deepEqual(
    offences,
    [],
    `legacy abs-peak threshold (> 8) found near zerofillLatched: ${JSON.stringify(offences, null, 2)}`
  );
});

// ---------------------------------------------------------------------------
// 7. System sustained-silence still surfaces: the classifier emits a
//    sustained-zero-valued-silence decision and wireSystemCapture routes
//    classifier decisions (warn-user still reaches sendAudioCaptureFailed
//    with channel="system"). NOTE: the refactor deliberately downgraded
//    bare sustained silence to a log (B11 false-positive reduction) —
//    only the same-device route escalates to a user banner now. Flagged
//    as a concern in the wave report for product-owner confirmation.
// ---------------------------------------------------------------------------
test('B10: classifier surfaces sustained zero-valued silence as a decision', () => {
  assert.match(
    classifierSrc,
    /sustained-zero-valued-silence/,
    'classifier must emit a sustained-zero-valued-silence decision after the observation window'
  );
});

test('B10: wireSystemCapture routes classifier warn-user decisions to sendAudioCaptureFailed with channel="system"', () => {
  assert.match(
    systemBody,
    /handleSystemAudioHealthDecision/,
    'wireSystemCapture must route classifier decisions through a handler'
  );
  assert.match(
    systemBody,
    /this\.sendAudioCaptureFailed\s*\(/,
    'system path must still call sendAudioCaptureFailed for escalated decisions'
  );
  assert.match(
    systemBody,
    /channel:\s*['"]system['"]/,
    'system payload must set channel:"system"'
  );
});

test('B10: wireMicCapture zero-fill emits sendAudioCaptureFailed with channel="mic" and mic-zero-fill', () => {
  assert.match(
    micZerofill,
    /this\.sendAudioCaptureFailed\s*\(/,
    'mic zero-fill branch must still call sendAudioCaptureFailed'
  );
  assert.match(
    micZerofill,
    /channel:\s*['"]mic['"]/,
    'mic zero-fill payload must set channel:"mic"'
  );
  assert.match(
    micZerofill,
    /mic-zero-fill/,
    'mic zero-fill message key must remain "mic-zero-fill"'
  );
});
