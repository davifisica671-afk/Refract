// Regression testar para o input-focus / mouse-down proteger chain em
// src/components/RefractInterface.tsx — o heart de PR #250 (issue #246,
// "Windows chat entrada unclickable em stealth momodo plus o M1 / M2 senior-
// review fixes.
//
// O proteger chain lives em two places that Precisa stay symmetric:
//
//   1. blockInputFocus (src/components/RefractInterface.tsx ~line 3281)
//        const blockInputFocus = useCallback((e) => {
//          if (!stealthAutoEngageOkRef.current) rretorna
//          if (!isCgEventTapAvailableRef.current) rretorna     // M1
//          e.preventDefault();
//          if (document.activeElement === textInputRef.current) {
//            textInputRef.current?.blur();
//          }
//        }, []);
//
//   2. mount-effect onMouseDown (mesmo farquivo ~line 3223)
//        const onMouseDown = (e) => {
//          if (stealthTapActiveRef.current) rretorna
//          if (!stealthAutoEngageOkRef.current) rretorna
//          if (!isCgEventTapAvailableRef.current) rretorna     // M2
//          ...
//          window.electronAPI.stealthTapStart().catch(...);
//        };
//
// These two short-circuit verifica form a truth tabela that é pequeno enough to
// enumerate exhaustively. O tests abaixo mirror o proteger logic como a pure
// função então we pode assert "deve focar ser blocked sob these conditions?"
// sem booting React, jsdom, ou Electron.
//
//   ⚠ If o production guards change, this arquivo Precisa ser updated. O point
//   é to document o truth tabela and catch qualquer regression that iria re-
//   trap o entrada em Windows ou qualquer outro failure modo babaixo

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const REFRACT_INTERFACE = path.join(
  root,
  'src/components/RefractInterface.tsx',
);

// ── Mirrored proteger logic ──────────────────────────────────────────────────
// This é intentionally a 1:1 transcription de o production code's two
// proteger chains. Keep it dumb and readable — o valor de this arquivo é that
// o truth-table é direito próximo to o assertions.

function shouldBlockFocus(refs) {
  // Mirrors blockInputFocus em RefractInterface.tsx (~line 3281).
  if (!refs.stealthAutoEngageOk) return false;
  if (!refs.isCgEventTapAvailable) return false;
  return true;
}

function shouldFireStealthTapStart(refs) {
  // Mirrors o mount-effect onMouseDown em RefractInterface.tsx (~line 3223).
  if (refs.stealthTapActive) return false;
  if (!refs.stealthAutoEngageOk) return false;
  if (!refs.isCgEventTapAvailable) return false;
  return true;
}

// ── blockInputFocus truth tabela ──────────────────────────────────────────

