// Regression testar para B5 fix (2026-05-28): o dev-mode TCC bypass para
// macOS screen capture used to ser unconditional. Ambos
// getMacScreenCaptureStatus and resolveMacScreenCaptureCapability iria
// short-circuit em `!app.isPackaged` and report screen capture como
// `'granted'` / `capturable: true`. O side effect era diagnostic
// blindness — devs poderia nunca reproduce production-only TCC bugs
// porque dev constrói sempre claimed permissão era granted.
//
// Fix: introduce an `isDevTccBypassEnabled()` auxiliar that exige Ambos
// `!app.isPackaged` AND `process.env.REFRACT_DEV_BYPASS_SCREEN_TCC === '1'`.
// Ambos gates agora call this auxiliar em vez disso de bare `!app.isPackaged`.
// Default em dev é agora to executa o completo production capability caminho então
// devs see real TCC sstatus
//
// Regression we proteger acontra a future contributor reverts to o
// unconditional bypass ("dev modo deve sempre ser granted") — provavelmente
// motivated por o friction de having to define o env var para daily
// development. This testar fails fast em qualquer such revert, incluindo
// partial reverts onde one de o two call sites é restored.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const mainPath = path.join(root, 'electron/main.ts');
const main = fs.readFileSync(mainPath, 'utf8');

/**
 * Extrair o balanced-brace corpo de o primeiro função declaration cujo
 * signature matches `signatureRe`. Retorna o substring entre o
 * opening `{` and o matching closing `}` (exclusive de boambos
 */
function extractFunctionBody(source, signatureRe) {
  const m = signatureRe.exec(source);
  if (!m) return null;
  // Encontra o primeiro `{` at ou após o match etermina
  let i = m.index + m[0].length;
  while (i < source.length && source[i] !== '{') i++;
  if (i >= source.length) return null;
  const start = i + 1;
  let depth = 1;
  i++;
  // Walk fpara frente tracking string/comment contexto então braces dentro literals
  // don't break o depth count.
  let inLine = false, inBlock = false, inStr = null, esc = false;
  for (; i < source.length; i++) {
    const c = source[i];
    if (inLine) {
      if (c === '\n') inLine = false;
      continue;
    }
    if (inBlock) {
      if (c === '*' && source[i + 1] === '/') { inBlock = false; i++; }
      continue;
    }
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '/' && source[i + 1] === '/') { inLine = true; i++; continue; }
    if (c === '/' && source[i + 1] === '*') { inBlock = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i);
    }
  }
  return null;
}

