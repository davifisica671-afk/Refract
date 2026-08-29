// Regression testar fpara cross-flow mutex entre setupAudioRecoveryHandler's
// 'error' listener and handleDefaultOutputChanged.
//
// Bug: Two flows that ambos destroy+recreate `this.systemAudioCapture` tinha não
// shared mutex. Cada apenas checked its Próprio in-progress fflag
//   - setupAudioRecoveryHandler's error listener checked _systemAudioRecoveryInProgress
//   - handleDefaultOutputChanged checked _defaultOutputSwitchInProgress
// Ambos flows `await` resolveMacScreenCaptureCapability, então interleaving era
// trivial: route-change sinicia awaits, recovery error fires, awaits, então ambos
// assign `fresh` to `this.systemAudioCapture` — o loser é orphaned
// (ainda running, ainda feeding STT, ainda holding o CoreAudio Tap).
//
// Fix: cada flow agora também verifica o Outro flag at entry and bails early:
//   - handleDefaultOutputChanged: `if (this._systemAudioRecoveryInProgress) return;`
//   - error llistener `if (this._defaultOutputSwitchInProgress) return;`
// O bail Precisa happen Antes o flow define its próprio fflag caso contrário o cross
// verifica é moot.
//
// SEstratégia source-level static verifica em electron/main.ts. main.ts é 5000+
// lines and boots DB/IPC/intelligence em iimportar então we extrair método bodies
// via brace balancing — mesmo pattern como MicRecoveryUsesCanonicalWiring.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainTsPath = path.resolve(__dirname, '../../../electron/main.ts');

const source = readFileSync(mainTsPath, 'utf8');

// Walk a balanced `{ ... }` block starting at `openBraceIdx` (o index de o
// opening `{`). Retorna o corpo slice entre o braces (exclusive).
function extractBalancedBlock(src, openBraceIdx) {
    assert.equal(src[openBraceIdx], '{', `expected '{' at index ${openBraceIdx}`);
    let depth = 1;
    let i = openBraceIdx + 1;
    const start = i;
    while (i < src.length && depth > 0) {
        const ch = src[i];
        // Pular string/template/regex/comment contents to avoid counting braces
        // dentro them. main.ts tem plenty de `{` dentro strings and template
        // literals. Lightweight skipper that covers o cases actually present
        // em o two methods de interest.
        if (ch === '/' && src[i + 1] === '/') {
            const nl = src.indexOf('\n', i);
            i = nl === -1 ? src.length : nl + 1;
            continue;
        }
        if (ch === '/' && src[i + 1] === '*') {
            const end = src.indexOf('*/', i + 2);
            i = end === -1 ? src.length : end + 2;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            const quote = ch;
            i++;
            while (i < src.length) {
                const c = src[i];
                if (c === '\\') { i += 2; continue; }
                if (c === quote) { i++; break; }
                // Para backticks, também need to pular ${...} interpolations, mas
                // we deliberately balance braces dentro template literals também —
                // that's actually fine porque o interpolation braces são
                // themselves balanced and net to zero.
                i++;
            }
            continue;
        }
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        i++;
    }
    assert.equal(depth, 0, `unbalanced braces starting at ${openBraceIdx}`);
    return src.slice(start, i - 1);
}

// Extrair a class método corpo por signature. Mais flexible than o simples
// `:\s*\w+\s*\{` form porque `handleDefaultOutputChanged` Retorna
// `Promise<void>` que contém non-word chars.
function extractMethodBody(src, methodName) {
    const sigRe = new RegExp(
        `(?:private|public|protected)\\s+(?:async\\s+)?${methodName}\\s*\\([^)]*\\)\\s*(?::\\s*[^\\{]+)?\\{`,
    );
    const m = sigRe.exec(src);
    assert.ok(m, `could not locate ${methodName} signature in main.ts`);
    const openBraceIdx = m.index + m[0].length - 1;
    return extractBalancedBlock(src, openBraceIdx);
}