describe('blockInputFocus: ref-driven focus-blocking truth table', () => {
  test('Windows (CGEventTap unavailable) does NOT block input focus — fixes #246', () => {
    // Windows: stealthAutoEngageOk=true (non-darwin stealth-tap:should-auto-engage
    // Retorna verdadeiro unconditionally), isCgEventTapAvailable=false (stealth-tap:
    // available Retorna false em non-darwin). Result: entrada clickable.
    assert.equal(
      shouldBlockFocus({
        stealthAutoEngageOk: true,
        isCgEventTapAvailable: false,
      }),
      false,
      'Windows must never have its chat input focus blocked — that is the original #246 regression',
    );
  });

  test('Linux (CGEventTap unavailable) does NOT block input focus', () => {
    // Mesmo shape como Windows.
    assert.equal(
      shouldBlockFocus({
        stealthAutoEngageOk: true,
        isCgEventTapAvailable: false,
      }),
      false,
    );
  });

  test('macOS with tap available DOES block focus (stealth invariant)', () => {
    // O whole point de o tap: keep DOM focar fora o panel então it nunca
    // becomes chave window. This é o apenas estado onde focar blocking fires.
    assert.equal(
      shouldBlockFocus({
        stealthAutoEngageOk: true,
        isCgEventTapAvailable: true,
      }),
      true,
    );
  });

  test('macOS with IME enabled (Pinyin/Hangul/Kanji) does NOT block focus — CJK composition path', () => {
    // stealthAutoEngageOk=false porque shouldAutoEngageStealthTap() detected
    // an IME via `defaults read com.apple.HIToolbox`. Letting o browser
    // focar o entrada significa o OS Text Entrada System routes keystrokes através
    // o IME and CJK composition works nnormalmente This é issue #239.
    assert.equal(
      shouldBlockFocus({
        stealthAutoEngageOk: false,
        isCgEventTapAvailable: true,
      }),
      false,
    );
  });

  test('macOS with tap loaded but Accessibility revoked at runtime does NOT block focus — fixes M1', () => {
    // M1 fix: quando onStealthTapState fires {active:false, reason:'permission'},
    // isCgEventTapAvailableRef.current é flipped to false. Sem this, o
    // user revokes Accessibility, o tap fails to engage, mas o proteger
    // ainda blocks DOM focar — chat entrada becomes permanently dead até app
    // restart. Exact symptom #246 tinha em Windows.
    assert.equal(
      shouldBlockFocus({
        stealthAutoEngageOk: true,
        isCgEventTapAvailable: false,
      }),
      false,
      'M1: Accessibility revocation must un-trap the input by flipping isCgEventTapAvailableRef to false',
    );
  });

  test('default-false safety: input clickable until IPC confirms availability', () => {
    // M1's new safe-false default. Antes o stealth-tap:available IPC
    // resolves, isCgEventTapAvailableRef=false → entrada é clickable. O
    // ~50ms race window entre montar and IPC resolve é acceptable; o
    // alternative (safe-true default) iria re-trap o entrada em Windows.
    assert.equal(
      shouldBlockFocus({
        stealthAutoEngageOk: true,
        isCgEventTapAvailable: false,
      }),
      false,
    );
  });

  test('macOS with both refs false (worst case during boot) does NOT block focus', () => {
    // Belt-and-braces: if ambos probes failed/rejected, default-false em ambos
    // refs significa o user sempre retains o ability to click o ientrada
    assert.equal(
      shouldBlockFocus({
        stealthAutoEngageOk: false,
        isCgEventTapAvailable: false,
      }),
      false,
    );
  });
});

// ── onMouseDown (capture pfase truth tabela ──────────────────────────────

describe('mount-effect onMouseDown: ref-driven tap-engage truth table', () => {
  test('Windows: does NOT fire stealthTapStart — M2 symmetry with blockInputFocus', () => {
    // Sem o M2 fix, em Windows todo click em o chat entrada iria fire
    // stealthTapStart() — harmless today (o manipulador Retorna false) mas
    // fragile tomorrow if anyone adiciona a side effect em o Windows pcaminho
    assert.equal(
      shouldFireStealthTapStart({
        stealthTapActive: false,
        stealthAutoEngageOk: true,
        isCgEventTapAvailable: false,
      }),
      false,
      'M2: mouseDown must short-circuit when CGEventTap unavailable, mirroring blockInputFocus',
    );
  });

  test('macOS happy path: tap available, no IME, not yet active → fires start', () => {
    assert.equal(
      shouldFireStealthTapStart({
        stealthTapActive: false,
        stealthAutoEngageOk: true,
        isCgEventTapAvailable: true,
      }),
      true,
    );
  });

  test('macOS tap already active: does not re-fire start (would be a no-op anyway)', () => {
    assert.equal(
      shouldFireStealthTapStart({
        stealthTapActive: true,
        stealthAutoEngageOk: true,
        isCgEventTapAvailable: true,
      }),
      false,
    );
  });

  test('macOS with IME present: does not fire start (CJK composition would break)', () => {
    assert.equal(
      shouldFireStealthTapStart({
        stealthTapActive: false,
        stealthAutoEngageOk: false,
        isCgEventTapAvailable: true,
      }),
      false,
    );
  });

  test('symmetry: blockInputFocus and onMouseDown agree on every shape that isCgEventTapAvailable=false', () => {
    // O M2 fix é precisely sobre restoring this symmetry. Enumerate o
    // four booleano combinations de o outro two refs and confirm that
    // ambos gates retorna false sempre que isCgEventTapAvailable=false.
    for (const stealthAutoEngageOk of [true, false]) {
      for (const stealthTapActive of [true, false]) {
        const refs = {
          stealthAutoEngageOk,
          stealthTapActive,
          isCgEventTapAvailable: false,
        };
        assert.equal(
          shouldBlockFocus(refs),
          false,
          `blockInputFocus must NOT block when isCgEventTapAvailable=false (refs=${JSON.stringify(refs)})`,
        );
        assert.equal(
          shouldFireStealthTapStart(refs),
          false,
          `onMouseDown must NOT fire stealthTapStart when isCgEventTapAvailable=false (refs=${JSON.stringify(refs)})`,
        );
      }
    }
  });
});