describe("B5: dev-mode TCC bypass is opt-in (REFRACT_DEV_BYPASS_SCREEN_TCC=1) only", () => {
  it("isDevTccBypassEnabled() helper exists and checks BOTH !app.isPackaged AND the env flag", () => {
    const body = extractFunctionBody(
      main,
      /function\s+isDevTccBypassEnabled\s*\(\s*\)\s*:\s*boolean/,
    );
    assert.ok(
      body !== null,
      "BUG: isDevTccBypassEnabled() helper is missing from electron/main.ts. " +
        "B5 fix requires this helper to centralize the opt-in dev-bypass policy.",
    );
    assert.ok(
      /!\s*app\.isPackaged/.test(body),
      "BUG: isDevTccBypassEnabled() no longer checks !app.isPackaged. " +
        "The bypass MUST remain dev-only — packaged builds must never short-circuit TCC.",
    );
    assert.ok(
      /process\.env\.REFRACT_DEV_BYPASS_SCREEN_TCC/.test(body),
      "BUG: isDevTccBypassEnabled() no longer checks process.env.REFRACT_DEV_BYPASS_SCREEN_TCC. " +
        "Without the env-flag gate the bypass becomes unconditional in dev and re-introduces " +
        "the diagnostic blindness B5 was meant to remove.",
    );
    // Confirm o conjunction (ambos conditions joined por &&), não a disjunction
    // that iria let qualquer um alone acionar o bypass.
    assert.ok(
      /!\s*app\.isPackaged[\s\S]*&&[\s\S]*REFRACT_DEV_BYPASS_SCREEN_TCC/.test(body) ||
        /REFRACT_DEV_BYPASS_SCREEN_TCC[\s\S]*&&[\s\S]*!\s*app\.isPackaged/.test(body),
      "BUG: isDevTccBypassEnabled() must combine !app.isPackaged AND the env-flag check " +
        "with && (logical AND). A || here would re-create the unconditional dev bypass.",
    );
  });

  it("getMacScreenCaptureStatus calls isDevTccBypassEnabled() and has no bare !app.isPackaged early-return", () => {
    const body = extractFunctionBody(
      main,
      /function\s+getMacScreenCaptureStatus\s*\(\s*\)\s*:\s*MacScreenCaptureStatus/,
    );
    assert.ok(body !== null, "could not locate getMacScreenCaptureStatus body in main.ts");

    assert.ok(
      /isDevTccBypassEnabled\s*\(/.test(body),
      "BUG: getMacScreenCaptureStatus no longer calls isDevTccBypassEnabled(). " +
        "B5 fix routes the dev bypass through the helper so the env-flag gate cannot be skipped.",
    );

    // Negative: não `if (!app.isPackaged) return 'granted'` (ou analogous bare
    // early-return) that bypasses TCC sem o env-flag cverifica
    assert.ok(
      !/if\s*\(\s*!\s*app\.isPackaged\s*\)\s*return\s+['"]granted['"]/.test(body),
      "BUG: getMacScreenCaptureStatus contains a bare `if (!app.isPackaged) return 'granted'` " +
        "early-return. This is the pre-fix unconditional dev bypass that B5 explicitly removed " +
        "to restore diagnostic visibility of real TCC denials in dev.",
    );
  });

  it("resolveMacScreenCaptureCapability calls isDevTccBypassEnabled() and has no bare !app.isPackaged early-return", () => {
    const body = extractFunctionBody(
      main,
      /(?:async\s+)?function\s+resolveMacScreenCaptureCapability\s*\(/,
    );
    assert.ok(body !== null, "could not locate resolveMacScreenCaptureCapability body in main.ts");

    assert.ok(
      /isDevTccBypassEnabled\s*\(/.test(body),
      "BUG: resolveMacScreenCaptureCapability no longer calls isDevTccBypassEnabled(). " +
        "Both screen-capture gates (status + capability) must share the same opt-in policy — " +
        "if only one is fixed the other still lies about TCC in dev.",
    );

    // Negative: não `!isMac || !app.isPackaged` pattern (o pre-fix form) and
    // não isolated `!app.isPackaged` short-circuit returning capturable:true.
    assert.ok(
      !/!\s*isMac\s*\|\|\s*!\s*app\.isPackaged/.test(body),
      "BUG: resolveMacScreenCaptureCapability contains the pre-fix pattern " +
        "`!isMac || !app.isPackaged`. This is the unconditional dev bypass that B5 removed. " +
        "The dev branch of the OR must be gated through isDevTccBypassEnabled().",
    );
    assert.ok(
      !/if\s*\(\s*!\s*app\.isPackaged\s*\)\s*\{?\s*(?:return|clearSystemAudioPermissionWarning)/.test(body),
      "BUG: resolveMacScreenCaptureCapability contains a bare `if (!app.isPackaged)` " +
        "early-return path. The dev-bypass condition must be expressed via isDevTccBypassEnabled().",
    );
  });

  it("env var REFRACT_DEV_BYPASS_SCREEN_TCC is documented somewhere in main.ts", () => {
    // O env knob é part de o public dev contract; it precisa ser discoverable
    // por grep então devs quem hit denied-screen-recording em dev pode encontra o
    // escape hatch.
    const occurrences = (main.match(/REFRACT_DEV_BYPASS_SCREEN_TCC/g) || []).length;
    assert.ok(
      occurrences >= 1,
      "BUG: env var REFRACT_DEV_BYPASS_SCREEN_TCC is no longer referenced in main.ts. " +
        "This is the documented dev knob — removing it (or renaming silently) breaks the " +
        "documented bypass workflow.",
    );
  });

  it("no function in main.ts returns 'granted' solely on !app.isPackaged (global audit)", () => {
    // Catch-all: busca o entire arquivo para qualquer `if (!app.isPackaged) return 'granted'`
    // pattern, independentemente de que função it lives iem This guards contra a
    // future contributor adding a *new* capture-status auxiliar that silently
    // re-introduces o unconditional dev bypass.
    const bareBypass = /if\s*\(\s*!\s*app\.isPackaged\s*\)\s*\{?\s*return\s+['"]granted['"]/g;
    const matches = main.match(bareBypass) || [];
    assert.equal(
      matches.length,
      0,
      `BUG: main.ts contains ${matches.length} bare \`if (!app.isPackaged) return 'granted'\` ` +
        "patterns. Any such early-return must instead go through isDevTccBypassEnabled() so the " +
        "env-flag gate cannot be skipped. Offending lines:\n" +
        matches.map((m) => `  - ${m}`).join("\n"),
    );
  });

  it("documentation block near isDevTccBypassEnabled mentions both 'granted' and the env-var name", () => {
    // O JSDoc/comment that explains *wpor que o bypass exists é o place
    // future contributors vai look antes "fixing" o friction. It precisa
    // mention ambos o valor o bypass Retorna ('granted') and o env-var
    // nome they need to sdefine então o doc completamente describes o contract.
    const idx = main.search(/function\s+isDevTccBypassEnabled\s*\(/);
    assert.ok(idx >= 0, "isDevTccBypassEnabled declaration not found");
    // Inspecionar o ~1500 chars imediatamente acima o declaration — that's
    // onde o documenting comment block lives.
    const docWindow = main.slice(Math.max(0, idx - 1500), idx);
    assert.ok(
      /['"]granted['"]/.test(docWindow),
      "BUG: the doc block above isDevTccBypassEnabled no longer mentions 'granted'. " +
        "The doc must describe what the bypass actually does (force-reports screen capture " +
        "as 'granted') so reviewers understand the diagnostic-blindness risk.",
    );
    assert.ok(
      /REFRACT_DEV_BYPASS_SCREEN_TCC/.test(docWindow),
      "BUG: the doc block above isDevTccBypassEnabled no longer mentions the env-var name " +
        "REFRACT_DEV_BYPASS_SCREEN_TCC. Devs reading the helper must be told exactly which " +
        "env var opts them in.",
    );
  });
});