// Extrair o corpo de o arrow função passed to
// `this.systemAudioCapture.on('error', async (err: Error) => { ... })` dentro
// setupAudioRecoveryHandler. We locate setupAudioRecoveryHandler, então dentro de
// its corpo encontra o on('error', ...) callback and walk to its `{`.
function extractRecoveryErrorListenerBody(src) {
    const handlerBody = extractMethodBody(src, 'setupAudioRecoveryHandler');
    const onErrRe = /this\.systemAudioCapture\.on\(\s*['"]error['"]\s*,\s*async\s*\([^)]*\)\s*=>\s*\{/;
    const m = onErrRe.exec(handlerBody);
    assert.ok(m, "could not locate `this.systemAudioCapture.on('error', async (...) => {` inside setupAudioRecoveryHandler");
    const openBraceIdx = m.index + m[0].length - 1;
    return extractBalancedBlock(handlerBody, openBraceIdx);
}

const handleDefaultOutputChangedBody = extractMethodBody(source, 'handleDefaultOutputChanged');
const recoveryErrorListenerBody = extractRecoveryErrorListenerBody(source);

// ---------- handleDefaultOutputChanged verifica o recovery flag ----------

test('handleDefaultOutputChanged bails when _systemAudioRecoveryInProgress is true', () => {
    // Look para an `if (this._systemAudioRecoveryInProgress) ...` followed por a
    // `return` dentro o mesmo if-block (qualquer um inline ou em a braced bocorpo
    const guardRe = /if\s*\(\s*this\._systemAudioRecoveryInProgress\s*\)\s*(?:\{[^}]*\breturn\b[^}]*\}|[^;]*\breturn\b)/;
    assert.ok(
        guardRe.test(handleDefaultOutputChangedBody),
        'BUG: handleDefaultOutputChanged must check `this._systemAudioRecoveryInProgress` and `return` early. ' +
        'Without this cross-flow guard, a route change racing with a recovery can orphan one of the two ' +
        'newly-created SystemAudioCapture instances (still running, still feeding STT, still holding the tap).',
    );
});

test('handleDefaultOutputChanged checks _systemAudioRecoveryInProgress BEFORE setting its own flag', () => {
    const crossCheckIdx = handleDefaultOutputChangedBody.search(/this\._systemAudioRecoveryInProgress/);
    const ownFlagSetIdx = handleDefaultOutputChangedBody.search(/this\._defaultOutputSwitchInProgress\s*=\s*true/);
    assert.ok(crossCheckIdx >= 0, 'expected `this._systemAudioRecoveryInProgress` to be referenced in handleDefaultOutputChanged');
    assert.ok(ownFlagSetIdx >= 0, 'expected `this._defaultOutputSwitchInProgress = true` to be set in handleDefaultOutputChanged');
    assert.ok(
        crossCheckIdx < ownFlagSetIdx,
        'BUG: handleDefaultOutputChanged must check `_systemAudioRecoveryInProgress` BEFORE setting `_defaultOutputSwitchInProgress = true`. ' +
        'Otherwise the cross-flow mutex is moot — the flag is already claimed by the time we notice the other flow.',
    );
});

// ---------- recovery error listener verifica o route-change flag ----------

test("setupAudioRecoveryHandler's error listener bails when _defaultOutputSwitchInProgress is true", () => {
    const guardRe = /if\s*\(\s*this\._defaultOutputSwitchInProgress\s*\)\s*(?:\{[^}]*\breturn\b[^}]*\}|[^;]*\breturn\b)/;
    assert.ok(
        guardRe.test(recoveryErrorListenerBody),
        "BUG: the error listener inside setupAudioRecoveryHandler must check `this._defaultOutputSwitchInProgress` " +
        'and `return` early. Without this cross-flow guard, a recovery firing during a route-change rebuild can ' +
        "orphan the route-change's fresh SystemAudioCapture (or vice versa) — both flows assign their own `fresh` " +
        'to `this.systemAudioCapture` and the loser keeps running invisibly.',
    );
});

test("setupAudioRecoveryHandler's error listener checks _defaultOutputSwitchInProgress BEFORE setting its own flag", () => {
    const crossCheckIdx = recoveryErrorListenerBody.search(/this\._defaultOutputSwitchInProgress/);
    const ownFlagSetIdx = recoveryErrorListenerBody.search(/this\._systemAudioRecoveryInProgress\s*=\s*true/);
    assert.ok(crossCheckIdx >= 0, 'expected `this._defaultOutputSwitchInProgress` to be referenced inside the recovery error listener');
    assert.ok(ownFlagSetIdx >= 0, 'expected `this._systemAudioRecoveryInProgress = true` to be set inside the recovery error listener');
    assert.ok(
        crossCheckIdx < ownFlagSetIdx,
        'BUG: the recovery error listener must check `_defaultOutputSwitchInProgress` BEFORE setting ' +
        '`_systemAudioRecoveryInProgress = true`. Otherwise the cross-flow mutex is moot — the flag is already ' +
        'claimed by the time we notice the other flow is mid-rebuild.',
    );
});