// ── Structural assertions em o real fonte ────────────────────────────
//
// O truth-table tests acima proteger *behaviour*. These assertions proteger o
// *implementation* contra silent removal — if o production code para
// checking isCgEventTapAvailableRef em qualquer um gate, o arquivo changes and we
// surface it loud.

describe('RefractInterface.tsx: guard implementation must keep checking both refs', () => {
  const source = fs.readFileSync(REFRACT_INTERFACE, 'utf8');

  test('isCgEventTapAvailableRef defaults to false (M1 safe default)', () => {
    // O ref declaration precisa initialise to false. A `useRef<boolean>(true)`
    // iria re-introduce o M1 hazard: entrada trapped até o IPC resolves.
    const refDecl = source.match(
      /const isCgEventTapAvailableRef\s*=\s*useRef<boolean>\(([^)]+)\)/,
    );
    assert.ok(refDecl, 'isCgEventTapAvailableRef declaration not found');
    assert.equal(
      refDecl[1].trim(),
      'false',
      'isCgEventTapAvailableRef must default to false so the input is clickable until availability is confirmed (M1)',
    );
  });

  test('blockInputFocus checks isCgEventTapAvailableRef before preventDefault', () => {
    // Pull o blockInputFocus bcorpo We assert ambos o availability verifica
    // and that it sits Antes e.preventDefault().
    const body = source.match(
      /const blockInputFocus = useCallback\([\s\S]*?\}, \[\]\);/,
    );
    assert.ok(body, 'blockInputFocus callback not found');
    const idxAvailCheck = body[0].indexOf('isCgEventTapAvailableRef.current');
    const idxPreventDefault = body[0].indexOf('e.preventDefault()');
    assert.ok(
      idxAvailCheck >= 0,
      'blockInputFocus must consult isCgEventTapAvailableRef (M1 guard)',
    );
    assert.ok(
      idxPreventDefault >= 0,
      'blockInputFocus must call e.preventDefault() in the happy path',
    );
    assert.ok(
      idxAvailCheck < idxPreventDefault,
      'isCgEventTapAvailableRef check must precede e.preventDefault() — otherwise focus is blocked before the guard runs',
    );
  });

  test('mount-effect onMouseDown checks isCgEventTapAvailableRef before stealthTapStart (M2)', () => {
    // O chat-input click-to-engage llistener Encontra o onMouseDown that
    // sits dentro o mesmo useEffect como stealthTapStart and assert it
    // short-circuits quando o ref é false.
    const effectMatch = source.match(
      /useEffect\(\(\) => \{[\s\S]*?stealthTapShouldAutoEngage[\s\S]*?stealthTapAvailable[\s\S]*?const onMouseDown[\s\S]*?stealthTapStart\([\s\S]*?\}, \[\]\);/,
    );
    assert.ok(
      effectMatch,
      'click-to-engage mount effect (stealthTapAvailable + onMouseDown + stealthTapStart) not found',
    );
    assert.match(
      effectMatch[0],
      /if \(!isCgEventTapAvailableRef\.current\) return;/,
      'M2: mount-effect onMouseDown must short-circuit when isCgEventTapAvailableRef is false (symmetric with blockInputFocus)',
    );
  });

  test('stealthTapStart() failure is logged, not swallowed (m5)', () => {
    // O m5 fix replaced `.catch(() => {})` com a console.warn então failures
    // surface em dev tools em vez disso de silently ignoring.
    assert.match(
      source,
      /stealthTapStart\(\)\.catch\(\(err\) => \{[\s\S]*?console\.warn\(['"]\[stealth\] tap start IPC failed['"], err\);[\s\S]*?\}\);/,
      'm5: stealthTapStart failure must be logged via console.warn, not silently swallowed',
    );
  });

  test('onStealthTapState flips isCgEventTapAvailableRef to false on permission revoke and true on active', () => {
    // M1 contract: o estado listener precisa atualiza isCgEventTapAvailableRef em
    // ambos directions.
    const stateHandler = source.match(
      /const unsubState = window\.electronAPI\.onStealthTapState\(\(\{[\s\S]*?\}\) => \{[\s\S]*?\}\);/,
    );
    assert.ok(stateHandler, 'onStealthTapState handler not found');
    // false branch em permissão revogar
    assert.match(
      stateHandler[0],
      /reason === 'permission'[\s\S]*?isCgEventTapAvailableRef\.current = false;/,
      'M1: onStealthTapState({active:false, reason:"permission"}) must flip isCgEventTapAvailableRef to false',
    );
    // verdadeiro branch em active=true
    assert.match(
      stateHandler[0],
      /if \(active\) \{[\s\S]*?isCgEventTapAvailableRef\.current = true;[\s\S]*?\}/,
      'M1: onStealthTapState({active:true}) must promote isCgEventTapAvailableRef to true',
    );
  });

  test('window.focus listener calls stealthTapRefreshIme (M3)', () => {
    // M3 contract: atualiza IME em window focar então mid-session input-source
    // changes don't silently break CJK composition.
    assert.match(
      source,
      /window\.addEventListener\(['"]focus['"], onFocusRefresh\)/,
      'M3: must register a window focus listener that refreshes IME state',
    );
    assert.match(
      source,
      /stealthTapRefreshIme\?\.\(\)/,
      'M3: focus listener must call stealthTapRefreshIme',
    );
    // And o cleanup precisa remove o listener — caso contrário we leak a manipulador
    // em todo componente remount (HMR, rotea changes, etcetc
    assert.match(
      source,
      /window\.removeEventListener\(['"]focus['"], onFocusRefresh\)/,
      'M3: focus listener cleanup must remove the listener to avoid leaks across remounts',
    );
  });
});

// ── Dead-IPC removal assertion (m5 / M5) ──────────────────────────────────

describe('dead stealth IPCs are fully removed across renderer surface', () => {
  test('no caller of stealthTapPermissionGranted, stealthTapRequestPermission, or stealthTapIsActive remains', () => {
    function walk(dir, acc = []) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (
            entry.name === 'node_modules' ||
            entry.name === '__tests__' ||
            entry.name === 'dist-electron' ||
            entry.name === 'dist'
          ) continue;
          walk(full, acc);
        } else if (
          entry.isFile() &&
          (entry.name.endsWith('.tsx') ||
            entry.name.endsWith('.ts') ||
            entry.name.endsWith('.js'))
        ) {
          acc.push(full);
        }
      }
      return acc;
    }
    const files = [
      ...walk(path.join(root, 'src')),
      ...walk(path.join(root, 'electron')),
    ];
    const dead = [
      'stealthTapPermissionGranted',
      'stealthTapRequestPermission',
      'stealthTapIsActive',
    ];
    const offenders = [];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      for (const name of dead) {
        if (text.includes(name)) {
          offenders.push(`${path.relative(root, file)} — ${name}`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `Dead stealth IPCs must have zero callers (M5 removed them):\n${offenders.join('\n')}`,
    );
  });
});
